# Session Log: Remove Seed Data & Add Organization Management UI

**Date:** 2026-04-12 ~00:06 - 03:07 UTC
**Duration:** ~3 hours
**Focus:** Remove hardcoded seed data (policies, org, groups) and replace with dashboard UI for creating organizations, members, and group hierarchies.

## What Got Done

- Removed all 11 seeded policies from `packages/rules-engine/src/seed.ts` (agent-spending-limit, hard-transaction-cap, approved-vendors, sanctioned-vendors, permitted-categories, hourly-rate-limit, daily-spend-ceiling, escalation-threshold, cooling-off-period, engineering-dept-spending, platform-team-spending)
- Removed policy-related constants (POLICY_*_ID, PV_*_ID) and Cedar generation imports from seed.ts
- Removed seeded organization (Acme Corp), group hierarchy (9 groups), and agent membership from seed.ts
- Created `seedTestOrg()` function so tests can still create org/group fixtures without polluting the production seed
- Created `apps/api/src/routes/policies/organizations.ts` with GET (list) and POST (create org + root group atomically) endpoints
- Updated `apps/dashboard/src/app/groups/page.tsx` — shows "Create Organization" dialog when no org exists, auto-generates slug from name
- Updated `apps/dashboard/src/app/policies/page.tsx` — fetches org dynamically from API instead of hardcoded `SEED_ORG_ID`
- Added `Organization` type to `apps/dashboard/src/lib/types.ts`
- Fixed Postgres data persistence by switching from `tmpfs` to named Docker volume in `docker-compose.demo.yml`
- Added "Add Member" button/dialog to group detail page Members tab
- Added "Add Child Group" button/dialog to group detail page Hierarchy tab
- Updated seed test (`packages/rules-engine/__tests__/seed.test.ts`) to verify no policies/org are seeded, and separately test `seedTestOrg()`
- Updated 5 other test files (envelope, cedar-eval, integration, entity-store, policies.test) to call `seedTestOrg(db)` after `seed(db)`
- Deleted seeded data from running database (policies, policy_versions, policy_assignments, organizations, groups, agent_group_memberships)
- Rebuilt and restarted API Docker container to pick up new routes

## Issues & Troubleshooting

- **Problem:** Dashboard showing "API error: 404" on groups and policies pages after adding organizations route
- **Cause:** The API runs inside a Docker container built from a Dockerfile. The container was running old code without the `/api/policies/organizations` route.
- **Fix:** Rebuilt the API container with `docker compose -f docker-compose.demo.yml build api` and restarted with `docker compose -f docker-compose.demo.yml up -d api`.

- **Problem:** Policies not persisting — data lost on container restart
- **Cause:** `docker-compose.demo.yml` used `tmpfs` for Postgres data directory (`/var/lib/postgresql/data`), which stores data in RAM only.
- **Fix:** Replaced `tmpfs` with a named Docker volume (`pgdata`). Verified data survives postgres and API container restarts.

- **Problem:** Dashboard dev server failing with `EADDRINUSE: address already in use :::3001`
- **Cause:** Previous Next.js process still holding port 3001.
- **Fix:** `kill $(lsof -ti :3001)` then restart.

- **Problem:** `sed` with `\n` not working for multi-line insertions in test files
- **Cause:** Basic `sed` on Linux doesn't expand `\n` in replacement strings the same way.
- **Fix:** Used `sed -i '/pattern/a\  new line'` (append after match) instead, and manual Edit tool fixes for remaining issues.

- **Problem:** `policies.test.ts` had literal `\n` in source from bad sed
- **Cause:** Earlier sed replacement inserted a literal backslash-n instead of a newline.
- **Fix:** Used the Edit tool to replace the literal `\n` with an actual newline.

- **Problem:** TypeScript error "Module '@warranted/rules-engine' has no exported member 'seedTestOrg'"
- **Cause:** The rules-engine package's dist/ was stale — needed to rebuild after adding the new export.
- **Fix:** Ran `bun run build` in `packages/rules-engine/` to regenerate dist files.

## Decisions Made

- **Keep org/group constants in seed.ts** — Even though org/groups are no longer seeded, the deterministic UUID constants (ORG_ID, ACME_GROUP_ID, etc.) are kept because they're widely imported by tests and API routes (check.ts, envelope.ts use ORG_ID as a default fallback). Removing them would require changing ~10+ files across tests and production code.
- **Separate `seedTestOrg()` from `seed()`** — The production `seed()` only creates action types and dimension definitions (global schema data). Tests that need org/groups call `seedTestOrg(db)` explicitly. This keeps the production seed clean while maintaining test convenience.
- **Org creation creates root group atomically** — The POST /organizations endpoint creates both the org and its root group (nodeType: "org") in a single database transaction. This prevents orphaned orgs without a group tree root.
- **Named volume over tmpfs for Postgres** — Switched to persistent storage for the demo compose. The tmpfs was originally for fast ephemeral dev, but with the shift to UI-created data, persistence is now required.

## Current State

- **Working:** Dashboard can create organizations (Groups page), create policies (Policies page), add members to groups, create child groups (departments/teams), assign policies to groups. All data persists across container restarts.
- **Deployed:** API and Postgres running via `docker-compose.demo.yml` with persistent volume. Dashboard running locally on port 3001.
- **Seed function:** Only seeds action types (14) and dimension definitions (32). No org, groups, policies, or agent memberships.
- **Tests:** All test files updated to use `seedTestOrg()`. Typecheck passes (pre-existing dashboard JSX and cedar-gen errors remain).

## Next Steps

- Run full test suite (`bun run test`) to verify all tests pass with the new seed/seedTestOrg split
- Consider adding delete/edit functionality for organizations in the dashboard
- Add agent registration flow in the Agents page (currently just a list view)
- Wire up the sidecar to use the dynamic org created via UI instead of relying on seed constants
- Consider adding validation on the group detail page to prevent creating "org" type children (only department/team should be children)
