import { Hono } from "hono";
import { db } from "./db";
import { policyRoutes } from "./routes/policies/index";

const app = new Hono();

// Mount policy management routes
app.route("/api/policies", policyRoutes(db));

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

const port = parseInt(process.env.PORT ?? "3000", 10);

export default {
  port,
  fetch: app.fetch,
};

export { app };
