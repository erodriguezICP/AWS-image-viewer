#!/usr/bin/env python3
"""Create browser-friendly JPEG derivatives for TIFF files in S3.

Safety behavior:
- Existing JPGs are not overwritten unless --overwrite is supplied.
- --missing-only inventories existing JPGs and submits only missing work.
- Source-size and decoded-pixel limits protect AWS CloudShell.
- Pillow decompression-bomb checks are disabled only so image dimensions can
  be read; this script's stricter --max-pixels limit is then enforced before
  image decoding, resizing, or JPEG creation.
- --dry-run plans work without uploading files.
"""

import argparse
import io
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterator

import boto3
from botocore.exceptions import ClientError
from PIL import Image, ImageOps, UnidentifiedImageError

DEFAULT_BUCKET = "manifest-inventory"
DEFAULT_SOURCE_PREFIX = "Key Manifest/"
DEFAULT_DESTINATION_PREFIX = "Key Manifest Thumbnails/"
DEFAULT_MAX_DIMENSION = 1600
DEFAULT_QUALITY = 86
DEFAULT_WORKERS = 1
DEFAULT_MAX_SOURCE_MB = 200
DEFAULT_MAX_PIXELS = 100_000_000
TIFF_EXTENSIONS = (".tif", ".tiff")
JPEG_EXTENSIONS = (".jpg", ".jpeg")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("tiff-thumbnails")


def normalize_prefix(prefix: str) -> str:
    prefix = prefix.lstrip("/")
    return prefix if prefix.endswith("/") else prefix + "/"


def destination_key(
    key: str,
    source_prefix: str,
    destination_prefix: str,
) -> str:
    relative = key[len(source_prefix):] if key.startswith(source_prefix) else key
    return normalize_prefix(destination_prefix) + os.path.splitext(relative)[0] + ".jpg"


def object_exists(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def iter_tiffs(s3, args) -> Iterator[str]:
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=args.bucket, Prefix=args.source_prefix):
        for item in page.get("Contents", []):
            key = item.get("Key", "")
            size = int(item.get("Size", 0))
            if not key.lower().endswith(TIFF_EXTENSIONS):
                continue
            if args.max_source_mb and size > args.max_source_mb * 1024 * 1024:
                logger.warning(
                    "skipped-size: %s (%0.1f MB exceeds %s MB)",
                    key,
                    size / (1024 * 1024),
                    args.max_source_mb,
                )
                continue
            yield key


# NEW: The old script had no destination inventory and submitted every TIFF.
def list_existing_jpegs(s3, args) -> set[str]:
    existing: set[str] = set()
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(
        Bucket=args.bucket,
        Prefix=args.destination_prefix,
    ):
        for item in page.get("Contents", []):
            key = item.get("Key", "")
            if key.lower().endswith(JPEG_EXTENSIONS):
                existing.add(key)
    return existing


def convert_one(s3, args, key: str):
    target = destination_key(key, args.source_prefix, args.destination_prefix)

    # ORIGINAL SAFETY CHECK RETAINED: protects against a race after inventory.
    if not args.overwrite and object_exists(s3, args.bucket, target):
        return "skipped", key, target

    if args.dry_run:
        return "planned", key, target

    response = s3.get_object(Bucket=args.bucket, Key=key)
    source_bytes = response["Body"].read()

    if args.max_source_mb and len(source_bytes) > args.max_source_mb * 1024 * 1024:
        logger.warning(
            "skipped-size: %s (%0.1f MB exceeds %s MB)",
            key,
            len(source_bytes) / (1024 * 1024),
            args.max_source_mb,
        )
        return "skipped", key, target

    try:
        with Image.open(io.BytesIO(source_bytes)) as image:
            width, height = image.size
            pixels = width * height

            # UPDATED: every oversized TIFF, including 200M+ pixel files,
            # is cleanly skipped before decoding/resizing.
            if args.max_pixels and pixels > args.max_pixels:
                logger.warning(
                    "skipped-pixels: %s (%d pixels exceeds %d)",
                    key,
                    pixels,
                    args.max_pixels,
                )
                return "skipped", key, target

            image = ImageOps.exif_transpose(image)

            if image.mode not in ("RGB", "L"):
                if "A" in image.getbands():
                    background = Image.new("RGB", image.size, "white")
                    background.paste(image, mask=image.getchannel("A"))
                    image = background
                else:
                    image = image.convert("RGB")
            elif image.mode == "L":
                image = image.convert("RGB")

            image.thumbnail(
                (args.max_dimension, args.max_dimension),
                Image.Resampling.LANCZOS,
            )

            output = io.BytesIO()
            image.save(
                output,
                format="JPEG",
                quality=args.quality,
                optimize=True,
                progressive=True,
            )
            output.seek(0)

    # DEFENSE IN DEPTH: if Pillow still raises its exception, skip safely.
    except Image.DecompressionBombError as exc:
        logger.warning("skipped-decompression-bomb: %s (%s)", key, exc)
        return "skipped", key, target
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise RuntimeError(f"Unable to decode TIFF {key}: {exc}") from exc

    s3.put_object(
        Bucket=args.bucket,
        Key=target,
        Body=output.getvalue(),
        ContentType="image/jpeg",
        CacheControl="public, max-age=31536000, immutable",
    )
    return "created", key, target


