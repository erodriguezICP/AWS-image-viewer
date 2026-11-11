#!/usr/bin/env python3
import argparse
import io
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
from botocore.exceptions import ClientError
from PIL import Image, ImageOps, UnidentifiedImageError

DEFAULT_BUCKET = "manifest-inventory"
DEFAULT_SOURCE_PREFIX = "Key Manifest/"
DEFAULT_DESTINATION_PREFIX = "Key Manifest Thumbnails/"
DEFAULT_MAX_DIMENSION = 1200
DEFAULT_QUALITY = 85
DEFAULT_WORKERS = 3
DEFAULT_MAX_SOURCE_MB = 200
DEFAULT_MAX_PIXELS = 100_000_000
TIFF_EXTENSIONS = (".tif", ".tiff")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def normalize_prefix(prefix):
    return prefix if not prefix or prefix.endswith("/") else prefix + "/"


def destination_key(key, source_prefix, destination_prefix):
    relative = key[len(source_prefix):] if key.startswith(source_prefix) else key
    return normalize_prefix(destination_prefix) + os.path.splitext(relative)[0] + ".jpg"


def object_exists(s3, bucket, key):
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def iter_tiffs(s3, args):
    byte_limit = int(args.max_source_mb * 1024 * 1024)
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=args.bucket, Prefix=args.source_prefix):
        for item in page.get("Contents", []):
            key = item.get("Key", "")
            size = int(item.get("Size", 0))
            if "/.AppleDouble/" in key:
                logger.info("Skipping AppleDouble metadata: %s", key)
                continue
            if not key.lower().endswith(TIFF_EXTENSIONS):
                continue
            if size > byte_limit:
                logger.warning("Skipping oversized TIFF before download: %s (%.1f MB > %.1f MB limit)", key, size / 1048576, args.max_source_mb)
                continue
            yield key


def convert_one(s3, args, key):
    target = destination_key(key, args.source_prefix, args.destination_prefix)
    if not args.overwrite and object_exists(s3, args.bucket, target):
        return "skipped", key, target
    if args.dry_run:
        return "planned", key, target

    data = s3.get_object(Bucket=args.bucket, Key=key)["Body"].read()
    try:
        with Image.open(io.BytesIO(data)) as image:
            pixels = image.width * image.height
            if pixels > args.max_pixels:
                logger.warning("Skipping oversized image by pixel count: %s (%d pixels > %d pixel limit)", key, pixels, args.max_pixels)
                return "skipped", key, target
            image = ImageOps.exif_transpose(image)
            if image.mode != "RGB":
                image = image.convert("RGB")
            image.thumbnail((args.max_dimension, args.max_dimension), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=args.quality, optimize=True)
    except UnidentifiedImageError:
        logger.warning("Skipping unrecognized/non-image TIFF object: %s", key)
        return "skipped", key, target
    finally:
        del data

    output.seek(0)
    s3.put_object(Bucket=args.bucket, Key=target, Body=output.getvalue(), ContentType="image/jpeg", CacheControl="public, max-age=31536000")
    output.close()
    return "created", key, target


def parse_args():
    parser = argparse.ArgumentParser(description="Create browser-friendly JPEG thumbnails for TIFF files in S3.")
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--source-prefix", default=DEFAULT_SOURCE_PREFIX)
    parser.add_argument("--destination-prefix", default=DEFAULT_DESTINATION_PREFIX)
    parser.add_argument("--max-dimension", type=int, default=DEFAULT_MAX_DIMENSION)
    parser.add_argument("--quality", type=int, default=DEFAULT_QUALITY)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument("--max-source-mb", type=float, default=DEFAULT_MAX_SOURCE_MB)
    parser.add_argument("--max-pixels", type=int, default=DEFAULT_MAX_PIXELS)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    args.source_prefix = normalize_prefix(args.source_prefix)
    args.destination_prefix = normalize_prefix(args.destination_prefix)
    args.workers = max(1, args.workers)
    args.max_dimension = max(1, args.max_dimension)
    args.quality = min(100, max(1, args.quality))
    if args.max_source_mb <= 0 or args.max_pixels <= 0:
        raise SystemExit("Size and pixel limits must be greater than zero")

    s3 = boto3.client("s3")
    logger.info("Workers: %d | max source: %.1f MB | max pixels: %d", args.workers, args.max_source_mb, args.max_pixels)
    sources = list(iter_tiffs(s3, args))
    total = len(sources)
    logger.info("Eligible TIFF files: %d", total)
    counters = {"created": 0, "skipped": 0, "planned": 0, "failed": 0}

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(convert_one, s3, args, key): key for key in sources}
        for completed, future in enumerate(as_completed(futures), 1):
            try:
                status, source, target = future.result()
            except Exception:
                counters["failed"] += 1
                logger.exception("[%d/%d] failed: %s", completed, total, futures[future])
                continue
            counters[status] += 1
            logger.info("[%d/%d] %s: %s -> %s", completed, total, status, source, target)

    logger.info("Complete. created=%d skipped=%d planned=%d failed=%d", counters["created"], counters["skipped"], counters["planned"], counters["failed"])
    return 1 if counters["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
