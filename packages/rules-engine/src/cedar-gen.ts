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
 */
function dimensionToCondition(dim: DimensionConstraint): string | null {
  switch (dim.kind) {
    case "numeric":
      return `context.${dim.name} <= ${dim.max}`;
    case "set":
      return `[context.${dim.name}].containsAny([${dim.members.map((m) => `"${m}"`).join(", ")}])`;
    case "boolean":
      return `context.${dim.name} == ${dim.value}`;
    case "temporal":
      return null;
    case "rate": {
      const field = rateWindowToContextField(dim.name, dim.window);
      return `context.${field} <= ${dim.limit}`;
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
export function generateCedar(
  policyName: string,
  versionNumber: number,
  effect: "allow" | "deny",
  constraints: PolicyConstraint[],
  assignmentTarget: string,
): string {
  const cedarEffect = effect === "allow" ? "permit" : "forbid";

  // Sort constraints by actionName for determinism
  const sorted = [...constraints].sort((a, b) => a.actionName.localeCompare(b.actionName));

  const blocks: string[] = [];

  for (const constraint of sorted) {
    // Sort dimensions alphabetically by name for determinism
    const sortedDims = [...constraint.dimensions].sort((a, b) => a.name.localeCompare(b.name));

    // Generate conditions, filtering out temporal (null)
    const conditions = sortedDims
      .map((dim) => dimensionToCondition(dim))
      .filter((c): c is string => c !== null);

    const lines: string[] = [];

    // Cedar comments
    lines.push(`// Policy: "${policyName}" (v${versionNumber})`);
    lines.push(`// Assigned to: ${assignmentTarget}`);

    // Head
    lines.push(`${cedarEffect} (`);
    lines.push(`  principal in ${assignmentTarget},`);
    lines.push(`  action == Action::"${constraint.actionName}",`);
    lines.push(`  resource`);
    lines.push(`)`);

    // When clause (only if there are conditions)
    if (conditions.length > 0) {
      lines.push(`when {`);
      lines.push(`  ${conditions.join(" &&\n  ")}`);
      lines.push(`};`);
    } else {
      lines.push(`;`);
    }

    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}
