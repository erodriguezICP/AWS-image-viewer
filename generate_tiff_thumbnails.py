#!/usr/bin/env python3
"""Generate JPEG thumbnails from TIFF objects stored in Amazon S3.

Missing-only behavior:
- Lists all source TIFF keys once.
- Lists existing target JPG/JPEG keys once.
- Builds a queue containing only TIFFs whose expected JPG is absent.
- Retains a final object-exists check to protect against race conditions.

Safety behavior:
- Skips macOS /.AppleDouble/ metadata objects.
- Skips sources larger than --max-source-mb.
- Skips images larger than --max-pixels.
- Skips Pillow decompression-bomb errors.
- Skips corrupt or unreadable TIFFs instead of terminating the batch.
- Continues processing when an individual object fails.
"""

import argparse
import io
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import PurePosixPath

import boto3
from botocore.exceptions import ClientError
from PIL import Image, ImageOps, UnidentifiedImageError

logger = logging.getLogger("tiff-thumbnails")


def object_exists(s3, bucket, key):
    """Return True when an S3 object exists; re-raise unexpected S3 errors."""
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        code = exc.response.get("Error", {}).get("Code")
        if status == 404 or code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def target_key_for(source_key, source_prefix, target_prefix):
    """Map a source TIFF key to its expected target JPG key."""
    if source_key.startswith(source_prefix):
        relative = source_key[len(source_prefix):]
    else:
        relative = source_key

    relative = relative.lstrip("/")
    path = PurePosixPath(relative)
    return f"{target_prefix.rstrip('/')}/{path.with_suffix('.jpg')}"


def list_tiffs(s3, bucket, prefix):
    """Yield TIFF keys under the source prefix, excluding AppleDouble metadata."""
    paginator = s3.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]

            if "/.AppleDouble/" in key:
                logger.warning("inventory-skipped-appledouble: %s", key)
                continue

            if key.lower().endswith((".tif", ".tiff")):
                yield key


def list_existing_jpegs(s3, bucket, prefix):
    """Return a set containing existing JPG/JPEG keys under the target prefix."""
    existing = set()
    paginator = s3.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.lower().endswith((".jpg", ".jpeg")):
                existing.add(key)

    return existing


def build_work_queue(s3, args):
    """Build the source queue, filtering to missing targets when requested."""
    source_keys = list(list_tiffs(s3, args.bucket, args.source_prefix))
    source_total = len(source_keys)

    logger.info(
        "Found %d TIFF source files under s3://%s/%s",
        source_total,
        args.bucket,
        args.source_prefix,
    )

    if not args.missing_only:
        logger.info("Missing-only mode is disabled; queued %d TIFF files", source_total)
        return source_keys, source_total, None

    existing_jpegs = list_existing_jpegs(s3, args.bucket, args.target_prefix)
    existing_total = len(existing_jpegs)

    missing_keys = [
        key
        for key in source_keys
        if target_key_for(key, args.source_prefix, args.target_prefix)
        not in existing_jpegs
    ]

    logger.info(
        "Found %d existing JPG/JPEG thumbnails under s3://%s/%s",
        existing_total,
        args.bucket,
        args.target_prefix,
    )
    logger.info(
        "Missing-only inventory: sources=%d existing-thumbnails=%d queued-missing=%d",
        source_total,
        existing_total,
        len(missing_keys),
    )

    return missing_keys, source_total, existing_total


def process_one(key, args):
    """Create one JPEG thumbnail or return a safe skip result."""
    s3 = boto3.client("s3")
    target = target_key_for(key, args.source_prefix, args.target_prefix)

    # Defense in depth. The target might be created after inventory but before
    # this worker starts. Do not overwrite it unless --overwrite was supplied.
    if not args.overwrite and object_exists(s3, args.bucket, target):
        return "skipped-existing", key, target

    if args.dry_run:
        return "planned", key, target

    # This is also filtered during inventory, but retain the worker-side guard.
    if "/.AppleDouble/" in key:
        logger.warning("skipped-appledouble: %s", key)
        return "skipped-appledouble", key, target

 response = s3.get_object(Bucket=args.bucket, Key=key)

