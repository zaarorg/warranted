# Session Log: Fix Governance Sidecar 404 on Root Endpoint
**Date:** 2026-04-09 14:09
**Duration:** ~10 minutes
**Focus:** Fix the governance sidecar server returning 404 on GET /

## What Got Done
- Added a `GET /` root endpoint to `sidecar/server.py` that returns service name, status, and a list of available endpoints
- Verified all four endpoints return 200:
  - `GET /` -- service info
  - `GET /check_identity` -- agent identity and DID
  - `POST /check_authorization` -- spending policy validation
  - `POST /sign_transaction` -- transaction signing

## Issues & Troubleshooting

- **Problem:** `GET /` and `GET /favicon.ico` both returned 404 when hitting the sidecar at `http://0.0.0.0:8100`
- **Cause:** `sidecar/server.py` only defined three route handlers (`/check_identity`, `/check_authorization`, `/sign_transaction`) -- no root `/` route existed
- **Fix:** Added a `@app.get("/")` handler returning a JSON object with service name, status, and endpoint list

---

- **Problem:** After editing the file, `curl` still returned 404
- **Cause:** The old uvicorn process (pre-edit) was still bound to port 8100; the new process failed to start because the port was occupied
- **Fix:** Killed all `uvicorn sidecar.server:app` processes with `pkill`, then restarted the server, confirming port 8100 was free before testing

## Decisions Made
- Root endpoint returns a simple JSON service descriptor (name, status, endpoint list) rather than a redirect or HTML page, keeping it consistent with the API-style of the other endpoints
- No authentication was added to the root endpoint since the existing endpoints also have no auth layer

## Current State
- Sidecar server runs on port 8100 and responds correctly on all four endpoints
- The OpenClaw agent (running in Docker) references the sidecar at `http://host.docker.internal:8100` -- the root endpoint now responds, but the screenshot showed the agent was blocked from reaching the sidecar due to sandbox/network restrictions (`exec` environment restricted to sandbox mode, direct HTTP fetches to internal hosts blocked by policy). That network connectivity issue is separate from this fix.
- Branch: `feat/agent-governance-sidecar`
- Untracked files: `sidecar/__pycache__/`, `sidecar/server.py`

## Next Steps
- Resolve the network connectivity issue between the OpenClaw Docker agent and the host-running sidecar (sandbox policy blocks `host.docker.internal` access)
- Consider configuring `tools.exec.host` in OpenClaw config to route through gateway/non-sandbox mode, or deploy the sidecar inside Docker on the same network
- Commit the sidecar server changes
