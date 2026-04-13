-- Phase 3: Multi-Tenancy + Org Isolation
-- Adds org_id to agentGroupMemberships, actionTypes, decisionLog
-- Backfills from existing data, updates constraints, adds index

-- ============================================================
-- agentGroupMemberships: add org_id, backfill from groups
-- ============================================================
ALTER TABLE agent_group_memberships ADD COLUMN org_id UUID REFERENCES organizations(id);

-- Backfill: derive org_id from the group's org_id
UPDATE agent_group_memberships agm
  SET org_id = g.org_id
  FROM groups g
  WHERE agm.group_id = g.id;

-- For any orphan rows where the group has been deleted, use default org
UPDATE agent_group_memberships
  SET org_id = (SELECT id FROM organizations LIMIT 1)
  WHERE org_id IS NULL;

ALTER TABLE agent_group_memberships ALTER COLUMN org_id SET NOT NULL;

-- ============================================================
-- actionTypes: add org_id, backfill, update unique constraint
-- ============================================================
ALTER TABLE action_types ADD COLUMN org_id UUID REFERENCES organizations(id);

-- Backfill: all existing action types belong to the seed org (Acme Corp)
UPDATE action_types SET org_id = (SELECT id FROM organizations WHERE slug = 'acme-corp' LIMIT 1);

-- If no acme-corp org exists, fall back to any org
UPDATE action_types SET org_id = (SELECT id FROM organizations LIMIT 1) WHERE org_id IS NULL;

ALTER TABLE action_types ALTER COLUMN org_id SET NOT NULL;

-- Update unique constraint: name must be unique per org, not globally
ALTER TABLE action_types DROP CONSTRAINT IF EXISTS action_types_name_unique;
ALTER TABLE action_types DROP CONSTRAINT IF EXISTS action_types_name_key;
ALTER TABLE action_types ADD CONSTRAINT action_types_org_name_unique UNIQUE(org_id, name);

-- ============================================================
-- decisionLog: add org_id, backfill, index
-- ============================================================
ALTER TABLE decision_log ADD COLUMN org_id UUID REFERENCES organizations(id);

-- Backfill: try to derive from agent_identities, fall back to default org
UPDATE decision_log dl
  SET org_id = ai.org_id
  FROM agent_identities ai
  WHERE dl.agent_did = ai.did;

-- Remaining rows (pre-Phase 2 agents without identity records)
UPDATE decision_log
  SET org_id = (SELECT id FROM organizations LIMIT 1)
  WHERE org_id IS NULL;

ALTER TABLE decision_log ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS decision_log_org_time_idx
  ON decision_log(org_id, evaluated_at);
