#!/bin/bash
set -e

if [ -z "$SKIP_MIGRATE" ]; then
  echo "Running migrations..."
  bun run apps/api/src/migrate.ts
else
  echo "Skipping migrations (SKIP_MIGRATE is set)"
fi

if [ -z "$SKIP_SEED" ]; then
  echo "Seeding database..."
  bun run apps/api/src/seed-db.ts
else
  echo "Skipping seed (SKIP_SEED is set)"
fi

echo "Starting API server on port ${PORT:-3000}..."
bun run apps/api/src/index.ts
