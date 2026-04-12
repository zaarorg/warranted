import type { PolicyConstraint, DimensionConstraint } from "./types";

// ---------------------------------------------------------------------------
// Cedar Source Generation
// ---------------------------------------------------------------------------

/**
 * Map a rate dimension's window string to a Cedar context field name.
 * E.g. "1 hour" → "transactions_last_hour", "1 day" → "transactions_last_day".
 */
function rateWindowToContextField(dimensionName: string, window: string): string {
  const normalized = window.toLowerCase().trim();
  if (normalized.includes("hour")) return "transactions_last_hour";
  if (normalized.includes("day")) return "transactions_last_day";
  if (normalized.includes("minute")) return "transactions_last_minute";
  return dimensionName;
}

/**
 * Generate a single Cedar `when` condition from a dimension constraint.
 * Returns null for temporal dimensions (checked at resolution time, not in Cedar).
 *
 * All conditions are generated in "forbid" form (condition that should trigger denial):
 * - numeric: `context.amount > 5000` (deny if exceeding limit)
 * - set:     `!([context.vendor].containsAny([...]))` (deny if not in set)
 * - rate:    `context.transactions_last_hour > 10` (deny if exceeding rate)
 * - boolean: `context.requires_human_approval != true` (deny if flag mismatch)
 *
 * This ensures Cedar's default-deny semantics work correctly: a single
 * unconditional permit is paired with forbid rules for each constraint,
 * so ALL constraints must pass (conjunctive), not just one (disjunctive).
 */
/**
 * For "allow" policies converted to forbid: negate the condition so the
 * forbid fires when the constraint is VIOLATED.
 * E.g. approved-vendors allow → forbid when vendor NOT in approved set.
 */
function dimensionToForbidCondition(dim: DimensionConstraint): string | null {
  switch (dim.kind) {
    case "numeric":
      return `context has "${dim.name}" && context.${dim.name} > ${dim.max}`;
    case "set":
      return `context has "${dim.name}" && !([context.${dim.name}].containsAny([${dim.members.map((m) => `"${m}"`).join(", ")}]))`;
    case "boolean":
      return `context has "${dim.name}" && context.${dim.name} != ${dim.value}`;
    case "temporal":
      return null;
    case "rate": {
      const field = rateWindowToContextField(dim.name, dim.window);
      return `context has "${field}" && context.${field} > ${dim.limit}`;
    }
  }
}

/**
 * For explicit "deny" policies: condition fires when the denial criteria
 * is MET (positive match).
 * E.g. sanctioned-vendors deny → forbid when vendor IS in sanctioned set.
 */
function dimensionToDenyCondition(dim: DimensionConstraint): string | null {
  switch (dim.kind) {
    case "numeric":
      return `context has "${dim.name}" && context.${dim.name} > ${dim.max}`;
    case "set":
      return `context has "${dim.name}" && [context.${dim.name}].containsAny([${dim.members.map((m) => `"${m}"`).join(", ")}])`;
    case "boolean":
      return `context has "${dim.name}" && context.${dim.name} == ${dim.value}`;
    case "temporal":
      return null;
    case "rate": {
      const field = rateWindowToContextField(dim.name, dim.window);
      return `context has "${field}" && context.${field} > ${dim.limit}`;
    }
  }
}

/**
 * Generate deterministic Cedar source from structured constraints.
 *
 * @param policyName - Human-readable policy name for comments
 * @param versionNumber - Policy version number for comments
 * @param effect - "allow" → permit, "deny" → forbid
 * @param constraints - Array of PolicyConstraint (one per action type)
 * @param assignmentTarget - Cedar entity UID for the assignment target (e.g. Group::"uuid")
 * @returns Deterministic Cedar source string
 */
/**
 * Generate deterministic Cedar source from structured constraints.
 *
 * **Cedar semantics note:** Cedar's `permit` policies are disjunctive — if ANY
 * permit matches (and no forbid matches), the request is Allowed. This means
 * multiple independent permit policies cannot enforce conjunctive (AND) constraints.
 *
 * To enforce that ALL constraints must pass:
 * - **Allow policies** generate one unconditional `permit` (grants the action) plus
 *   one `forbid` per dimension (denies when the constraint is violated). This ensures
 *   every dimension is a mandatory gate.
 * - **Deny policies** generate `forbid` blocks directly (deny when condition matches).
 */
export function generateCedar(
  policyName: string,
  versionNumber: number,
  effect: "allow" | "deny",
  constraints: PolicyConstraint[],
  assignmentTarget: string,
): string {
  // Sort constraints by actionName for determinism
  const sorted = [...constraints].sort((a, b) => a.actionName.localeCompare(b.actionName));

  const blocks: string[] = [];

  for (const constraint of sorted) {
    // Sort dimensions alphabetically by name for determinism
    const sortedDims = [...constraint.dimensions].sort((a, b) => a.name.localeCompare(b.name));

    // Generate conditions based on policy effect
    const conditionFn = effect === "allow" ? dimensionToForbidCondition : dimensionToDenyCondition;
    const forbidConditions = sortedDims
      .map((dim) => conditionFn(dim))
      .filter((c): c is string => c !== null);

    // Cedar comments
    const comment = [
      `// Policy: "${policyName}" (v${versionNumber})`,
      `// Assigned to: ${assignmentTarget}`,
    ].join("\n");

    // Skip blocks where dimensions exist but all are temporal (no Cedar conditions).
    if (forbidConditions.length === 0 && sortedDims.length > 0) {
      blocks.push(`${comment}\n// Temporal-only policy — enforced at resolution time, not in Cedar`);
      continue;
    }

    if (effect === "allow") {
      // Allow policy: unconditional permit + per-dimension forbids
      const permitLines = [
        comment,
        `permit (`,
        `  principal in ${assignmentTarget},`,
        `  action == Action::"${constraint.actionName}",`,
        `  resource`,
        `);`,
      ];
      blocks.push(permitLines.join("\n"));

      // One forbid block per dimension condition
      for (const dim of sortedDims) {
        const condition = dimensionToForbidCondition(dim);
        if (condition === null) continue;

        const forbidLines = [
          `// Policy: "${policyName}" (v${versionNumber}) — constraint: ${dim.name}`,
          `forbid (`,
          `  principal in ${assignmentTarget},`,
          `  action == Action::"${constraint.actionName}",`,
          `  resource`,
          `)`,
          `when {`,
          `  ${condition}`,
          `};`,
        ];
        blocks.push(forbidLines.join("\n"));
      }
    } else {
      // Deny policy: forbid when condition matches (existing behavior)
      const forbidLines = [comment];
      forbidLines.push(`forbid (`);
      forbidLines.push(`  principal in ${assignmentTarget},`);
      forbidLines.push(`  action == Action::"${constraint.actionName}",`);
      forbidLines.push(`  resource`);
      forbidLines.push(`)`);

      if (forbidConditions.length > 0) {
        forbidLines.push(`when {`);
        forbidLines.push(`  ${forbidConditions.join(" &&\n  ")}`);
        forbidLines.push(`};`);
      } else {
        forbidLines.push(`;`);
      }

      blocks.push(forbidLines.join("\n"));
    }
  }

  return blocks.join("\n\n");
}
