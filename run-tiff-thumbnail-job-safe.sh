#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/AWS-image-viewer"

VENV=".venv-tiff-thumbnails"
PYTHON="$VENV/bin/python"
SCRIPT="generate_tiff_thumbnails.py"
LOG="tiff-thumbnail-safe.log"
PIDFILE="tiff-thumbnail-safe.pid"


# ============================================================
# ORIGINAL BLOCK:
#
# WORKERS="${WORKERS:-3}"
# MAX_SOURCE_MB="${MAX_SOURCE_MB:-200}"
# MAX_PIXELS="${MAX_PIXELS:-100000000}"
#
# UPDATED:
# Default workers changed from 3 to 1.
# 200 MB and 100,000,000-pixel protections are unchanged.
# ============================================================

WORKERS="${WORKERS:-1}"
MAX_SOURCE_MB="${MAX_SOURCE_MB:-200}"
MAX_PIXELS="${MAX_PIXELS:-100000000}"


echo "========================================"
echo "TIFF Missing-Only Thumbnail Job"
echo "========================================"


# ============================================================
# ORIGINAL BLOCK - UNCHANGED:
# Verify virtual environment Python.
# ============================================================

if [[ ! -x "$PYTHON" ]]; then
  echo "ERROR: virtual environment Python not found: $PYTHON" >&2
  exit 1
fi


# ============================================================
# ORIGINAL BLOCK - UNCHANGED:
# Verify generator exists.
# ============================================================

if [[ ! -f "$SCRIPT" ]]; then
  echo "ERROR: $SCRIPT not found" >&2
  exit 1
fi


# ============================================================
# ORIGINAL BLOCK:
#
# if pgrep -f '[g]enerate_tiff_thumbnails.py' >/dev/null; then
#   echo "ERROR: a TIFF thumbnail job is already running. Refusing to start a duplicate." >&2
#   pgrep -af '[g]enerate_tiff_thumbnails.py' || true
#   exit 1
# fi
#
# UPDATED:
# Same behavior, just clearer output.
# ============================================================

if pgrep -f '[g]enerate_tiff_thumbnails.py' >/dev/null; then
  echo "ERROR: a TIFF thumbnail job is already running." >&2
  echo "Refusing to start a duplicate." >&2

  pgrep -af '[g]enerate_tiff_thumbnails.py' || true

  exit 1
fi


# ============================================================
# ORIGINAL BLOCK - UNCHANGED:
#
# "$PYTHON" -c 'from PIL import Image; import boto3; print("Dependencies OK")'
#
# Verify Pillow and boto3.
# ============================================================

"$PYTHON" -c '
from PIL import Image
import boto3
print("Dependencies OK")
'


# ============================================================
# ORIGINAL BLOCK - UNCHANGED:
#
# "$PYTHON" -m py_compile "$SCRIPT"
#
# Refuse to start if Python contains a syntax error.
# ============================================================

"$PYTHON" -m py_compile "$SCRIPT"

echo "Python syntax OK"


# ============================================================
# ORIGINAL BLOCK:
#
# if ! "$PYTHON" "$SCRIPT" --help 2>&1 | grep -q -- '--max-source-mb'; then
#   echo "ERROR: $SCRIPT does not support --max-source-mb" >&2
#   exit 1
# fi
#
# UPDATED:
# Same protection, reformatted for readability.
# ============================================================

if ! "$PYTHON" "$SCRIPT" --help 2>&1 |
  grep -q -- '--max-source-mb'; then

  echo "ERROR: $SCRIPT does not support --max-source-mb" >&2
  exit 2
fi


# ============================================================
# ORIGINAL BLOCK:
#
# if "$PYTHON" "$SCRIPT" --help 2>&1 | grep -q -- '--max-pixels'; then
#   PIXEL_ARGS=(--max-pixels "$MAX_PIXELS")
#   echo "Pixel guard enabled: $MAX_PIXELS pixels"
# else
#   PIXEL_ARGS=()
#   echo "WARNING: $SCRIPT does not yet support --max-pixels." >&2
#   echo "This launcher cannot enforce a pixel limit by itself; the Python converter must implement it." >&2
#   exit 2
# fi
#
# UPDATED:
# Same 100,000,000-pixel safeguard.
# The launcher still refuses to run without it.
# ============================================================