def parse_args():
    parser = argparse.ArgumentParser(
        description="Create browser-friendly JPEG thumbnails for TIFF files in S3."
    )
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--source-prefix", default=DEFAULT_SOURCE_PREFIX)
    parser.add_argument("--destination-prefix", default=DEFAULT_DESTINATION_PREFIX)
    parser.add_argument("--max-dimension", type=int, default=DEFAULT_MAX_DIMENSION)
    parser.add_argument("--quality", type=int, default=DEFAULT_QUALITY)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument("--max-source-mb", type=int, default=DEFAULT_MAX_SOURCE_MB)
    parser.add_argument("--max-pixels", type=int, default=DEFAULT_MAX_PIXELS)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--dry-run", action="store_true")

    # NEW: prefilter work using the existing JPG inventory.
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help=(
            "Inventory existing JPG derivatives and submit only TIFF files "
            "whose expected JPG is missing."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.source_prefix = normalize_prefix(args.source_prefix)
    args.destination_prefix = normalize_prefix(args.destination_prefix)

    if args.workers < 1:
        raise SystemExit("ERROR: --workers must be at least 1")
    if args.max_dimension < 1:
        raise SystemExit("ERROR: --max-dimension must be at least 1")
    if not 1 <= args.quality <= 100:
        raise SystemExit("ERROR: --quality must be between 1 and 100")
    if args.max_source_mb < 1:
        raise SystemExit("ERROR: --max-source-mb must be at least 1")
    if args.max_pixels < 1:
        raise SystemExit("ERROR: --max-pixels must be at least 1")
    if args.missing_only and args.overwrite:
        raise SystemExit(
            "ERROR: --missing-only and --overwrite cannot be used together."
        )

    # UPDATED: disable Pillow's separate 2x bomb threshold. The script's
    # stricter max-pixels check above is enforced before image decoding.
    Image.MAX_IMAGE_PIXELS = None

    s3 = boto3.client("s3")

    # ORIGINAL:
    # sources = list(iter_tiffs(s3, args))
    # UPDATED: inventory TIFFs, then prefilter missing derivatives.
    all_sources = list(iter_tiffs(s3, args))

    if args.missing_only:
        logger.info(
            "Inventorying existing JPGs under s3://%s/%s",
            args.bucket,
            args.destination_prefix,
        )
        existing_jpegs = list_existing_jpegs(s3, args)
        sources = [
            key
            for key in all_sources
            if destination_key(
                key,
                args.source_prefix,
                args.destination_prefix,
            ) not in existing_jpegs
        ]
        completed_count = len(all_sources) - len(sources)
        logger.info("TIFF originals found: %d", len(all_sources))
        logger.info("Existing JPG derivatives matched: %d", completed_count)
        logger.info("Missing JPG derivatives to process: %d", len(sources))
    else:
        sources = all_sources

    # CORRECTED SCOPE: this block runs for both normal and missing-only modes.
    total = len(sources)
    logger.info("Eligible TIFF files: %d", total)
    counters = {"created": 0, "skipped": 0, "planned": 0, "failed": 0}

    if total == 0:
        logger.info("No TIFF files require processing.")
        return 0

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(convert_one, s3, args, key): key
            for key in sources
        }
        for completed, future in enumerate(as_completed(futures), 1):
            try:
                status, source, target = future.result()
            except Exception:
                counters["failed"] += 1
                logger.exception(
                    "[%d/%d] failed: %s",
                    completed,
                    total,
                    futures[future],
                )
                continue

            counters[status] += 1
            logger.info(
                "[%d/%d] %s: %s -> %s",
                completed,
                total,
                status,
                source,
                target,
            )

    logger.info(
        "Complete. created=%d skipped=%d planned=%d failed=%d",
        counters["created"],
        counters["skipped"],
        counters["planned"],
        counters["failed"],
    )
    return 1 if counters["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
