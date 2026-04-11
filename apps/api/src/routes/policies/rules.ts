import { Hono } from "hono";
import { createHash } from "crypto";
import { eq, sql } from "drizzle-orm";
import {
  policies,
  policyVersions,
  organizations,
  policyAssignments,
  PolicyConstraintSchema,
  generateCedar,
} from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";
import { z } from "zod";

const CreatePolicySchema = z.object({
  name: z.string().min(1),
  orgId: z.string().uuid(),
  domain: z.enum(["finance", "communication", "agent_delegation"]),
  effect: z.enum(["allow", "deny"]),
});

const UpdatePolicySchema = z.object({
  name: z.string().min(1).optional(),
  domain: z.enum(["finance", "communication", "agent_delegation"]).optional(),
});

const CreateVersionSchema = z.object({
  constraints: PolicyConstraintSchema.array(),
  createdBy: z.string().optional(),
});

export function rulesRoutes(db: DrizzleDB): Hono {
  const app = new Hono();

  // GET / — List all policies
  app.get("/", async (c) => {
    const orgId = c.req.query("orgId");
    const query = orgId
      ? db.select().from(policies).where(eq(policies.orgId, orgId))
      : db.select().from(policies);
    const rows = await query;
    return c.json({ success: true, data: rows });
  });

  // POST / — Create policy
  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreatePolicySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    const [row] = await db
      .insert(policies)
      .values({
        name: parsed.data.name,
        orgId: parsed.data.orgId,
        domain: parsed.data.domain,
        effect: parsed.data.effect,
        activeVersionId: null,
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  });

  // GET /:id — Get policy by ID
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const rows = await db.select().from(policies).where(eq(policies.id, id));
    if (rows.length === 0) {
      return c.json({ success: false, error: "Policy not found" }, 404);
    }
    return c.json({ success: true, data: rows[0] });
  });

  // PUT /:id — Update policy metadata
  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = UpdatePolicySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    const existing = await db.select().from(policies).where(eq(policies.id, id));
    if (existing.length === 0) {
      return c.json({ success: false, error: "Policy not found" }, 404);
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.name) updates.name = parsed.data.name;
    if (parsed.data.domain) updates.domain = parsed.data.domain;

    if (Object.keys(updates).length === 0) {
      return c.json({ success: true, data: existing[0] });
    }

    const [row] = await db
      .update(policies)
      .set(updates)
      .where(eq(policies.id, id))
      .returning();

    return c.json({ success: true, data: row });
  });

  // DELETE /:id — Delete policy
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const rows = await db.delete(policies).where(eq(policies.id, id)).returning();
    if (rows.length === 0) {
      return c.json({ success: false, error: "Policy not found" }, 404);
    }
    return c.json({ success: true, data: { deleted: true } });
  });

  // GET /:id/versions — List versions
  app.get("/:id/versions", async (c) => {
    const policyId = c.req.param("id");
    const rows = await db
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.policyId, policyId));
    return c.json({ success: true, data: rows });
  });

  // POST /:id/versions — Create version (ATOMIC)
  app.post("/:id/versions", async (c) => {
    const policyId = c.req.param("id");
    const body = await c.req.json();

    const parsed = CreateVersionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    // Get the policy
    const policyRows = await db.select().from(policies).where(eq(policies.id, policyId));
    if (policyRows.length === 0) {
      return c.json({ success: false, error: "Policy not found" }, 404);
    }
    const policy = policyRows[0]!;

    // Get next version number
    const lastVersion = await db
      .select({ max: sql<number>`COALESCE(MAX(version_number), 0)` })
      .from(policyVersions)
      .where(eq(policyVersions.policyId, policyId));
    const nextVersion = (lastVersion[0]?.max ?? 0) + 1;

    // Get assignment target for Cedar generation
    const assignmentRows = await db
      .select()
      .from(policyAssignments)
      .where(eq(policyAssignments.policyId, policyId));

    const firstAssignment = assignmentRows[0];
    const target = firstAssignment?.groupId
      ? `Group::"${firstAssignment.groupId}"`
      : firstAssignment?.agentDid
        ? `Agent::"${firstAssignment.agentDid}"`
        : `Group::"${policy.orgId}"`;

    // Generate Cedar
    const cedarSource = generateCedar(
      policy.name,
      nextVersion,
      policy.effect,
      parsed.data.constraints,
      target,
    );
    const cedarHash = createHash("sha256").update(cedarSource).digest("hex");

    // Atomic transaction
    let versionId: string | undefined;

    await db.transaction(async (tx) => {
      const [version] = await tx
        .insert(policyVersions)
        .values({
          policyId,
          versionNumber: nextVersion,
          constraints: parsed.data.constraints,
          cedarSource,
          cedarHash,
          createdBy: parsed.data.createdBy ?? null,
        })
        .returning();

      versionId = version!.id;

      await tx
        .update(policies)
        .set({ activeVersionId: version!.id })
        .where(eq(policies.id, policyId));

      await tx
        .update(organizations)
        .set({ policyVersion: sql`policy_version + 1` })
        .where(eq(organizations.id, policy.orgId));
    });

    return c.json(
      {
        success: true,
        data: {
          id: versionId,
          versionNumber: nextVersion,
          cedarSource,
          cedarHash,
        },
      },
      201,
    );
  });

  // POST /:id/versions/:vid/activate — Activate specific version
  app.post("/:id/versions/:vid/activate", async (c) => {
    const policyId = c.req.param("id");
    const versionId = c.req.param("vid");

    // Verify the version exists and belongs to this policy
    const versionRows = await db
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.id, versionId));

    if (versionRows.length === 0 || versionRows[0]!.policyId !== policyId) {
      return c.json({ success: false, error: "Version not found for this policy" }, 404);
    }

    const policyRows = await db.select().from(policies).where(eq(policies.id, policyId));
    if (policyRows.length === 0) {
      return c.json({ success: false, error: "Policy not found" }, 404);
    }

    await db.transaction(async (tx) => {
      await tx
        .update(policies)
        .set({ activeVersionId: versionId })
        .where(eq(policies.id, policyId));

      await tx
        .update(organizations)
        .set({ policyVersion: sql`policy_version + 1` })
        .where(eq(organizations.id, policyRows[0]!.orgId));
    });

    return c.json({ success: true, data: { activated: true, versionId } });
  });

  return app;
}
