# Session Log: Fix Sidecar DNS Failure and SSRF-Blocked Skill Calls

**Date:** 2026-04-09 15:07
**Duration:** ~25 minutes
**Focus:** Resolve two sequential failures preventing the OpenClaw agent from reaching the warranted-identity governance sidecar.

## What Got Done

- Killed conflicting local `uvicorn` process (PID 115275) occupying port 8100 on the host
- Restarted `openclaw-warranted-sidecar-1` Docker container
- Added `restart: unless-stopped` to `warranted-sidecar` service in `openclaw/docker-compose.yml`
- Populated empty `sidecar/requirements.txt` with `fastapi` and `uvicorn`
- Rewrote `skills/warranted-identity/SKILL.md` (v0.1.0 → v0.2.0) from raw HTTP URL references to `curl` bash commands
- Synced updated skill to `~/.openclaw/skills/warranted-identity/SKILL.md`
- Verified all three sidecar endpoints respond correctly from within the Docker network

## Issues & Troubleshooting

- **Problem:** OpenClaw agent reported DNS lookup failure for `warranted-sidecar:8100`
- **Cause:** The `openclaw-warranted-sidecar-1` container had exited (code 255) with no restart policy, so Docker DNS stopped resolving the hostname on the `openclaw_default` network.
- **Fix:** Killed a local uvicorn process blocking port 8100, then restarted the container. Added `restart: unless-stopped` to docker-compose to prevent recurrence.

---

- **Problem:** After sidecar was running, the agent still couldn't use the skill — reported that `http://warranted-sidecar:8100` resolves to a private/internal address that is blocked.
- **Cause:** The skill's `SKILL.md` listed raw HTTP URLs (e.g., `GET http://warranted-sidecar:8100/check_identity`). The AI model attempted to fetch these directly via its built-in HTTP client, which blocks requests to private IP ranges (172.x.x.x) as SSRF protection. Other working OpenClaw skills (weather, trello) use `curl` bash commands instead, which execute inside the container with no such restriction.
- **Fix:** Rewrote `SKILL.md` to use `curl` commands in bash code blocks, matching the pattern used by other OpenClaw skills. Also added `metadata.openclaw.requires.bins: ["curl"]` and removed `jq` dependency (not installed in the gateway container).

---

- **Problem:** `sidecar/requirements.txt` was 0 bytes
- **Cause:** File was created but never populated. Docker Compose mounts the root `requirements.txt` over it at runtime, so the container still worked, but the file was misleading.
- **Fix:** Added `fastapi` and `uvicorn` (the server's direct imports).

## Decisions Made

- Used `curl` commands in the skill definition rather than attempting to configure SSRF allowlists or proxy routes. This matches the established pattern in other OpenClaw skills (weather, trello) and requires no infrastructure changes.
- Dropped `jq` from the skill's `requires` metadata since it's not installed in the OpenClaw gateway container. The raw JSON output from curl is sufficient for the agent to parse.
- Kept `sidecar/requirements.txt` minimal (fastapi, uvicorn only) since the Docker Compose volume mount overlays the root `requirements.txt` at runtime anyway.

## Current State

- `openclaw-warranted-sidecar-1` is running with `restart: unless-stopped` on the `openclaw_default` Docker network
- `openclaw-openclaw-gateway-1` is running and healthy
- All three sidecar endpoints verified working from inside the gateway container:
  - `GET /check_identity` — returns agent identity, DID, spending limit, authority chain
  - `POST /check_authorization` — validates vendor/amount/category against policy
  - `POST /sign_transaction` — signs authorized transaction payloads
- Skill definition updated to v0.2.0 with curl-based commands, synced to both source and installed locations

## Next Steps

- Start a new OpenClaw session and test the full agent workflow end-to-end: have the agent invoke the warranted-identity skill and complete check_identity → check_authorization → sign_transaction
- Investigate root cause of the original container crash (exit code 255)
- Consider building a proper Dockerfile for the sidecar to avoid ~30s pip install on every container restart
- Consider adding a healthcheck to the sidecar service in docker-compose
