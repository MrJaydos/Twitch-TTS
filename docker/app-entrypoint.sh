#!/bin/sh
# Sync the database schema, then start the app.
set -e

# Derive DATABASE_URL from Postgres parts if it wasn't injected directly.
# (Some compose/host setups don't pass interpolated env into the container.)
if [ -z "$DATABASE_URL" ]; then
  DB_HOST="${POSTGRES_HOST:-postgres}"
  DB_USER="${POSTGRES_USER:-tts}"
  DB_PASS="${POSTGRES_PASSWORD:-tts}"
  DB_NAME="${POSTGRES_DB:-tts}"
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:5432/${DB_NAME}?schema=public"
  echo "[app] DATABASE_URL not set; derived postgresql://${DB_USER}:***@${DB_HOST}:5432/${DB_NAME}"
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
