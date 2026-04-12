-- Phase 2: Agent Identity Service

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
);

CREATE INDEX agent_identities_org_idx ON agent_identities(org_id);

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
);

CREATE INDEX agent_lineage_sponsor_idx ON agent_lineage(sponsor_user_id);

CREATE TABLE agent_key_seeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id) UNIQUE,
  encrypted_seed BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
