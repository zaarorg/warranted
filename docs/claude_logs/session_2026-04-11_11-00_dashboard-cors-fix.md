# Session Log: Fix Dashboard CORS NetworkError

**Date:** 2026-04-11 ~11:00 AM
**Duration:** ~15 minutes
**Focus:** Diagnose and fix `TypeError: NetworkError when attempting to fetch resource` in the admin dashboard

## What Got Done

- Identified root cause of browser `NetworkError` on all dashboard API calls
- Added `cors()` middleware from `hono/cors` to `apps/api/src/index.ts`
- Verified all 370 tests across 26 test files still pass
- Verified CORS headers present on both OPTIONS preflight and GET requests via curl
- Committed fix: `dcda531 fix(api): add CORS middleware to resolve dashboard cross-origin fetch errors`

## Issues & Troubleshooting

- **Problem:** Dashboard pages (`/policies`, `/agents`, `/groups`, `/petitions`) all showed `TypeError: NetworkError when attempting to fetch resource` in the browser console. Pages loaded but displayed no data.
- **Cause:** The Next.js dashboard dev server started on port 3001 (because the Hono API server was already on port 3000). The dashboard's `apiFetch()` in `src/lib/api.ts` defaults to `http://localhost:3000` as the API base URL. The browser blocked these cross-origin requests (`localhost:3001` -> `localhost:3000`) because the API server had no CORS middleware — no `Access-Control-Allow-Origin` header was sent.
- **Fix:** Added two lines to `apps/api/src/index.ts`:
  ```typescript
  import { cors } from "hono/cors";
  // ...
  app.use("/*", cors());
  ```
  This uses Hono's built-in CORS middleware with default settings (`Access-Control-Allow-Origin: *`), which is appropriate for a dev/internal API that authenticates via JWT rather than cookies.

- **Problem (minor):** The codebase-memory-mcp hook blocked initial `Read` and `Grep` calls, requiring use of `mcp__codebase-memory-mcp__search_code` for code discovery before falling back to direct tools.
- **Cause:** A user-configured hook (`cbm-code-discovery-gate`) enforces using the knowledge graph MCP tools before raw file reads.
- **Fix:** Used `search_code` from the codebase-memory MCP to discover the API entry point and dashboard fetch code, which provided all necessary context.

## Decisions Made

- **Used `cors()` with defaults (allow all origins)** rather than restricting to `localhost:3001` — the API uses JWT auth (not cookies), so CORS origin restriction adds no security value here. The security rules in `.claude/rules/security.md` also note: "Storefront SDK endpoints: Allow all origins (agents can come from anywhere). Auth is via JWT, not cookies."
- **Did not set `NEXT_PUBLIC_API_URL` env var** — the default `http://localhost:3000` is correct; the issue was missing CORS headers on the server side, not a wrong URL on the client side.

## Current State

- The API server (`apps/api`) now serves CORS headers on all routes
- Dashboard should work without `NetworkError` once the API server is restarted with the new code
- All tests pass (370/370)
- Pre-existing typecheck errors in `apps/dashboard` (JSX flag and `@/lib/utils` module resolution) remain — these are unrelated to this fix and appear to be a dashboard tsconfig issue
- Branch: `feat/integrated-rules-engine`

## Next Steps

- Restart the API server to pick up the CORS fix (`cd apps/api && bun run dev`)
- Restart the dashboard (`cd apps/dashboard && bun run dev`) and verify all pages load data
- Investigate and fix the pre-existing dashboard typecheck errors (`Cannot use JSX unless '--jsx' flag is provided`, `Cannot find module '@/lib/utils'`)
- Consider adding a root-level `dev` script to `package.json` that starts both the API and dashboard concurrently (e.g., using `concurrently` or `turbo`)
