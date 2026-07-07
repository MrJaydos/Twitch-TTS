#!/bin/sh
# Sync the database schema, then start the app.
set -e

echo "[app] applying database schema (prisma db push)..."
npx --no-install prisma db push --skip-generate --accept-data-loss

echo "[app] starting server..."
exec node dist/server.js
