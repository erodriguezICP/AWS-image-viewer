#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/AWS-image-viewer"

VENV=".venv-tiff-thumbnails"
PYTHON="$VENV/bin/python"
SCRIPT="generate_tiff_thumbnails.py"
LOG="tiff-thumbnail-safe.log"
PIDFILE="tiff-thumbnail-safe.pid"

WORKERS="${WORKERS:-3}"
MAX_SOURCE_MB="${MAX_SOURCE_MB:-200}"
MAX_PIXELS="${MAX_PIXELS:-100000000}"

if [[ ! -x "$PYTHON" ]]; then
  echo "ERROR: virtual environment Python not found: $PYTHON" >&2
  exit 1
fi

if [[ ! -f "$SCRIPT" ]]; then
  echo "ERROR: $SCRIPT not found" >&2
  exit 1
fi

if pgrep -f '[g]enerate_tiff_thumbnails.py' >/dev/null; then
  echo "ERROR: a TIFF thumbnail job is already running. Refusing to start a duplicate." >&2
  pgrep -af '[g]enerate_tiff_thumbnails.py' || true
  exit 1
fi

"$PYTHON" -c 'from PIL import Image; import boto3; print("Dependencies OK")'
"$PYTHON" -m py_compile "$SCRIPT"

if ! "$PYTHON" "$SCRIPT" --help 2>&1 | grep -q -- '--max-source-mb'; then
  echo "ERROR: $SCRIPT does not support --max-source-mb" >&2
  exit 1
fi

if "$PYTHON" "$SCRIPT" --help 2>&1 | grep -q -- '--max-pixels'; then
  PIXEL_ARGS=(--max-pixels "$MAX_PIXELS")
  echo "Pixel guard enabled: $MAX_PIXELS pixels"
else
  PIXEL_ARGS=()
  echo "WARNING: $SCRIPT does not yet support --max-pixels." >&2
  echo "This launcher cannot enforce a pixel limit by itself; the Python converter must implement it." >&2
  exit 2
fi

echo "Starting TIFF thumbnail job"
echo "Workers: $WORKERS"
echo "Maximum source size: $MAX_SOURCE_MB MB"
echo "Maximum pixels: $MAX_PIXELS"
echo "Log: $LOG"

nohup "$PYTHON" "$SCRIPT" \
  --workers "$WORKERS" \
  --max-source-mb "$MAX_SOURCE_MB" \
  "${PIXEL_ARGS[@]}" \
  > "$LOG" 2>&1 &

PID=$!
echo "$PID" > "$PIDFILE"
echo "Started PID $PID"
echo "Monitor: tail -f $LOG"
echo "Status: ps -p $PID -o pid,etime,%cpu,%mem,rss,cmd"
