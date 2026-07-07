#!/bin/sh
# Sync the database schema, then start the app.
set -e

# ALWAYS build DATABASE_URL from the Postgres parts, overriding any value the
# hosting platform may have injected. An injected DATABASE_URL can point at the
# wrong host (e.g. a stale "postgres" container) and cause auth failures — the
# bundled DB service is "ttsdb" with trust auth, so we force the app to use it.
DB_HOST="${POSTGRES_HOST:-ttsdb}"
DB_USER="${POSTGRES_USER:-tts}"
DB_PASS="${POSTGRES_PASSWORD:-tts}"
DB_NAME="${POSTGRES_DB:-tts}"
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:5432/${DB_NAME}?schema=public"
echo "[app] using database host=${DB_HOST} db=${DB_NAME} (DATABASE_URL forced)"

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
