/**
 * Seed script: creates all tables in the public schema and seeds Acme Corp demo data.
 * Usage: DATABASE_URL=... bun run apps/api/src/seed-db.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { seed } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/warranted_test";

const client = postgres(DATABASE_URL, { max: 5 });
const db: DrizzleDB = drizzle(client);

// ---------------------------------------------------------------------------
// Create enums (idempotent with IF NOT EXISTS via DO blocks)
// ---------------------------------------------------------------------------
async function createEnums() {
  const enums = [
    { name: "domain", values: ["finance", "communication", "agent_delegation"] },
    { name: "policy_effect", values: ["allow", "deny"] },
    { name: "dimension_kind", values: ["numeric", "rate", "set", "boolean", "temporal"] },
    { name: "decision_outcome", values: ["allow", "deny", "not_applicable", "error"] },
    { name: "petition_status", values: ["pending", "approved", "denied", "expired", "cancelled"] },
  ];

  for (const e of enums) {
    const vals = e.values.map((v) => `'${v}'`).join(", ");
    await db.execute(
      sql.raw(`
        DO $$ BEGIN
          CREATE TYPE ${e.name} AS ENUM (${vals});
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `),
    );
  }
}

// ---------------------------------------------------------------------------
// Create tables (idempotent with IF NOT EXISTS)
// ---------------------------------------------------------------------------
async function createTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      policy_version INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      node_type TEXT NOT NULL CHECK (node_type IN ('org', 'department', 'team')),
      parent_id UUID REFERENCES groups(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (org_id, name, parent_id)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_group_memberships (
      agent_did TEXT NOT NULL,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY (agent_did, group_id)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS action_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      domain domain NOT NULL,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS dimension_definitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action_type_id UUID NOT NULL REFERENCES action_types(id) ON DELETE CASCADE,
      dimension_name TEXT NOT NULL,
      kind dimension_kind NOT NULL,
      numeric_max NUMERIC,
      rate_limit INTEGER,
      rate_window TEXT,
      set_members TEXT[],
      bool_default BOOLEAN,
      bool_restrictive BOOLEAN,
      temporal_expiry DATE,
      UNIQUE (action_type_id, dimension_name)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      domain domain NOT NULL,
      effect policy_effect NOT NULL,
      active_version_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (org_id, name)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policy_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      constraints JSONB NOT NULL,
      cedar_source TEXT NOT NULL,
      cedar_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policy_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
      group_id UUID REFERENCES groups(id),
      agent_did TEXT,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((group_id IS NOT NULL AND agent_did IS NULL) OR (group_id IS NULL AND agent_did IS NOT NULL))
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS decision_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      agent_did TEXT NOT NULL,
      action_type_id UUID NOT NULL REFERENCES action_types(id),
      request_context JSONB NOT NULL,
      bundle_hash TEXT NOT NULL,
      outcome decision_outcome NOT NULL,
      reason TEXT,
      matched_version_id UUID REFERENCES policy_versions(id),
      engine_error_code TEXT,
      sdk_error_code TEXT,
      envelope_snapshot JSONB
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS petitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      requestor_did TEXT NOT NULL,
      action_type_id UUID NOT NULL REFERENCES action_types(id),
      requested_context JSONB NOT NULL,
      violated_policy_id UUID NOT NULL REFERENCES policies(id),
      violated_dimension TEXT NOT NULL,
      requested_value JSONB NOT NULL,
      justification TEXT NOT NULL,
      approver_did TEXT,
      approver_group_id UUID REFERENCES groups(id),
      status petition_status NOT NULL DEFAULT 'pending',
      decision_reason TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      grant_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at TIMESTAMPTZ
    )
  `);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("Creating enums...");
  await createEnums();

  console.log("Creating tables...");
  await createTables();

  console.log("Seeding Acme Corp demo data...");
  await seed(db);

  console.log("Done.");
  await client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
