import type {
  PolicyConstraint,
  DimensionConstraint,
  ResolvedEnvelope,
  ResolvedAction,
  ResolvedDimension,
} from "@warranted/rules-engine";

export interface NarrowingViolation {
  dimension: string;
  type: string;
  agentValue: unknown;
  sponsorCeiling: unknown;
  message: string;
}

export interface NarrowingResult {
  valid: boolean;
  violations: NarrowingViolation[];
}

/**
 * Compare each dimension in the agent's requested policy constraints against
 * the sponsor's resolved envelope. The agent can only narrow (restrict), never
 * widen, the sponsor's effective permissions.
 */
export function validateNarrowing(
  agentConstraints: PolicyConstraint[],
  sponsorEnvelope: ResolvedEnvelope,
): NarrowingResult {
  const violations: NarrowingViolation[] = [];

  // Build a lookup: actionName -> ResolvedAction from sponsor envelope
  const sponsorActions = new Map<string, ResolvedAction>();
  for (const action of sponsorEnvelope.actions) {
    sponsorActions.set(action.actionName, action);
  }

  for (const constraint of agentConstraints) {
    const sponsorAction = sponsorActions.get(constraint.actionName);

    // If the sponsor has no entry for this action, the agent is trying
    // to gain permissions the sponsor doesn't have — violation.
    if (!sponsorAction) {
      violations.push({
        dimension: constraint.actionName,
        type: "action",
        agentValue: constraint.actionName,
        sponsorCeiling: null,
        message: `action "${constraint.actionName}" is not in sponsor's envelope`,
      });
      continue;
    }

    // If the action is denied for the sponsor, agent can't have it either
    if (sponsorAction.denied) {
      violations.push({
        dimension: constraint.actionName,
        type: "action",
        agentValue: constraint.actionName,
        sponsorCeiling: "denied",
        message: `action "${constraint.actionName}" is denied for sponsor`,
      });
      continue;
    }

    // Build dimension lookup from sponsor
    const sponsorDims = new Map<string, ResolvedDimension>();
    for (const dim of sponsorAction.dimensions) {
      sponsorDims.set(dim.name, dim);
    }

    // Check each agent dimension against sponsor ceiling
    for (const agentDim of constraint.dimensions) {
      const sponsorDim = sponsorDims.get(agentDim.name);

      if (!sponsorDim) {
        // Sponsor has no constraint for this dimension — agent is adding
        // a dimension the sponsor doesn't have. This is narrowing (adding
        // restrictions), which is allowed.
        continue;
      }

      const violation = compareDimension(agentDim, sponsorDim);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

function compareDimension(
  agent: DimensionConstraint,
  sponsor: ResolvedDimension,
): NarrowingViolation | null {
  const sponsorResolved = sponsor.resolved;

  switch (agent.kind) {
    case "numeric": {
      const sponsorMax = sponsorResolved as number;
      if (typeof sponsorMax === "number" && agent.max > sponsorMax) {
        return {
          dimension: agent.name,
          type: "numeric",
          agentValue: agent.max,
          sponsorCeiling: sponsorMax,
          message: `${agent.name} limit $${agent.max} exceeds sponsor's $${sponsorMax}`,
        };
      }
      return null;
    }

    case "set": {
      const sponsorMembers = sponsorResolved as string[];
      if (Array.isArray(sponsorMembers)) {
        const sponsorSet = new Set(sponsorMembers);
        const extra = agent.members.filter((m) => !sponsorSet.has(m));
        if (extra.length > 0) {
          return {
            dimension: agent.name,
            type: "set",
            agentValue: agent.members,
            sponsorCeiling: sponsorMembers,
            message: `${agent.name} includes [${extra.join(", ")}] not in sponsor's set`,
          };
        }
      }
      return null;
    }

    case "boolean": {
      const sponsorVal = sponsorResolved as boolean;
      // If the sponsor has a restrictive boolean set to true,
      // the agent cannot set it to false (relaxing the restriction)
      if (agent.restrictive && sponsorVal === true && agent.value === false) {
        return {
          dimension: agent.name,
          type: "boolean",
          agentValue: agent.value,
          sponsorCeiling: sponsorVal,
          message: `${agent.name} cannot be relaxed to false when sponsor requires true`,
        };
      }
      return null;
    }

    case "temporal": {
      const sponsorExpiry = sponsorResolved as string;
      if (typeof sponsorExpiry === "string") {
        const agentDate = new Date(agent.expiry).getTime();
        const sponsorDate = new Date(sponsorExpiry).getTime();
        if (agentDate > sponsorDate) {
          return {
            dimension: agent.name,
            type: "temporal",
            agentValue: agent.expiry,
            sponsorCeiling: sponsorExpiry,
            message: `${agent.name} expiry ${agent.expiry} exceeds sponsor's ${sponsorExpiry}`,
          };
        }
      }
      return null;
    }

    case "rate": {
      const sponsorLimit = sponsorResolved as number;
      if (typeof sponsorLimit === "number" && agent.limit > sponsorLimit) {
        return {
          dimension: agent.name,
          type: "rate",
          agentValue: agent.limit,
          sponsorCeiling: sponsorLimit,
          message: `${agent.name} rate ${agent.limit} exceeds sponsor's ${sponsorLimit}`,
        };
      }
      return null;
    }

    default:
      return null;
  }
}
