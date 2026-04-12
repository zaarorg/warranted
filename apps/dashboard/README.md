# Warranted Dashboard

> **v0.1 — API may change.** Core exports are stable but details may shift before v1.0.

Admin dashboard for AI agent policy management. Visualize agent envelopes with full inheritance chains, test authorization decisions via the REPL, inspect Cedar source, and manage group hierarchies.

## Quick Start

### Deploy to Vercel

```bash
cd apps/dashboard
npx vercel --env NEXT_PUBLIC_API_URL=https://your-api.example.com
```

### Docker

```bash
docker run -p 3001:3001 warranted/dashboard
```

Requires a reverse proxy routing `/api/*` to the rules engine API.

### Local Development

```bash
cd apps/dashboard
bun install
bun run dev
# Dashboard: http://localhost:3001
# Requires API running on http://localhost:3000
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `""` (relative) | API URL. Empty = relative paths (needs reverse proxy). |
| `PORT` | No | `3001` | Port the dashboard listens on |

## Reverse Proxy

The dashboard makes client-side requests to `/api/*`. In production, a reverse proxy must route these to the rules engine API.

### Caddyfile

```
:80 {
  handle /api/* {
    reverse_proxy api:3000
  }
  handle /health {
    reverse_proxy api:3000
  }
  handle {
    reverse_proxy dashboard:3001
  }
}
```

### nginx

```nginx
server {
    listen 80;

    location /api/ {
        proxy_pass http://api:3000;
    }

    location /health {
        proxy_pass http://api:3000;
    }

    location / {
        proxy_pass http://dashboard:3001;
    }
}
```

### Cross-Origin

For deployments where the API and dashboard are on different domains, set `NEXT_PUBLIC_API_URL` to the full API URL (e.g., `https://api.warranted.example.com`).

## Pages

### Policies

Searchable policy table with filtering. Click a policy to see:
- **Constraints** tab — dimension constraints per action type
- **Cedar** tab — generated Cedar source code
- **History** tab — version history with diffs

### Agents

Agent list with envelope visualization. Click an agent to see:
- Resolved envelope with full inheritance chain
- Per-action dimensions showing which group contributed each constraint
- Authorization REPL — test decisions by entering vendor, amount, and category

### Groups

Tree view of the organizational hierarchy. Click a group to see:
- Group members (agents)
- Assigned policies
- Ancestor and descendant chains

### Petitions

Coming soon — self-service policy exception requests.

<!-- TODO: Add screenshot — policies list page -->
<!-- TODO: Add screenshot — agent envelope with inheritance chain -->
<!-- TODO: Add screenshot — REPL tester showing Allow result -->
<!-- TODO: Add screenshot — Cedar source viewer -->

## License

Apache-2.0
