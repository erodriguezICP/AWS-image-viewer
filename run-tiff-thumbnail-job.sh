#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ -d .venv-tiff-thumbnails ]; then
  source .venv-tiff-thumbnails/bin/activate
fi

python generate_tiff_thumbnails_skip_large.py \
  --workers 4 \
  --max-source-mb 200

