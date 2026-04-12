import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { internalAuthMiddleware } from "../../src/middleware/internal";

describe("internal auth middleware", () => {
  let app: Hono;

  beforeAll(() => {
    // Set the secret for testing
    process.env.INTERNAL_API_SECRET = "test-secret-123";

    app = new Hono();

    // Apply internal auth middleware to /check
    app.use("/check", internalAuthMiddleware);
    app.post("/check", (c) =>
      c.json({ success: true, data: { decision: "Allow" } }),
    );

    // Unprotected health endpoint
    app.get("/health", (c) => c.json({ status: "ok" }));
  });

  afterAll(() => {
    delete process.env.INTERNAL_API_SECRET;
  });

  it("allows request with valid X-Internal-Token", async () => {
    const res = await app.request("/check", {
      method: "POST",
      headers: {
        "X-Internal-Token": "test-secret-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("rejects request without X-Internal-Token header", async () => {
    const res = await app.request("/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("rejects request with wrong X-Internal-Token value", async () => {
    const res = await app.request("/check", {
      method: "POST",
      headers: {
        "X-Internal-Token": "wrong-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("health endpoint requires no auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

describe("middleware ordering (/check vs /api/policies/*)", () => {
  it("internal auth middleware on /check takes precedence over WorkOS auth", async () => {
    // The actual server setup mounts /check with internal auth separately
    // from the wildcard WorkOS auth routes. In the real index.ts, /check
    // uses internalAuthMiddleware, and the other routes use WorkOS.
    // We verify this by mounting them as separate route groups.
    process.env.INTERNAL_API_SECRET = "test-secret-123";

    const app = new Hono();

    // Internal auth on /check — as a route with inline middleware
    app.post("/api/policies/check", internalAuthMiddleware, (c) =>
      c.json({ success: true, data: { decision: "Allow" } }),
    );

    // Simulate WorkOS middleware that rejects all on other management routes
    const fakeWorkosMiddleware = async (c: any, next: any) => {
      return c.json({ error: "WorkOS auth required" }, 401);
    };

    app.use("/api/policies/rules/*", fakeWorkosMiddleware);
    app.get("/api/policies/rules", (c) =>
      c.json({ success: true, data: [] }),
    );

    // /check with internal token should succeed (no WorkOS needed)
    const checkRes = await app.request("/api/policies/check", {
      method: "POST",
      headers: {
        "X-Internal-Token": "test-secret-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(checkRes.status).toBe(200);

    // /rules without WorkOS session should fail
    const rulesRes = await app.request("/api/policies/rules");
    expect(rulesRes.status).toBe(401);

    delete process.env.INTERNAL_API_SECRET;
  });
});
