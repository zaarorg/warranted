# Session Log: Fix rules-engine database schema missing from dev database

**Date:** 2026-04-11 ~10:15
**Duration:** ~15 minutes
**Focus:** Diagnose and fix "relation policies does not exist" error on dev server

## What Got Done

- Applied rules-engine schema (5 enums, 10 tables) to the `warranted_test` dev database via direct SQL
- Created idempotent migration script at `packages/rules-engine/scripts/migrate.ts` with `--seed` flag support
- Verified all 370 tests pass, typecheck passes, and API endpoints return correct responses
- Committed migration script: `fix(rules-engine): add idempotent migration script for dev database` (0e19b6a)

## Issues & Troubleshooting

- **Problem:** `curl http://localhost:3000/api/policies/rules` returned `Internal Server Error`. Dev server logs showed `PostgresError: relation "policies" does not exist`.
- **Cause:** The rules-engine test suite creates isolated PostgreSQL schemas per test run (via `setupTestDb()` in `packages/rules-engine/__tests__/helpers/db.ts`), but the actual `warranted_test` database used by the dev server had zero tables or enums. There was no migration or `db:push` mechanism configured for the rules-engine schema — only the test helper's raw SQL and the Drizzle ORM type definitions in `schema.ts`.
- **Fix:** Ran the full DDL (5 `CREATE TYPE` + 10 `CREATE TABLE` statements) directly against the dev database, then created a reusable migration script (`packages/rules-engine/scripts/migrate.ts`) that uses `IF NOT EXISTS` / `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object` for idempotency.

- **Problem:** Initial migration script placed at `scripts/migrate-rules-engine.ts` (project root) failed with `Cannot find package 'postgres'`.
- **Cause:** `postgres` is a devDependency of `packages/rules-engine`, not available at the project root's resolution scope.
- **Fix:** Moved script to `packages/rules-engine/scripts/migrate.ts` with relative imports to `../src/schema.js` and `../src/seed.js`.

## Decisions Made

- **Idempotent migration script over Drizzle `db:push`:** The project doesn't have `drizzle.config.ts` or migration infrastructure set up. Rather than introducing that complexity, a standalone script using the same raw SQL pattern as the test helper was simpler and consistent with the existing approach.
- **`IF NOT EXISTS` for all DDL:** Ensures the script can be re-run safely without dropping data — important since the dev database may accumulate data between sessions.
- **Optional `--seed` flag:** Keeps schema creation separate from data seeding so the script is useful for both fresh setups and existing databases.

## Current State

- Dev server (`bun run dev`) is running and all policy management API endpoints work:
  - `GET /api/policies/rules` → `{"success":true,"data":[]}`
  - `POST /api/policies/petitions` → 501 stub (as expected)
  - `GET /health` → `{"status":"ok"}`
- All 370 tests pass across 26 test files
- Typecheck passes
- Branch `feat/integrated-rules-engine` is 3 commits ahead of origin
- Database has empty tables (no seed data applied to dev db yet)

## Next Steps

- Run `bun run packages/rules-engine/scripts/migrate.ts --seed` to populate dev database with demo data (Acme Corp org, group hierarchy, 14 action types, 11 policies with Cedar source)
- Add `db:migrate` script to root `package.json` for convenience
- Push branch and consider PR for the integrated rules engine feature
- Implement petition endpoints (currently returning 501 stubs)