if "$PYTHON" "$SCRIPT" --help 2>&1 |
  grep -q -- '--max-pixels'; then

  PIXEL_ARGS=(
    --max-pixels
    "$MAX_PIXELS"
  )

  echo "Pixel guard enabled: $MAX_PIXELS pixels"

else

  echo "ERROR: $SCRIPT does not support --max-pixels." >&2
  echo "Refusing to run without the pixel safety guard." >&2

  exit 2
fi


# ============================================================
# NEW BLOCK - THERE WAS NO ORIGINAL VERSION:
#
# Verify that generate_tiff_thumbnails.py has actually been
# updated to understand --missing-only.
#
# Without this check, adding --missing-only to the launcher
# would cause the Python process to fail immediately.
# ============================================================

if ! "$PYTHON" "$SCRIPT" --help 2>&1 |
  grep -q -- '--missing-only'; then

  echo "ERROR: $SCRIPT does not support --missing-only." >&2
  echo >&2
  echo "The TIFF job has NOT been started." >&2
  echo "Update generate_tiff_thumbnails.py first." >&2

  exit 2
fi


# ============================================================
# NEW BLOCK - THERE WAS NO ORIGINAL VERSION:
#
# Check the PID file as an additional duplicate-job safeguard.
#
# The earlier pgrep check remains above. This is a second
# protection against accidentally launching multiple jobs.
# ============================================================

if [[ -f "$PIDFILE" ]]; then

  OLD_PID="$(cat "$PIDFILE" 2>/dev/null || true)"

  if [[ -n "$OLD_PID" ]] &&
     kill -0 "$OLD_PID" 2>/dev/null; then

    echo "ERROR: PID $OLD_PID is still running." >&2
    echo "Refusing to start another TIFF job." >&2

    exit 1
  fi

  echo "Removing stale PID file."

  rm -f "$PIDFILE"
fi


echo
echo "Starting TIFF thumbnail job"
echo "----------------------------------------"
echo "Mode: MISSING JPG DERIVATIVES ONLY"
echo "Workers: $WORKERS"
echo "Maximum source size: $MAX_SOURCE_MB MB"
echo "Maximum pixels: $MAX_PIXELS"
echo "Log: $LOG"
echo


# ============================================================
# ORIGINAL JOB BLOCK:
#
# nohup "$PYTHON" "$SCRIPT" \
#   --workers "$WORKERS" \
#   --max-source-mb "$MAX_SOURCE_MB" \
#   "${PIXEL_ARGS[@]}" \
#   > "$LOG" 2>&1 &
#
#
# UPDATED JOB BLOCK:
#
# The ONLY behavioral argument added here is:
#
#   --missing-only
#
# This tells the updated Python generator to inventory
# existing JPG derivatives first and submit only TIFFs
# whose expected JPG does not exist.
#
# IMPORTANT:
#
# --overwrite is deliberately NOT included.
# ============================================================

nohup "$PYTHON" "$SCRIPT" \
  --workers "$WORKERS" \
  --max-source-mb "$MAX_SOURCE_MB" \
  "${PIXEL_ARGS[@]}" \
  --missing-only \
  > "$LOG" 2>&1 &


# ============================================================
# ORIGINAL BLOCK - UNCHANGED:
# Capture and save background PID.
# ============================================================

PID=$!

echo "$PID" > "$PIDFILE"


# ============================================================
# ORIGINAL OUTPUT:
#
# echo "Started PID $PID"
# echo "Monitor: tail -f $LOG"
# echo "Status: ps -p $PID -o pid,etime,%cpu,%mem,rss,cmd"
#
# UPDATED:
# Same information plus additional monitoring command.
# ============================================================

echo
echo "Job started successfully."
echo "PID: $PID"
echo

echo "Monitor:"
echo "  tail -f $LOG"
echo

echo "Status:"
echo "  ps -p $PID -o pid,etime,%cpu,%mem,rss,cmd"
echo

echo "Check Python converter:"
echo "  ps aux | grep '[g]enerate_tiff_thumbnails'"
echo

echo "IMPORTANT:"
echo "Do not launch another TIFF job while PID $PID is running."
echo "========================================"
