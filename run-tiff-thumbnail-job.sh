#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .venv-tiff-thumbnails
source .venv-tiff-thumbnails/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-tiff-thumbnails.txt

# First verify the S3 mapping without writing objects.
python generate_tiff_thumbnails.py --dry-run --workers 4

echo
echo "Dry run finished. To create the JPEG derivatives, run:"
echo "source .venv-tiff-thumbnails/bin/activate"
echo "python generate_tiff_thumbnails.py --workers 4"
