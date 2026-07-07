#!/bin/sh
# Sync the database schema, then start the app.
set -e

# Prefer an explicit DATABASE_URL (e.g. a separate/managed Postgres resource).
# Fall back to deriving one from POSTGRES_* for the bundled compose DB (ttsdb).
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

# Wait for Postgres to accept the schema push (it may still be starting).
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
