/** Client-side types matching the management API responses. */

export interface ResolvedEnvelope {
  agentDid: string;
  actions: ResolvedAction[];
  policyVersion: number;
  resolvedAt: string;
}

export interface ResolvedAction {
  actionId: string;
  actionName: string;
  denied: boolean;
  denySource: string | null;
  dimensions: ResolvedDimension[];
}

export interface ResolvedDimension {
  name: string;
  kind: "numeric" | "set" | "boolean" | "temporal" | "rate";
  resolved: unknown;
  sources: DimensionSource[];
}

export interface DimensionSource {
  policyName: string;
  groupName: string | null;
  level: "org" | "department" | "team" | "agent";
  value: unknown;
}

export interface CheckRequest {
  principal: string;
  action: string;
  resource: string;
  context: Record<string, unknown>;
}

export interface CheckResponse {
  decision: "Allow" | "Deny";
  diagnostics: string[];
  engineCode: string | null;
  sdkCode: string | null;
  details: Record<string, unknown>;
}

export interface Policy {
  id: string;
  orgId: string;
  name: string;
  domain: "finance" | "communication" | "agent_delegation";
  effect: "allow" | "deny";
  activeVersionId: string | null;
  createdAt: string;
}

export interface PolicyVersion {
  id: string;
  policyId: string;
  versionNumber: number;
  constraints: PolicyConstraint[];
  cedarSource: string;
  cedarHash: string;
  createdAt: string;
  createdBy: string | null;
}

export interface PolicyConstraint {
  actionTypeId: string;
  actionName: string;
  dimensions: DimensionConstraint[];
}

export type DimensionConstraint =
  | { name: string; kind: "numeric"; max: number }
  | { name: string; kind: "rate"; limit: number; window: string }
  | { name: string; kind: "set"; members: string[] }
  | { name: string; kind: "boolean"; value: boolean; restrictive: boolean }
  | { name: string; kind: "temporal"; expiry: string };

export interface Group {
  id: string;
  orgId: string;
  name: string;
  nodeType: "org" | "department" | "team";
  parentId: string | null;
  createdAt: string;
}

export interface GroupMembership {
  agentDid: string;
  groupId: string;
}

export interface PolicyAssignment {
  id: string;
  policyId: string;
  groupId: string | null;
  agentDid: string | null;
  assignedAt: string;
}

export interface ActionType {
  id: string;
  domain: "finance" | "communication" | "agent_delegation";
  name: string;
  description: string | null;
  dimensions: DimensionDefinition[];
}

export interface DimensionDefinition {
  id: string;
  actionTypeId: string;
  dimensionName: string;
  kind: "numeric" | "set" | "boolean" | "temporal" | "rate";
  numericMax: string | null;
  rateLimit: number | null;
  rateWindow: string | null;
  setMembers: string[] | null;
  boolDefault: boolean | null;
  boolRestrictive: boolean | null;
  temporalExpiry: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  policyVersion: number;
  createdAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
