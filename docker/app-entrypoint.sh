#!/bin/sh
# Start the bundled Piper TTS server, sync the DB schema, then start the app.
set -e

# ── Bundled Piper HTTP server (127.0.0.1:5000) ──────────────────────
VOICES_DIR="${PIPER_DATA_DIR:-/data/piper-voices}"
DEFAULT_VOICE="${DEFAULT_VOICE:-en_US-amy-medium}"
VOICES="${PIPER_VOICES:-$DEFAULT_VOICE}"
mkdir -p "$VOICES_DIR"

# Download any missing voices (best effort — server can still start).
OLDIFS="$IFS"
IFS=','
for v in $VOICES; do
  v="$(printf '%s' "$v" | tr -d '[:space:]')"
  [ -z "$v" ] && continue
  if [ ! -f "$VOICES_DIR/$v.onnx" ]; then
    echo "[piper] downloading voice: $v"
    python3 -m piper.download_voices "$v" --data-dir "$VOICES_DIR" \
      || echo "[piper] WARNING: failed to download $v"
  else
    echo "[piper] voice present: $v"
  fi
done
IFS="$OLDIFS"

# Run the Piper HTTP server in the background, restarting it if it crashes.
(
  while true; do
    echo "[piper] starting HTTP server on 127.0.0.1:5000 (default voice: $DEFAULT_VOICE)"
    python3 -m piper.http_server \
      -m "$DEFAULT_VOICE" \
      --data-dir "$VOICES_DIR" \
      --host 127.0.0.1 \
      --port 5000 || true
    echo "[piper] server exited; restarting in 3s"
    sleep 3
  done
) &

# ── Database ────────────────────────────────────────────────────────
# Prefer an explicit DATABASE_URL (e.g. a separate/managed Postgres resource).
if [ -n "$DATABASE_URL" ]; then
  echo "[app] using provided DATABASE_URL"
else
  DB_HOST="${POSTGRES_HOST:-ttsdb}"
  DB_USER="${POSTGRES_USER:-tts}"
  DB_PASS="${POSTGRES_PASSWORD:-tts}"
  DB_NAME="${POSTGRES_DB:-tts}"
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:5432/${DB_NAME}?schema=public"
  echo "[app] derived DATABASE_URL host=${DB_HOST} db=${DB_NAME}"
fi

echo "[app] applying database schema (prisma db push)..."
tries=0
until npx --no-install prisma db push --skip-generate --accept-data-loss; do
  tries=$((tries + 1))
  if [ "$tries" -ge 15 ]; then
    echo "[app] prisma db push failed after ${tries} attempts; giving up."
    exit 1
  fi
  echo "[app] database not ready, retrying in 3s (attempt ${tries})..."
  sleep 3
done

echo "[app] starting server..."
exec node dist/server.js
