#!/bin/bash
set -e

echo "=== Warranted Packaging Verification ==="
PASS=0
FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

# 1. Build Docker images
echo ""
echo "--- Docker Builds ---"

if docker build -f sidecar/Dockerfile -t warranted/governance-sidecar:test . --no-cache > /dev/null 2>&1; then
  pass "Sidecar image builds"
else
  fail "Sidecar image build failed"
fi

if docker build -f apps/api/Dockerfile -t warranted/rules-engine-api:test . --no-cache > /dev/null 2>&1; then
  pass "API image builds"
else
  fail "API image build failed"
fi

if docker build -f apps/dashboard/Dockerfile -t warranted/dashboard:test . --no-cache > /dev/null 2>&1; then
  pass "Dashboard image builds"
else
  fail "Dashboard image build failed"
fi

# 2. npm pack verification
echo ""
echo "--- npm Pack ---"

SDK_PACK=$(cd packages/storefront-sdk && bun run build 2>/dev/null && npm pack --dry-run 2>&1)
if echo "$SDK_PACK" | grep -q "dist/index.js"; then
  pass "storefront-sdk pack includes dist/index.js"
else
  fail "storefront-sdk pack missing dist/index.js"
fi

ENGINE_PACK=$(cd packages/rules-engine && bun run build 2>/dev/null && npm pack --dry-run 2>&1)
if echo "$ENGINE_PACK" | grep -q "dist/index.js"; then
  pass "rules-engine pack includes dist/index.js"
else
  fail "rules-engine pack missing dist/index.js"
fi

# 3. Production compose (using test-tagged images)
echo ""
echo "--- Production Compose ---"

# Create temp .env for testing
cat > .env.test << 'ENVEOF'
POSTGRES_PASSWORD=test-password
ED25519_SEED=test-seed-verify
API_VERSION=test
SIDECAR_VERSION=test
DASHBOARD_VERSION=test
ENVEOF

if docker compose --env-file .env.test -f docker-compose.production.yml up -d 2>/dev/null; then
  pass "Production compose starts"

  # Wait for health
  sleep 10

  # Check API health
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    pass "API /health responds"
  else
    fail "API /health not responding"
  fi

  # Check API data
  if curl -sf http://localhost:3000/api/policies/rules > /dev/null 2>&1; then
    pass "API /api/policies/rules responds"
  else
    fail "API /api/policies/rules not responding"
  fi

  # Tear down
  docker compose --env-file .env.test -f docker-compose.production.yml down -v > /dev/null 2>&1
else
  fail "Production compose failed to start"
fi

rm -f .env.test

# 4. Summary
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
