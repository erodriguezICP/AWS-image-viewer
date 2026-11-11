#!/usr/bin/env python3
"""Generate browser-friendly JPEG thumbnails for TIFF files stored in S3.

Large source TIFFs can be skipped before download/decompression to protect
memory-constrained environments such as AWS CloudShell.
"""

import argparse
import io
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
from botocore.exceptions import ClientError
from PIL import Image, ImageOps

DEFAULT_BUCKET = "manifest-inventory"
DEFAULT_SOURCE_PREFIX = "Key Manifest/"
DEFAULT_DESTINATION_PREFIX = "Key Manifest Thumbnails/"
DEFAULT_MAX_DIMENSION = 1200
DEFAULT_QUALITY = 85
DEFAULT_WORKERS = 4
DEFAULT_MAX_SOURCE_MB = 200
TIFF_EXTENSIONS = (".tif", ".tiff")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def normalize_prefix(prefix: str) -> str:
    return prefix if not prefix or prefix.endswith("/") else prefix + "/"


def destination_key(source_key: str, source_prefix: str, destination_prefix: str) -> str:
    source_prefix = normalize_prefix(source_prefix)
    destination_prefix = normalize_prefix(destination_prefix)
    relative = source_key[len(source_prefix):] if source_key.startswith(source_prefix) else source_key
    root, _ = os.path.splitext(relative)
    return f"{destination_prefix}{root}.jpg"


def object_exists(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def iter_tiffs(s3, bucket: str, source_prefix: str, max_source_bytes: int):
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=source_prefix):
        for item in page.get("Contents", []):
            key = item.get("Key", "")
            if not key.lower().endswith(TIFF_EXTENSIONS):
                continue
            size = int(item.get("Size", 0))
            if size > max_source_bytes:
                logger.warning(
                    "Skipping oversized TIFF before download: %s (%.1f MB > %.1f MB limit)",
                    key,
                    size / (1024 * 1024),
                    max_source_bytes / (1024 * 1024),
                )
                continue
            yield key, size


def convert_one(s3, args, source_key: str):
    target_key = destination_key(source_key, args.source_prefix, args.destination_prefix)

    if not args.overwrite and object_exists(s3, args.bucket, target_key):
        return "skipped", source_key, target_key

    if args.dry_run:
        return "planned", source_key, target_key

    response = s3.get_object(Bucket=args.bucket, Key=source_key)
    source_bytes = response["Body"].read()

    with Image.open(io.BytesIO(source_bytes)) as image:
        image = ImageOps.exif_transpose(image)
        try:
            image.seek(0)
        except EOFError:
            pass
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.thumbnail((args.max_dimension, args.max_dimension), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=args.quality, optimize=True)

    del source_bytes
    output.seek(0)
    s3.put_object(
        Bucket=args.bucket,
        Key=target_key,
        Body=output.getvalue(),
        ContentType="image/jpeg",
        CacheControl="public, max-age=31536000",
    )
    output.close()
    return "created", source_key, target_key


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
    parser.add_argument(
        "--max-source-mb",
        type=float,
        default=DEFAULT_MAX_SOURCE_MB,
        help="Skip source TIFFs larger than this many MB before downloading them (default: 200).",
    )
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.source_prefix = normalize_prefix(args.source_prefix)
    args.destination_prefix = normalize_prefix(args.destination_prefix)
    args.workers = max(1, args.workers)
    args.max_dimension = max(1, args.max_dimension)
    args.quality = min(100, max(1, args.quality))
    if args.max_source_mb <= 0:
        raise SystemExit("--max-source-mb must be greater than 0")

    max_source_bytes = int(args.max_source_mb * 1024 * 1024)
    s3 = boto3.client("s3")

    logger.info("Bucket: %s", args.bucket)
    logger.info("Source prefix: %s", args.source_prefix)
    logger.info("Destination prefix: %s", args.destination_prefix)
    logger.info("Workers: %d", args.workers)
    logger.info("Maximum source TIFF size: %.1f MB", args.max_source_mb)
    if args.dry_run:
        logger.info("DRY RUN: no thumbnails will be uploaded")

    sources = [key for key, _ in iter_tiffs(s3, args.bucket, args.source_prefix, max_source_bytes)]
    total = len(sources)
    logger.info("Eligible TIFF files: %d", total)

    counters = {"created": 0, "skipped": 0, "planned": 0, "failed": 0}

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(convert_one, s3, args, key): key for key in sources}

        for completed, future in enumerate(as_completed(futures), start=1):
            source_key = futures[future]
            try:
                status, source, target = future.result()
            except Exception:
                counters["failed"] += 1
                logger.exception("[%d/%d] failed: %s", completed, total, source_key)
                continue

            counters[status] += 1
            logger.info("[%d/%d] %s: %s -> %s", completed, total, status, source, target)

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
