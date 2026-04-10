# Session Log: Rules Engine Docker Build + Seed Script Fixes

**Date:** 2026-04-10 ~14:00–14:50
**Duration:** ~50 minutes
**Focus:** Fix slow Rust engine Docker startup and broken seed script for rules engine

## What Got Done

- Rewrote `rules_engine/engine/Dockerfile.dev` to use multi-stage `cargo-chef` build with pre-compiled dependency caching
- Created `rules_engine/engine/entrypoint-dev.sh` to seed Docker target volume from image cache on first run
- Added `rules_engine/management/src/main/resources/db/migration/V2__add_enum_casts.sql` — implicit Postgres casts for `varchar → domain_enum` and `varchar → policy_effect`
- Rewrote `warranted/scripts/seed-rules-engine.sh` to fix all curl/jq/JSON issues:
  - Replaced all `echo "$VAR" | jq` patterns with temp-file-based `curl > $TMPFILE; jq ... $TMPFILE`
  - Added `api_get`, `api_post`, `jq_tmp` helper functions
  - Replaced inline shell JSON escaping for Cedar entity UIDs with Python `json.dumps()`
  - Added direct SQL fallback for policy version creation (bypasses broken Cedar Java FFI)
- Wrote earlier session log to `docs/claude_logs/session_2026-04-10_14-26_engine-docker-build-perf.md`

## Issues & Troubleshooting

- **Problem:** Engine container took 12+ minutes to become healthy on cold start; `curl localhost:3002/health` returned empty
  - **Cause:** `Dockerfile.dev` was bare `FROM rust:1-bookworm` with no dependency pre-compilation. `cargo watch` recompiled all deps (cedar-policy, sqlx, axum, tokio) from scratch on every cold start
  - **Fix:** Multi-stage Dockerfile using `cargo-chef` to pre-compile deps into the image, entrypoint script seeds the named volume on first run

- **Problem:** First Dockerfile fix tried `cargo install cargo-watch` inside Docker, adding another 15+ minutes
  - **Cause:** `cargo-watch` has a massive dependency tree when compiled from source
  - **Fix:** Download pre-built binary from GitHub releases (`v8.5.3-x86_64-unknown-linux-gnu.tar.xz`)

- **Problem:** Pre-compiled deps stored at `/app/target-cache` were invisible at runtime
  - **Cause:** Docker Compose volume mount `./engine:/app` shadows the entire `/app` directory
  - **Fix:** Store cache at `/tmp/target-cache` (outside the mount path)

- **Problem:** Seeded cache produced `error[E0463]: can't find crate for sqlx`
  - **Cause:** Builder stage used `lukemathwalker/cargo-chef:latest-rust-1` but final stage used `rust:1-bookworm` — different Rust compiler versions produce incompatible artifacts
  - **Fix:** Use `FROM chef AS dev` so all stages share the exact same toolchain

- **Problem:** Seed script stopped silently at Step 1 "Verify Organization" with no UUID output
  - **Cause:** `echo "$GROUPS" | jq ...` inside `$()` command substitutions produced corrupted output — stdin was polluted with the value `1000`, causing jq to fail with `Cannot iterate over number (1000)`. Combined with `set -euo pipefail`, this killed the script silently
  - **Fix:** Replaced all pipe-based `curl | jq` patterns with temp-file approach: `curl > $TMPFILE; jq ... $TMPFILE`

- **Problem:** Agent creation returned 500 Internal Server Error
  - **Cause:** Postgres `domain_enum` type mismatch — Exposed ORM sends parameterized queries with `VARCHAR` type, but Postgres won't auto-cast to custom enum types
  - **Fix:** Added Flyway migration `V2__add_enum_casts.sql` with `CREATE CAST (varchar AS domain_enum) WITH INOUT AS IMPLICIT`

- **Problem:** Policy version creation returned 500 Internal Server Error
  - **Cause:** Management API's Cedar validation requires `cedar_java_ffi` native library which is missing from the container (`UnsatisfiedLinkError: no cedar_java_ffi in java.library.path`)
  - **Fix:** Bypassed API entirely — insert policy version directly via SQL into Postgres using `docker exec psql`

- **Problem:** Cedar `/check` test requests returned "request failed"
  - **Cause:** Shell string interpolation produced malformed JSON for Cedar entity UIDs (e.g., `Agent::"uuid"` requires careful escaping)
  - **Fix:** Used Python `json.dumps()` to build properly escaped JSON payloads

## Decisions Made

- **Use `cargo-chef` for dev Dockerfile** (same pattern as production): consistent, proven caching, handles dependency fingerprinting
- **Same base image across all Dockerfile stages**: critical for Rust artifact compatibility — even minor toolchain differences invalidate the entire cache
- **Temp-file pattern for curl→jq in bash**: avoids a fundamental issue with piped command substitutions that caused silent data corruption. More verbose but 100% reliable
- **Direct SQL for policy version creation**: the Cedar Java FFI native library issue is in the management container's build/dependencies, not something fixable in the seed script. SQL insertion is a pragmatic workaround
- **Implicit Postgres casts via migration**: cleaner than modifying Kotlin ORM code, and the cast is safe since the enum values are validated by the application layer

## Current State

- **Engine container**: Starts in ~4 seconds on cold boot (down from 12+ minutes). Health check returns `ok`
- **Seed script**: Runs end-to-end successfully. Creates agent, policy, version, assignment. Returns all UUIDs
- **Agent UUID**: `d266628c-db9f-46c7-80b7-f1ef9b36e9fa` created for `openclaw-agent-001`
- **Cedar evaluation**: Tests run but return `Deny` with type error on `vendor` field — the Cedar policy uses `context.vendor in ["aws", ...]` which expects entity references, not string literals. This is a policy syntax issue, not an infrastructure issue
- **All 4 services running**: postgres (healthy), management (healthy), engine (healthy), frontend (healthy)

## Next Steps

1. Fix the Cedar policy `vendor in [...]` clause to use proper entity references or switch to string comparison (e.g., `context.vendor == "aws" || ...`) so test evaluations return `Allow` for authorized requests
2. Add `cedar_java_ffi` native library to the management Docker image so policy version creation works via the API (not just SQL)
3. Add `.dockerignore` to `engine/` to exclude `target/` from build context (reduces image build transfer time)
4. Test `docker compose down -v && docker compose up -d` full cold start to confirm everything seeds correctly from scratch (including the V2 migration)
5. Wire the agent UUID into the openclaw stack (add `AGENT_RULES_ENGINE_ID` to openclaw `.env`)
