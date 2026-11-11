#!/usr/bin/env python3

import argparse
import io
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Iterable

import boto3
from botocore.exceptions import ClientError
from PIL import Image, ImageOps


# ------------------------------------------------------------
# DEFAULT CONFIGURATION
# ------------------------------------------------------------

DEFAULT_BUCKET = "manifest-inventory"

DEFAULT_SOURCE_PREFIX = "Key Manifest/"

DEFAULT_DEST_PREFIX = "Key Manifest Thumbnails/"

TIFF_EXTENSIONS = (".tif", ".tiff")

JPEG_QUALITY = 85

THUMBNAIL_MAX_SIZE = 1200

DEFAULT_WORKERS = 4


# ------------------------------------------------------------
# IMPORTANT:
# Protect CloudShell from very large TIFF files.
#
# Files larger than this are SKIPPED BEFORE THEY ARE DOWNLOADED.
# ------------------------------------------------------------

MAX_SOURCE_SIZE_MB = 200
MAX_SOURCE_SIZE_BYTES = MAX_SOURCE_SIZE_MB * 1024 * 1024


@dataclass(frozen=True)
class Settings:
    bucket: str
    source_prefix: str
    dest_prefix: str
    workers: int
    max_source_mb: int
    dry_run: bool = False

    @property
    def max_source_bytes(self) -> int:
        return self.max_source_mb * 1024 * 1024


# ------------------------------------------------------------
# LOGGING
# ------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

logger = logging.getLogger(__name__)


# ------------------------------------------------------------
# S3 HELPERS
# ------------------------------------------------------------

def normalize_prefix(prefix: str) -> str:
    if prefix and not prefix.endswith("/"):
        return prefix + "/"
    return prefix


def destination_key(source_key: str, settings: Settings) -> str:
    """
    Convert:

        Key Manifest/folder/image.tif

    into:

        Key Manifest Thumbnails/folder/image.jpg
    """

    source_prefix = normalize_prefix(settings.source_prefix)
    dest_prefix = normalize_prefix(settings.dest_prefix)

    if source_key.startswith(source_prefix):
        relative = source_key[len(source_prefix):]
    else:
        relative = source_key

    root, _ = os.path.splitext(relative)

    return f"{dest_prefix}{root}.jpg"


def object_exists(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(
            Bucket=bucket,
            Key=key,
        )
        return True

    except ClientError as exc:
        error_code = exc.response.get(
            "Error", {}
        ).get(
            "Code", ""
        )

        if error_code in (
            "404",
            "NoSuchKey",
            "NotFound",
        ):
            return False

        raise


# ------------------------------------------------------------
# TIFF DISCOVERY
# ------------------------------------------------------------

def iter_tiff_keys(
    s3,
    settings: Settings,
) -> Iterable[str]:
    """
    Enumerate TIFF objects.

    CRITICAL:
    Oversized files are filtered here, before workers download
    them or Pillow attempts to decompress them.
    """

    paginator = s3.get_paginator("list_objects_v2")

    for page in paginator.paginate(
        Bucket=settings.bucket,
        Prefix=settings.source_prefix,
        PaginationConfig={
            "PageSize": 1000,
        },
    ):

        for item in page.get("Contents", []):

            key = item["Key"]

            if not key.lower().endswith(TIFF_EXTENSIONS):
                continue

            # ------------------------------------------------
            # LARGE-TIFF PROTECTION
            # ------------------------------------------------

            size = item.get("Size", 0)

            if size > settings.max_source_bytes:

                logger.warning(
                    "Skipping oversized TIFF: %s (%.1f MB > %d MB limit)",
                    key,
                    size / (1024 * 1024),
                    settings.max_source_mb,
                )

                continue

            yield key


# ------------------------------------------------------------
# CONVERSION
# ------------------------------------------------------------

def convert_tiff_to_jpeg(
    s3,
    source_key: str,
    settings: Settings,
):
    """
    Download TIFF into memory, resize it and upload a JPEG
    derivative.
    """

    target_key = destination_key(
        source_key,
        settings,
    )

    # --------------------------------------------------------
    # Don't recreate thumbnails that already exist
    # --------------------------------------------------------

    if object_exists(
        s3,
        settings.bucket,
        target_key,
    ):

        return (
            "skipped",
            source_key,
            target_key,
        )

    if settings.dry_run:

        return (
            "planned",
            source_key,
            target_key,
        )

    try:

        response = s3.get_object(
            Bucket=settings.bucket,
            Key=source_key,
        )

        source_bytes = response["Body"].read()

        with Image.open(
            io.BytesIO(source_bytes)
        ) as image:

            # Apply EXIF orientation if present
            image = ImageOps.exif_transpose(image)

            # ------------------------------------------------
            # TIFFs can have modes JPEG doesn't support.
            # Convert them safely to RGB.
            # ------------------------------------------------

            if image.mode not in (
                "RGB",
                "L",
            ):
                image = image.convert("RGB")

            elif image.mode == "L":
                image = image.convert("RGB")

            # ------------------------------------------------
            # Resize while keeping aspect ratio
            # ------------------------------------------------

            image.thumbnail(
                (
                    THUMBNAIL_MAX_SIZE,
                    THUMBNAIL_MAX_SIZE,
                ),
                Image.Resampling.LANCZOS,
            )

            output = io.BytesIO()

            image.save(
                output,
                format="JPEG",
                quality=JPEG_QUALITY,
                optimize=True,
            )

            output.seek(0)

        # Release the original TIFF bytes before upload
        del source_bytes

        s3.put_object(
            Bucket=settings.bucket,
            Key=target_key,
            Body=output.getvalue(),
            ContentType="image/jpeg",
            CacheControl="public, max-age=31536000",
        )

        output.close()

        return (
            "created",
            source_key,
            target_key,
        )

    except Exception as exc:

        logger.exception(
            "Failed converting %s: %s",
            source_key,
            exc,
        )

        return (
            "failed",
            source_key,
            target_key,
        )


# ------------------------------------------------------------
# COMMAND-LINE ARGUMENTS
# ------------------------------------------------------------

def parse_args():

    parser = argparse.ArgumentParser(
        description=(
            "Generate JPG thumbnails from TIFF files stored in S3."
        )
    )

    parser.add_argument(
        "--bucket",
        default=DEFAULT_BUCKET,
        help="S3 bucket name",
    )

    parser.add_argument(
        "--source-prefix",
        default=DEFAULT_SOURCE_PREFIX,
        help="S3 TIFF source prefix",
    )

    parser.add_argument(
        "--dest-prefix",
        default=DEFAULT_DEST_PREFIX,
        help="S3 JPEG destination prefix",
    )

    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help="Number of concurrent conversion workers",
    )

    parser.add_argument(
        "--max-source-mb",
        type=int,
        default=MAX_SOURCE_SIZE_MB,
        help=(
            "Skip TIFF files larger than this many MB "
            f"(default: {MAX_SOURCE_SIZE_MB})"
        ),
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be converted without creating files",
    )

    return parser.parse_args()


