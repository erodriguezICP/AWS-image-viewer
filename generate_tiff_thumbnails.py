#!/usr/bin/env python3
"""Generate JPEG derivatives for TIFFs in S3, skipping oversized sources.

Defaults:
  Bucket: manifest-inventory
  Source: Key Manifest/
  Destination: Key Manifest Thumbnails/
  Skip sources larger than: 200 MB

Original TIFF files are never modified or deleted.
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Iterable

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from PIL import Image, ImageOps, UnidentifiedImageError

TIFF_EXTENSIONS = (".tif", ".tiff")
DEFAULT_MAX_SOURCE_MB = 250


@dataclass(frozen=True)
class SourceObject:
    key: str
    size: int


@dataclass(frozen=True)
class Settings:
    bucket: str
    source_prefix: str
    destination_prefix: str
    max_dimension: int
    quality: int
    workers: int
    max_source_bytes: int
    overwrite: bool
    dry_run: bool


def parse_args() -> Settings:
    parser = argparse.ArgumentParser(
        description="Create JPEG thumbnails for TIFF files in S3 and skip oversized sources."
    )
    parser.add_argument("--bucket", default="manifest-inventory")
    parser.add_argument("--source-prefix", default="Key Manifest/")
    parser.add_argument("--destination-prefix", default="Key Manifest Thumbnails/")
    parser.add_argument("--max-dimension", type=int, default=1200)
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--max-source-mb", type=int, default=DEFAULT_MAX_SOURCE_MB)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not 1 <= args.quality <= 95:
        parser.error("--quality must be between 1 and 95")
    if args.max_dimension < 100:
        parser.error("--max-dimension must be at least 100")
    if not 1 <= args.workers <= 16:
        parser.error("--workers must be between 1 and 16")
    if args.max_source_mb < 1:
        parser.error("--max-source-mb must be at least 1")

    return Settings(
        bucket=args.bucket,
        source_prefix=args.source_prefix.strip("/") + "/",
        destination_prefix=args.destination_prefix.strip("/") + "/",
        max_dimension=args.max_dimension,
        quality=args.quality,
        workers=args.workers,
        max_source_bytes=args.max_source_mb * 1024 * 1024,
        overwrite=args.overwrite,
        dry_run=args.dry_run,
    )


def make_s3_client():
    return boto3.client(
        "s3",
        config=Config(
            retries={"max_attempts": 8, "mode": "adaptive"},
            max_pool_connections=32,
            connect_timeout=20,
            read_timeout=120,
        ),
    )


def scan_tiffs(s3, settings: Settings) -> tuple[list[SourceObject], int, int]:
    eligible: list[SourceObject] = []
    skipped_large = 0
    total_tiffs = 0
    paginator = s3.get_paginator("list_objects_v2")

    for page in paginator.paginate(
        Bucket=settings.bucket,
        Prefix=settings.source_prefix,
        PaginationConfig={"PageSize": 1000},
    ):
        for item in page.get("Contents", []):
            key = item["Key"]
            if not key.lower().endswith(TIFF_EXTENSIONS):
                continue

            total_tiffs += 1
            size = int(item.get("Size", 0))

            if size > settings.max_source_bytes:
                skipped_large += 1
                logging.warning(
                    "SKIP TOO LARGE: %s (%.1f MB > %.1f MB limit)",
                    key,
                    size / (1024 * 1024),
                    settings.max_source_bytes / (1024 * 1024),
                )
                continue

            eligible.append(SourceObject(key=key, size=size))

    return eligible, total_tiffs, skipped_large


def destination_key(source_key: str, settings: Settings) -> str:
    relative = source_key[len(settings.source_prefix):]
    base, _ = os.path.splitext(relative)
    return f"{settings.destination_prefix}{base}.jpg"


def object_exists(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def flatten_to_rgb(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def convert_one(source: SourceObject, settings: Settings) -> tuple[str, str, str]:
    s3 = make_s3_client()
    target_key = destination_key(source.key, settings)

    if not settings.overwrite and object_exists(s3, settings.bucket, target_key):
        return "skipped_existing", source.key, target_key

    if settings.dry_run:
        return "planned", source.key, target_key

    with tempfile.NamedTemporaryFile(suffix=".tif") as source_file:
        s3.download_fileobj(settings.bucket, source.key, source_file)
        source_file.flush()

        try:
            with Image.open(source_file.name) as image:
                image.seek(0)
                rgb = flatten_to_rgb(image)
                rgb.thumbnail(
                    (settings.max_dimension, settings.max_dimension),
                    Image.Resampling.LANCZOS,
                )

                output = io.BytesIO()
                rgb.save(
                    output,
                    format="JPEG",
                    quality=settings.quality,
                    optimize=True,
                    progressive=True,
                    subsampling="4:2:0",
                )
                output.seek(0)
        except (UnidentifiedImageError, OSError) as error:
            raise RuntimeError(f"Pillow could not decode {source.key}: {error}") from error

    # Keep custom metadata ASCII-only. The Unicode source path is already encoded
    # in the destination object key, so it does not need to be repeated in Metadata.
    s3.upload_fileobj(
        output,
        settings.bucket,
        target_key,
        ExtraArgs={
            "ContentType": "image/jpeg",
            "CacheControl": "public, max-age=31536000, immutable",
            "Metadata": {
                "thumbnail-generator": "generate-tiff-thumbnails",
            },
        },
    )

    return "created", source.key, target_key


def main() -> int:
    settings = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    limit_mb = settings.max_source_bytes / (1024 * 1024)
    logging.info("Maximum TIFF source size: %.0f MB", limit_mb)

    s3 = make_s3_client()
    eligible, total_tiffs, skipped_large = scan_tiffs(s3, settings)

    logging.info(
        "Scan complete. TIFFs=%s eligible=%s skipped_too_large=%s",
        total_tiffs,
        len(eligible),
        skipped_large,
    )

    counts = {
        "created": 0,
        "skipped_existing": 0,
        "planned": 0,
        "failed": 0,
    }

    with ThreadPoolExecutor(max_workers=settings.workers) as executor:
        futures = {
            executor.submit(convert_one, source, settings): source
            for source in eligible
        }

        for completed, future in enumerate(as_completed(futures), start=1):
            source = futures[future]
            try:
                status, source_key, target_key = future.result()
                counts[status] += 1
                logging.info(
                    "[%s/%s] %s: %s -> %s",
                    completed,
                    len(eligible),
                    status,
                    source_key,
                    target_key,
                )
            except Exception as error:
                counts["failed"] += 1
                logging.error(
                    "[%s/%s] failed: %s: %s",
                    completed,
                    len(eligible),
                    source.key,
                    error,
                )

    logging.info(
        "Complete. created=%s skipped_existing=%s skipped_too_large=%s planned=%s failed=%s",
        counts["created"],
        counts["skipped_existing"],
        skipped_large,
        counts["planned"],
        counts["failed"],
    )

    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
