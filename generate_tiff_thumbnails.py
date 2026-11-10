#!/usr/bin/env python3
"""Generate JPEG thumbnails in S3 for TIFF archive masters.

Default mapping:
  s3://manifest-inventory/Key Manifest/path/photo.tif
  -> s3://manifest-inventory/Key Manifest Thumbnails/path/photo.jpg

The original TIFF is never modified. Existing JPEG derivatives are skipped unless
--overwrite is supplied.
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

MAX_SOURCE_SIZE_MB = 200
MAX_SOURCE_SIZE_BYTES = MAX_SOURCE_SIZE_MB * 1024 * 1024


@dataclass(frozen=True)
class Settings:
    bucket: str
    source_prefix: str
    destination_prefix: str
    max_dimension: int
    quality: int
    workers: int
    overwrite: bool
    dry_run: bool


def parse_args() -> Settings:
    parser = argparse.ArgumentParser(
        description="Create browser-friendly JPEG thumbnails for TIFF files in S3."
    )
    parser.add_argument("--bucket", default="manifest-inventory")
    parser.add_argument("--source-prefix", default="Key Manifest/")
    parser.add_argument("--destination-prefix", default="Key Manifest Thumbnails/")
    parser.add_argument("--max-dimension", type=int, default=1200)
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not 1 <= args.quality <= 95:
        parser.error("--quality must be between 1 and 95")
    if args.max_dimension < 100:
        parser.error("--max-dimension must be at least 100")
    if not 1 <= args.workers <= 16:
        parser.error("--workers must be between 1 and 16")

    source = args.source_prefix.strip("/") + "/"
    destination = args.destination_prefix.strip("/") + "/"
    if source == destination:
        parser.error("source and destination prefixes must be different")

    return Settings(
        bucket=args.bucket,
        source_prefix=source,
        destination_prefix=destination,
        max_dimension=args.max_dimension,
        quality=args.quality,
        workers=args.workers,
        overwrite=args.overwrite,
        dry_run=args.dry_run,
    )


def make_s3_client():
    return boto3.client(
        "s3",
        config=Config(
            retries={"max_attempts": 8, "mode": "adaptive"},
            max_pool_connections=32,
        ),
    )


def iter_tiff_keys(s3, settings: Settings) -> Iterable[str]:
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

    size = item.get("Size", 0)

    if size > MAX_SOURCE_SIZE_BYTES:
        logging.warning(
            "Skipping oversized TIFF: %s (%.1f MB)",
            key,
            size / (1024 * 1024),
        )
        continue

    yield key


def destination_key(source_key: str, settings: Settings) -> str:
    relative = source_key[len(settings.source_prefix) :]
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

    # TIFFs can be palette, grayscale, CMYK, RGBA, 16-bit, or multi-frame.
    if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background

    if image.mode == "CMYK":
        return image.convert("RGB")

    if image.mode not in {"RGB", "L"}:
        return image.convert("RGB")

    return image.convert("RGB")


def convert_one(source_key: str, settings: Settings) -> tuple[str, str, str]:
    s3 = make_s3_client()
    target_key = destination_key(source_key, settings)

    if not settings.overwrite and object_exists(s3, settings.bucket, target_key):
        return "skipped", source_key, target_key

    if settings.dry_run:
        return "planned", source_key, target_key

    # Use a temporary file so large TIFFs do not have to exist twice in memory.
    with tempfile.NamedTemporaryFile(suffix=".tif") as source_file:
        s3.download_fileobj(settings.bucket, source_key, source_file)
        source_file.flush()
        source_file.seek(0)

        try:
            with Image.open(source_file.name) as image:
                # Use the first page/frame as the archive thumbnail.
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
            raise RuntimeError(f"Pillow could not decode {source_key}: {error}") from error

    s3.upload_fileobj(
        output,
        settings.bucket,
        target_key,
        ExtraArgs={
            "ContentType": "image/jpeg",
            "CacheControl": "public, max-age=31536000, immutable",
            "Metadata": {
                "thumbnail-generator": "generate_tiff_thumbnails.py",
  },
        },
    )
    return "created", source_key, target_key


def main() -> int:
    settings = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    s3 = make_s3_client()
    keys = list(iter_tiff_keys(s3, settings))
    logging.info("Found %s TIFF files under s3://%s/%s", len(keys), settings.bucket, settings.source_prefix)

    if not keys:
        return 0

    counts = {"created": 0, "skipped": 0, "planned": 0, "failed": 0}

    with ThreadPoolExecutor(max_workers=settings.workers) as executor:
        futures = {executor.submit(convert_one, key, settings): key for key in keys}
        for completed, future in enumerate(as_completed(futures), start=1):
            source_key = futures[future]
            try:
                status, _, target_key = future.result()
                counts[status] += 1
                logging.info("[%s/%s] %s: %s -> %s", completed, len(keys), status, source_key, target_key)
            except Exception as error:  # Continue processing the remaining archive.
                counts["failed"] += 1
                logging.error("[%s/%s] failed: %s: %s", completed, len(keys), source_key, error)

    logging.info(
        "Complete. created=%s skipped=%s planned=%s failed=%s",
        counts["created"],
        counts["skipped"],
        counts["planned"],
        counts["failed"],
    )
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
