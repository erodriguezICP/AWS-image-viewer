#!/usr/bin/env python3
"""Generate JPEG thumbnails from TIFF objects in S3.

Stable behavior retained:
- Existing target JPGs are skipped unless --overwrite is supplied.
- Source-size and pixel guards are applied before thumbnail generation.
- Per-file failures do not terminate the full archive job.

Corrections incorporated:
- Supports --missing-only for compatibility with run-tiff-thumbnail-job-safe.sh.
- Skips macOS /.AppleDouble/ metadata objects.
- Skips unreadable/corrupt TIFFs instead of raising a fatal RuntimeError.
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
    relative = source_key[len(source_prefix):] if source_key.startswith(source_prefix) else source_key
    relative = relative.lstrip("/")
    path = PurePosixPath(relative)
    return f"{target_prefix.rstrip('/')}/{path.with_suffix('.jpg')}"


def list_tiffs(s3, bucket, prefix):
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.lower().endswith((".tif", ".tiff")):
                yield key


def process_one(key, args):
    s3 = boto3.client("s3")
    target = target_key_for(key, args.source_prefix, args.target_prefix)

    # Stable missing-target behavior. --missing-only is accepted explicitly by
    # the safe launcher; existing targets remain protected unless --overwrite.
    if not args.overwrite and object_exists(s3, args.bucket, target):
        return "skipped", key, target

    if args.dry_run:
        return "planned", key, target

    # CORRECTION: .AppleDouble entries are macOS metadata/resource-fork files.
    if "/.AppleDouble/" in key:
        logger.warning("skipped-appledouble: %s", key)
        return "skipped", key, target

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

    except Image.DecompressionBombError as exc:
        logger.warning("skipped-decompression-bomb: %s (%s)", key, exc)
        return "skipped", key, target
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        # CORRECTION: a bad TIFF is logged/skipped rather than killing the run.
        logger.warning("skipped-unreadable: %s (%s)", key, exc)
        return "skipped", key, target

    s3.put_object(
        Bucket=args.bucket,
        Key=target,
        Body=output.getvalue(),
        ContentType="image/jpeg",
        CacheControl="public, max-age=31536000, immutable",
    )
    return "created", key, target


def parse_args():
    parser = argparse.ArgumentParser(description="Generate JPEG thumbnails from TIFF objects in S3")
    parser.add_argument("--bucket", default="manifest-inventory")
    parser.add_argument("--source-prefix", default="Key Manifest/")
    parser.add_argument("--target-prefix", default="Key Manifest Thumbnails/")
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--max-dimension", type=int, default=1600)
    parser.add_argument("--quality", type=int, default=85)
    parser.add_argument("--max-source-mb", type=int, default=200)
    parser.add_argument("--max-pixels", type=int, default=200_000_000)
    parser.add_argument("--overwrite", action="store_true")
    # CORRECTION: required by run-tiff-thumbnail-job-safe.sh.
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="Only generate thumbnails that do not already exist",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    s3 = boto3.client("s3")
    keys = list(list_tiffs(s3, args.bucket, args.source_prefix))
    total = len(keys)
    logger.info("Found %d TIFF files under s3://%s/%s", total, args.bucket, args.source_prefix)

    counts = {"created": 0, "skipped": 0, "planned": 0, "failed": 0}

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {executor.submit(process_one, key, args): key for key in keys}
        for index, future in enumerate(as_completed(futures), 1):
            key = futures[future]
            try:
                status, source, target = future.result()
                counts[status] = counts.get(status, 0) + 1
                logger.info("[%d/%d] %s: %s -> %s", index, total, status, source, target)
            except Exception:
                counts["failed"] += 1
                logger.exception("[%d/%d] failed: %s", index, total, key)

    logger.info(
        "Finished: created=%d skipped=%d planned=%d failed=%d total=%d",
        counts["created"],
        counts["skipped"],
        counts["planned"],
        counts["failed"],
        total,
    )


if __name__ == "__main__":
    main()
