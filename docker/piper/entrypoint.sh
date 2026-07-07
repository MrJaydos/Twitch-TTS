#!/bin/sh
# Download the configured Piper voices (if missing) then start the HTTP server.
set -e

DATA_DIR="${DATA_DIR:-/data}"
DEFAULT_VOICE="${DEFAULT_VOICE:-en_US-amy-medium}"
VOICES="${PIPER_VOICES:-$DEFAULT_VOICE}"

mkdir -p "$DATA_DIR"

OLDIFS="$IFS"
IFS=','
for v in $VOICES; do
  # trim surrounding whitespace
  v="$(printf '%s' "$v" | tr -d '[:space:]')"
  [ -z "$v" ] && continue
  if [ ! -f "$DATA_DIR/$v.onnx" ]; then
    echo "[piper] downloading voice: $v"
    python3 -m piper.download_voices "$v" --data-dir "$DATA_DIR" \
      || echo "[piper] WARNING: failed to download $v"
  else
    echo "[piper] voice present: $v"
  fi
done
IFS="$OLDIFS"

echo "[piper] starting HTTP server (default voice: $DEFAULT_VOICE)"
exec python3 -m piper.http_server \
  -m "$DEFAULT_VOICE" \
  --data-dir "$DATA_DIR" \
  --host 0.0.0.0 \
  --port 5000
