/**
 * Creates the rules-engine schema in the database and optionally seeds it.
 *
 * Usage:
 *   bun run packages/rules-engine/scripts/migrate.ts          # create tables only
 *   bun run packages/rules-engine/scripts/migrate.ts --seed   # create tables + seed data
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "../src/schema.js";
import { seed } from "../src/seed.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/warranted_test";

const shouldSeed = process.argv.includes("--seed");

async function migrate() {
  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });

  console.log("Creating rules-engine enums (if not exist)...");
  await db.execute(sql`DO $$ BEGIN CREATE TYPE domain AS ENUM ('finance', 'communication', 'agent_delegation'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE policy_effect AS ENUM ('allow', 'deny'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE dimension_kind AS ENUM ('numeric', 'rate', 'set', 'boolean', 'temporal'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE decision_outcome AS ENUM ('allow', 'deny', 'not_applicable', 'error'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE petition_status AS ENUM ('pending', 'approved', 'denied', 'expired', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  console.log("Creating rules-engine tables (if not exist)...");

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

  console.log("Schema created successfully.");

  if (shouldSeed) {
    console.log("Seeding data...");
    await seed(db as Parameters<typeof seed>[0]);
    console.log("Seed complete.");
  }

  await client.end();
  console.log("Done.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
