import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "../../src/schema";
import type { DrizzleDB } from "../../src/envelope";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/warranted_test";

let client: ReturnType<typeof postgres>;
let db: DrizzleDB;
let schemaName: string;

/**
 * Set up the test database: connect, create a unique schema, and build all tables.
 * Each test file gets its own Postgres schema to allow parallel execution.
 */
export async function setupTestDb(): Promise<DrizzleDB> {
  schemaName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  client = postgres(TEST_DATABASE_URL, { max: 5 });

  // Create unique schema and set search path
  const rawDb = drizzle(client) as DrizzleDB;
  await rawDb.execute(sql.raw(`CREATE SCHEMA ${schemaName}`));
  await rawDb.execute(sql.raw(`SET search_path TO ${schemaName}`));
  await client.end();

  // Reconnect with the schema in the search path
  client = postgres(TEST_DATABASE_URL, { max: 5, connection: { search_path: schemaName } });
  db = drizzle(client, { schema }) as DrizzleDB;

  // Create enums
  await db.execute(sql`CREATE TYPE domain AS ENUM ('finance', 'communication', 'agent_delegation')`);
  await db.execute(sql`CREATE TYPE policy_effect AS ENUM ('allow', 'deny')`);
  await db.execute(sql`CREATE TYPE dimension_kind AS ENUM ('numeric', 'rate', 'set', 'boolean', 'temporal')`);
  await db.execute(sql`CREATE TYPE decision_outcome AS ENUM ('allow', 'deny', 'not_applicable', 'error')`);
  await db.execute(sql`CREATE TYPE petition_status AS ENUM ('pending', 'approved', 'denied', 'expired', 'cancelled')`);

  // Create tables
  await db.execute(sql`
    CREATE TABLE organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      policy_version INTEGER NOT NULL DEFAULT 0,
      workos_org_id TEXT UNIQUE,
      workos_directory_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      node_type TEXT NOT NULL DEFAULT 'unassigned' CHECK (node_type IN ('org', 'department', 'team', 'unassigned')),
      parent_id UUID REFERENCES groups(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (org_id, name, parent_id)
    )
  `);

  await db.execute(sql`
    CREATE TABLE agent_group_memberships (
      agent_did TEXT NOT NULL,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      org_id UUID NOT NULL REFERENCES organizations(id),
      PRIMARY KEY (agent_did, group_id)
    )
  `);

  await db.execute(sql`
    CREATE TABLE action_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      domain domain NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      UNIQUE (org_id, name)
    )
  `);

  await db.execute(sql`
    CREATE TABLE dimension_definitions (
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
    CREATE TABLE policies (
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
    CREATE TABLE policy_versions (
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
    CREATE TABLE policy_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
      group_id UUID REFERENCES groups(id),
      agent_did TEXT,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((group_id IS NOT NULL AND agent_did IS NULL) OR (group_id IS NULL AND agent_did IS NOT NULL))
    )
  `);

  await db.execute(sql`
    CREATE TABLE decision_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
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
    CREATE INDEX decision_log_org_time_idx ON decision_log(org_id, evaluated_at)
  `);

  await db.execute(sql`
    CREATE TABLE workos_processed_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE wos_sync_state (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      last_sync_at TIMESTAMPTZ,
      sync_cursor TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Phase 2: Agent Identity Tables
  await db.execute(sql`
    CREATE TABLE agent_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      agent_id TEXT NOT NULL UNIQUE,
      did TEXT NOT NULL UNIQUE,
      public_key BYTEA NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      revoked_at TIMESTAMPTZ
    )
  `);

  await db.execute(sql`
    CREATE TABLE agent_lineage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),
      parent_id TEXT NOT NULL,
      parent_type TEXT NOT NULL CHECK (parent_type IN ('user', 'agent')),
      sponsor_user_id TEXT NOT NULL,
      sponsor_membership_id TEXT NOT NULL,
      sponsor_role_at_creation TEXT,
      sponsor_envelope_snapshot JSONB NOT NULL,
      lineage JSONB NOT NULL,
      signature TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE agent_key_seeds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id) UNIQUE,
      encrypted_seed BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE petitions (
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

  return db;
}

/**
 * Tear down the test database: drop the unique schema and close connection.
 */
export async function teardownTestDb(): Promise<void> {
  try {
    await db.execute(sql.raw(`DROP SCHEMA ${schemaName} CASCADE`));
  } catch {
    // ignore errors during teardown
  }
  await client.end();
}

export function getDb(): DrizzleDB {
  return db;
}
