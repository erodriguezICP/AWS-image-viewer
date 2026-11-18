#!/usr/bin/env python3

"""
Generate JPEG thumbnails from TIFF objects stored in Amazon S3.

Behavior:
- With --missing-only, lists source TIFFs and existing JPG/JPEG thumbnails,
  then queues only TIFFs whose expected JPG is absent.
- Excludes macOS /.AppleDouble/ metadata objects.
- Checks S3 ContentLength before reading an object into memory.
- Skips sources larger than --max-source-mb.
- Skips images larger than --max-pixels.
- Skips decompression-bomb and unreadable-image errors.
- Logs the exact object, file size, decode start, and image dimensions.
- Continues after an individual file failure.
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
    """Return True if an S3 object exists."""
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True

    except ClientError as exc:
        status = exc.response.get(
            "ResponseMetadata", {}
        ).get("HTTPStatusCode")

        code = exc.response.get(
            "Error", {}
        ).get("Code")

        if status == 404 or code in (
            "404",
            "NoSuchKey",
            "NotFound",
        ):
            return False

        raise


def target_key_for(
    source_key,
    source_prefix,
    target_prefix,
):
    """
    Convert:

    Key Manifest/folder/image.tif

    to:

    Key Manifest Thumbnails/folder/image.jpg
    """

    if source_key.startswith(source_prefix):
        relative = source_key[len(source_prefix):]
    else:
        relative = source_key

    relative = relative.lstrip("/")

    path = PurePosixPath(relative)

    return (
        f"{target_prefix.rstrip('/')}/"
        f"{path.with_suffix
