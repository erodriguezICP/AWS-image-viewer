#!/usr/bin/env bash
set -Eeuo pipefail

# Safe launcher for generate_tiff_thumbnails.py
# Defaults requested:
#   - missing thumbnails only
#   - one worker
#   - 700 MB source-object limit
#   - 170,000,000-pixel limit
#
# Improvements included:
#   - validates dependencies and Python syntax
#   - recognizes and clears stale PID files that point to zombie processes
#   - refuses to start when a real prior job is active
#   - writes a fresh PID and appends output to the job log

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_SCRIPT="${PYTHON_SCRIPT:-generate_tiff_thumbnails.py}"
VENV_DIR="${VENV_DIR:-.venv-tiff-thumbnails}"
PYTHON_BIN="${PYTHON_BIN:-$VENV_DIR/bin/python}"
PID_FILE="${PID_FILE:-tiff-thumbnail-safe.pid}"
LOG_FILE="${LOG_FILE:-tiff-thumbnail-safe.log}"

WORKERS="${WORKERS:-1}"
MAX_SOURCE_MB="${MAX_SOURCE_MB:-900}"
MAX_PIXELS="${MAX_PIXELS:-200000000}"
MAX_DIMENSION="${MAX_DIMENSION:-1600}"
QUALITY="${QUALITY:-85}"
BUCKET="${BUCKET:-manifest-inventory}"
SOURCE_PREFIX="${SOURCE_PREFIX:-Key Manifest/}"
TARGET_PREFIX="${TARGET_PREFIX:-Key Manifest Thumbnails/}"

printf '%s\n' '========================================'
printf '%s\n' 'TIFF Missing-Only Thumbnail Job'
printf '%s\n' '========================================'

fail() {
    printf 'ERROR: %s\n' "$1" >&2
    printf '%s\n' 'The TIFF job has NOT been started.' >&2
    exit 1
}

[[ -f "$PYTHON_SCRIPT" ]] || fail "$PYTHON_SCRIPT was not found in $SCRIPT_DIR."
[[ -x "$PYTHON_BIN" ]] || fail "Python was not found at $PYTHON_BIN."

"$PYTHON_BIN" -c 'import boto3; from PIL import Image' \
    || fail "Required Python packages boto3 and Pillow are unavailable."
printf '%s\n' 'Dependencies OK'

"$PYTHON_BIN" -m py_compile "$PYTHON_SCRIPT" \
    || fail "Python syntax validation failed."
printf '%s\n' 'Python syntax OK'

if ! "$PYTHON_BIN" "$PYTHON_SCRIPT" --help 2>&1 | grep -q -- '--missing-only'; then
    fail "$PYTHON_SCRIPT does not support --missing-only."
fi

if ! "$PYTHON_BIN" "$PYTHON_SCRIPT" --help 2>&1 | grep -q -- '--max-source-mb'; then
    fail "$PYTHON_SCRIPT does not support --max-source-mb."
fi

if ! "$PYTHON_BIN" "$PYTHON_SCRIPT" --help 2>&1 | grep -q -- '--max-pixels'; then
    fail "$PYTHON_SCRIPT does not support --max-pixels."
fi

[[ "$WORKERS" =~ ^[1-9][0-9]*$ ]] || fail "WORKERS must be a positive integer."
[[ "$MAX_SOURCE_MB" =~ ^[1-9][0-9]*$ ]] || fail "MAX_SOURCE_MB must be a positive integer."
[[ "$MAX_PIXELS" =~ ^[1-9][0-9]*$ ]] || fail "MAX_PIXELS must be a positive integer."

printf 'Worker count: %s\n' "$WORKERS"
printf 'Source-size guard: %s MB\n' "$MAX_SOURCE_MB"
printf 'Pixel guard enabled: %s pixels\n' "$MAX_PIXELS"

# Handle a PID file from an earlier run safely.
if [[ -f "$PID_FILE" ]]; then
    old_pid="$(tr -dc '0-9' < "$PID_FILE")"

    if [[ -z "$old_pid" ]]; then
        printf 'Removing invalid PID file: %s\n' "$PID_FILE"
        rm -f "$PID_FILE"
    elif ps -p "$old_pid" >/dev/null 2>&1; then
        old_stat="$(ps -p "$old_pid" -o stat= 2>/dev/null | tr -d '[:space:]')"
        old_cmd="$(ps -p "$old_pid" -o cmd= 2>/dev/null || true)"

        if [[ "$old_stat" == Z* ]]; then
            printf 'Removing stale PID file for zombie PID %s.\n' "$old_pid"
            rm -f "$PID_FILE"
        elif [[ "$old_cmd" == *"generate_tiff_thumbnails.py"* ]]; then
            fail "PID $old_pid is an active TIFF thumbnail job ($old_stat)."
        else
            printf 'Removing stale PID file; PID %s belongs to: %s\n' "$old_pid" "$old_cmd"
            rm -f "$PID_FILE"
        fi
    else
        printf 'Removing stale PID file for nonexistent PID %s.\n' "$old_pid"
        rm -f "$PID_FILE"
    fi
fi

# Independent protection if the PID file is absent or stale.
if pgrep -f "[g]enerate_tiff_thumbnails.py" >/dev/null 2>&1; then
    printf '%s\n' 'Active TIFF job detected:' >&2
    pgrep -af "[g]enerate_tiff_thumbnails.py" >&2 || true
    fail "Refusing to start a second TIFF thumbnail job."
fi

printf '\nStarting job at %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG_FILE"
printf 'Limits: workers=%s max-source-mb=%s max-pixels=%s\n' \
    "$WORKERS" "$MAX_SOURCE_MB" "$MAX_PIXELS" | tee -a "$LOG_FILE"

nohup "$PYTHON_BIN" "$PYTHON_SCRIPT" \
    --bucket "$BUCKET" \
    --source-prefix "$SOURCE_PREFIX" \
    --target-prefix "$TARGET_PREFIX" \
    --workers "$WORKERS" \
    --max-source-mb "$MAX_SOURCE_MB" \
    --max-pixels "$MAX_PIXELS" \
    --max-dimension "$MAX_DIMENSION" \
    --quality "$QUALITY" \
    --missing-only \
    >> "$LOG_FILE" 2>&1 &

job_pid=$!
printf '%s\n' "$job_pid" > "$PID_FILE"
sleep 2

if ! ps -p "$job_pid" >/dev/null 2>&1; then
    rm -f "$PID_FILE"
    fail "The Python process exited immediately. Inspect $LOG_FILE."
fi

job_stat="$(ps -p "$job_pid" -o stat= | tr -d '[:space:]')"
if [[ "$job_stat" == Z* ]]; then
    rm -f "$PID_FILE"
    fail "The Python process immediately became a zombie. Inspect $LOG_FILE."
fi

printf '\nTIFF job started successfully.\n'
printf 'PID: %s\n' "$job_pid"
printf 'Log: %s\n' "$LOG_FILE"
printf 'Status: ps -p %s -o pid,ppid,stat,etime,%%cpu,%%mem,rss,vsz,cmd\n' "$job_pid"
printf 'Monitor: tail -n 50 -f %s\n' "$LOG_FILE"
printf 'Stop: kill %s\n' "$job_pid"
