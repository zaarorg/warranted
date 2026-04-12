import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "./db";
import { policyRoutes } from "./routes/policies/index";
import { agentRoutes } from "./routes/agents/index";
import { workosWebhookRoutes } from "./webhooks/workos";
import { createAuthMiddleware } from "./middleware/auth";
import { internalAuthMiddleware } from "./middleware/internal";
import { createRedisClient } from "./redis";

const redis = await createRedisClient();

const AGENT_SEED_ENCRYPTION_KEY = process.env.AGENT_SEED_ENCRYPTION_KEY ?? "";

const app = new Hono();

app.use("/*", cors());

// Health check — no auth
app.get("/health", (c) => c.json({ status: "ok" }));

// WorkOS webhooks — no session auth (signature verification in handler)
app.route("/api/webhooks/workos", workosWebhookRoutes(db, { redis }));

// Internal auth for /check endpoint
app.use("/api/policies/check", internalAuthMiddleware);

// WorkOS session auth for management API routes.
// Applied to specific sub-paths to avoid matching /check (which uses internal auth).
const authMiddleware = createAuthMiddleware(db);
app.use("/api/policies/organizations/*", authMiddleware);
app.use("/api/policies/rules/*", authMiddleware);
app.use("/api/policies/groups/*", authMiddleware);
app.use("/api/policies/assignments/*", authMiddleware);
app.use("/api/policies/action-types/*", authMiddleware);
app.use("/api/policies/decisions/*", authMiddleware);
app.use("/api/policies/petitions/*", authMiddleware);

// Agent management routes — auth required
app.use("/api/agents/*", authMiddleware);

// Mount routes
app.route("/api/policies", policyRoutes(db, redis));
app.route("/api/agents", agentRoutes({ db, redis, encryptionKey: AGENT_SEED_ENCRYPTION_KEY }));

const port = parseInt(process.env.PORT ?? "3000", 10);

export default {
  port,
  fetch: app.fetch,
};

export { app };