source_size = response.get("ContentLength", 0)

if args.max_source_mb and source_size > args.max_source_mb * 1024 * 1024:
    logger.warning(
        "skipped-size: %s (%0.1f MB exceeds %s MB)",
        key,
        source_size / (1024 * 1024),
        args.max_source_mb,
    )
    response["Body"].close()
    return "skipped-size", key, target

source_bytes = response["Body"].read()

    try:
        with Image.open(io.BytesIO(source_bytes)) as image:
            width, height = image.size
            pixels = width * height

            if args.max_pixels and pixels > args.max_pixels:
                logger.warning(
                    "skipped-pixels: %s (%d pixels exceeds %d)",
                    key,
                    pixels,
                    args.max_pixels,
                )
                return "skipped-pixels", key, target

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

    except Image.DecompressionBombError as exc:
        logger.warning("skipped-decompression-bomb: %s (%s)", key, exc)
        return "skipped-decompression-bomb", key, target
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        logger.warning("skipped-unreadable: %s (%s)", key, exc)
        return "skipped-unreadable", key, target

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
        description="Generate JPEG thumbnails from TIFF objects in S3"
    )
    parser.add_argument("--bucket", default="manifest-inventory")
    parser.add_argument("--source-prefix", default="Key Manifest/")
    parser.add_argument("--target-prefix", default="Key Manifest Thumbnails/")
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--max-dimension", type=int, default=1600)
    parser.add_argument("--quality", type=int, default=85)
    parser.add_argument("--max-source-mb", type=int, default=200)
    parser.add_argument("--max-pixels", type=int, default=200_000_000)
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="Queue only TIFFs whose expected JPG thumbnail does not exist",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow existing target JPG thumbnails to be replaced",
    )
    parser.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()

    if args.missing_only and args.overwrite:
        parser.error("--missing-only and --overwrite cannot be used together")

    if args.workers < 1:
        parser.error("--workers must be at least 1")

    return args


def main():
    args = parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    s3 = boto3.client("s3")
    keys, source_total, existing_total = build_work_queue(s3, args)
    queue_total = len(keys)

    if queue_total == 0:
        if args.missing_only:
            logger.info("No missing JPG thumbnails found. Nothing to process.")
        else:
            logger.info("No TIFF source files found. Nothing to process.")
        return 0

    logger.info(
        "Starting thumbnail job: queued=%d workers=%d dry-run=%s",
        queue_total,
        args.workers,
        args.dry_run,
    )

    counts = {
        "created": 0,
        "planned": 0,
        "skipped-existing": 0,
        "skipped-appledouble": 0,
        "skipped-size": 0,
        "skipped-pixels": 0,
        "skipped-decompression-bomb": 0,
        "skipped-unreadable": 0,
        "failed": 0,
    }

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_one, key, args): key for key in keys}

        for index, future in enumerate(as_completed(futures), 1):
            key = futures[future]

            try:
                status, source, target = future.result()
                counts[status] = counts.get(status, 0) + 1
                logger.info(
                    "[%d/%d] %s: %s -> %s",
                    index,
                    queue_total,
                    status,
                    source,
                    target,
                )
            except Exception:
                counts["failed"] += 1
                logger.exception("[%d/%d] failed: %s", index, queue_total, key)

    logger.info(
        "Finished: sources=%d existing-inventory=%s queued=%d created=%d "
        "planned=%d skipped-existing=%d skipped-appledouble=%d skipped-size=%d "
        "skipped-pixels=%d skipped-decompression-bomb=%d skipped-unreadable=%d "
        "failed=%d",
        source_total,
        existing_total if existing_total is not None else "not-listed",
        queue_total,
        counts["created"],
        counts["planned"],
        counts["skipped-existing"],
        counts["skipped-appledouble"],
        counts["skipped-size"],
        counts["skipped-pixels"],
        counts["skipped-decompression-bomb"],
        counts["skipped-unreadable"],
        counts["failed"],
    )

    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
