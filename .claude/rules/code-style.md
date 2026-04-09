# Code Style Rules

## TypeScript (Backend + SDKs)

### General
- TypeScript strict mode. No `any` — use `unknown` and narrow with Zod.
- Target ES2022+. Bun runtime features are fine.
- All exported functions and types get JSDoc comments. Skip for obvious internal helpers.
- Use explicit error returns or throw typed errors — no silent failures.
- Prefer `async/await` over raw Promises. Never mix patterns in the same function.

### Formatting
- Prettier via project config. No debate.
- Imports: bun/node builtins → third-party → local packages → local utils → types.
- Line length: 100 chars soft limit. Break long function signatures and object literals.

### Naming
- `camelCase` for functions, variables, parameters.
- `PascalCase` for types, interfaces, classes, components, enums.
- `SCREAMING_SNAKE_CASE` for constants and env vars.
- Acronyms stay consistent case: `JWT`, `DID`, `API`, `SDK`, `USDC` (not `Jwt`, `Did`).
- File names: `kebab-case.ts` for modules, `PascalCase.tsx` for React components.
- Package names are short, singular, lowercase: `registry`, `engine`, `ledger`.

### Error Handling
- Use typed error classes extending `Error` for domain errors:
  ```typescript
  class AuthorizationDeniedError extends Error {
    constructor(public reason: string, public agentDid: string) {
      super(`Authorization denied for ${agentDid}: ${reason}`);
    }
  }
  ```
- Always include context when rethrowing: `throw new Error(\`Failed to verify agent ${did}: ${err.message}\`)`.
- Use Zod `.safeParse()` for input validation — return structured errors, don't throw.
- Return early on errors — no deep nesting.

### Database (Drizzle ORM)
- All schema definitions in `schema.ts` files per package.
- Use Drizzle's query builder for all DB operations. No raw SQL except migrations.
- Use `drizzle-zod` for generating Zod validators from schema.
- Transactions use `db.transaction(async (tx) => { ... })`.
- Always use parameterized queries — Drizzle handles this, but verify in raw SQL.
- Column names: `snake_case` in Postgres, mapped to `camelCase` in TypeScript.

### JWT / Auth (jose library)
- Use `jose` for all JWT operations. No `jsonwebtoken` or other libraries.
- Token creation: `new SignJWT(claims).setProtectedHeader({ alg: 'EdDSA' }).sign(key)`.
- Token verification: `jwtVerify(token, key, { algorithms: ['EdDSA'] })`.
- Always validate `exp`, `iss`, and custom claims (spending_limit, categories, parent_chain).
- Token hierarchy enforcement: verify child scope is subset of parent scope before issuance.

### State Machine (XState v5)
- Use XState v5 APIs only. Not v4 — the API is fundamentally different.
- Define machines with `createMachine({ ... })` using the v5 `setup()` pattern.
- Use typed context and events. No `any` in machine definitions.
- Guards for compliance boundary enforcement (price floors, spending limits, category checks).
- Actions for side effects (logging, webhook calls, receipt generation).
- Use `@xstate/test` for model-based testing of state machine transitions.

### API Routes (Hono)
- Route handlers are thin: parse request with Zod, call service, return response.
- Use Hono middleware for: CORS, auth verification, request logging, error handling.
- Return JSON with typed response objects. Always set `Content-Type: application/json`.
- Use proper HTTP status codes: 400 bad input, 401 no auth, 403 insufficient permissions, 404 not found, 500 internal.
- All routes return `{ success: boolean, data?: T, error?: string }`.

### Concurrency
- Use `Promise.all` for independent parallel operations.
- Use `Promise.race` with timeouts for external service calls (sidecar, registry lookups).
- Database operations within a transaction must be sequential, not parallel.
- WebSocket connections for real-time transaction feed use Hono's WebSocket support.

### Logging
- Use structured logging with `console.log` and JSON format in production.
- Log: transaction phase transitions, policy evaluations (result only), settlement confirmations, auth failures.
- **Never log:** JWT secrets, private keys, full token payloads, API keys, spending policy YAML contents.
- Use structured fields: `{ event: "transaction_settled", transactionId, agentDid, amount, vendor, duration }`.

### Project-Specific
- **Token hierarchy is inviolable.** Child tokens CANNOT widen parent scope. Assert this in every token creation path.
- **Negotiation messages are typed.** Every message in Phase 3 uses the structured protocol. No free-form strings.
- **Policy evaluation happens in the sidecar.** TypeScript code calls the sidecar HTTP API. Do not reimplement policy logic in TypeScript.
- **Spending state lives in the ledger.** The sidecar queries the ledger for balance checks. No local state caching for financial data.
- **Receipts are immutable.** Once generated, transaction receipts are append-only records. No update or delete operations.

## Python (Governance Sidecar)

### General
- Python 3.10+. Type hints on all function signatures.
- Use `async def` for all FastAPI endpoints.
- Use Pydantic models for request/response types.

### Formatting
- Black formatter. No configuration — use defaults.
- isort for import ordering: stdlib → third-party → local.

### Naming
- `snake_case` for functions, variables, modules.
- `PascalCase` for classes and Pydantic models.
- `SCREAMING_SNAKE_CASE` for constants.

### Agent Governance Toolkit
- Use `AgentIdentity` from AGT for Ed25519 crypto — not custom implementations.
- Use `StatelessKernel` for policy evaluation.
- Load policies from YAML files in `sidecar/policies/`.
- Trust scores are 0-1000 integers. Map to tiers: untrusted (0-199), low (200-399), medium (400-599), high (600-799), trusted (800-1000).
- DIDs follow the format `did:mesh:<ed25519-pubkey-hash>`. Never human-readable strings.

### FastAPI Endpoints
- All endpoints return Pydantic models, not dicts.
- Use query parameters for simple lookups, request body for complex inputs.
- Return 200 for successful checks (even if authorization denied — the denial is the data).
- Return 500 only for unexpected errors, not for policy denials.

## React / Next.js (Dashboard)

### General
- TypeScript strict mode. No `any`.
- Functional components with hooks only. No class components.
- Use named exports, not default exports (except for page.tsx files).

### Styling
- Tailwind utility classes via shadcn/ui components.
- No custom CSS files. If Tailwind doesn't cover it, extend the config.

### State Management
- React state (`useState`, `useReducer`) for component state.
- Server components for data fetching where possible (Next.js App Router).
- Use `useSWR` or `useQuery` for client-side data fetching with caching.

### Components
- Use shadcn/ui as the component library. Import from `@/components/ui/`.
- Agent management: create agent, set permissions, view token hierarchy.
- Transaction feed: real-time transaction list with phase status indicators.
- Compliance audit log: filterable, exportable transaction records.
- Spending analytics: spend by agent, category, vendor, time period.