# ------------------------------------------------------------
# MAIN JOB
# ------------------------------------------------------------

def main():

    args = parse_args()

    settings = Settings(
        bucket=args.bucket,
        source_prefix=normalize_prefix(
            args.source_prefix
        ),
        dest_prefix=normalize_prefix(
            args.dest_prefix
        ),
        workers=max(1, args.workers),
        max_source_mb=max(
            1,
            args.max_source_mb,
        ),
        dry_run=args.dry_run,
    )

    logger.info(
        "Bucket: %s",
        settings.bucket,
    )

    logger.info(
        "Source: %s",
        settings.source_prefix,
    )

    logger.info(
        "Destination: %s",
        settings.dest_prefix,
    )

    logger.info(
        "Workers: %d",
        settings.workers,
    )

    logger.info(
        "Maximum TIFF size: %d MB",
        settings.max_source_mb,
    )

    if settings.dry_run:
        logger.info(
            "DRY RUN - no JPEGs will be created"
        )

    s3 = boto3.client("s3")

    # --------------------------------------------------------
    # Enumerate acceptable TIFFs.
    #
    # Files larger than max_source_mb are discarded HERE.
    # They never reach Pillow.
    # --------------------------------------------------------

    tiff_keys = list(
        iter_tiff_keys(
            s3,
            settings,
        )
    )

    total = len(tiff_keys)

    logger.info(
        "TIFF files eligible for processing: %d",
        total,
    )

    if total == 0:

        logger.info(
            "Nothing to process."
        )

        return 0

    counters = {
        "created": 0,
        "skipped": 0,
        "planned": 0,
        "failed": 0,
    }

    # --------------------------------------------------------
    # Run conversions concurrently
    # --------------------------------------------------------

    with ThreadPoolExecutor(
        max_workers=settings.workers
    ) as executor:

        futures = {
            executor.submit(
                convert_tiff_to_jpeg,
                s3,
                key,
                settings,
            ): key
            for key in tiff_keys
        }

        completed = 0

        for future in as_completed(futures):

            completed += 1

            source_key = futures[future]

            try:

                (
                    status,
                    source,
                    target,
                ) = future.result()

            except Exception:

                counters["failed"] += 1

        ger.exception(
                    "[%d/%d] failed: %s",
                    completed,
                    total,
                    source_key,
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
        (
            "Complete. "
            "created=%d "
            "skipped=%d "
            "planned=%d "
            "failed=%d"
        ),
        counters["created"],
        counters["skipped"],
        counters["planned"],
        counters["failed"],
    )

    return (
        1
        if counters["failed"]
        else 0
    )


if __name__ == "__main__":
    sys.exit(main())
