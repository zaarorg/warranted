import { describe, it, expect } from "vitest";
import { generateCedar } from "../src/cedar-gen";
import type { PolicyConstraint } from "../src/types";

describe("cedar generation", () => {
  const purchaseActionId = "00000000-0000-0000-0000-000000000100";
  const orgTarget = 'Group::"00000000-0000-0000-0000-000000000002"';

  it("generates deterministic Cedar source from constraints", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [
          { name: "vendor", kind: "set", members: ["aws", "azure"] },
          { name: "amount", kind: "numeric", max: 5000 },
        ],
      },
    ];

    const result1 = generateCedar("test-policy", 1, "allow", constraints, orgTarget);
    const result2 = generateCedar("test-policy", 1, "allow", constraints, orgTarget);
    expect(result1).toBe(result2);
  });

  it("generates permit block for allow policies", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", max: 5000 }],
      },
    ];

    const cedar = generateCedar("spending-limit", 3, "allow", constraints, orgTarget);
    expect(cedar).toContain("permit (");
    expect(cedar).toContain(`principal in ${orgTarget}`);
    expect(cedar).toContain('action == Action::"purchase.initiate"');
    expect(cedar).toContain("context.amount <= 5000");
  });

  it("generates forbid block for deny policies", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [{ name: "vendor", kind: "set", members: ["sanctioned-vendor-001"] }],
      },
    ];

    const cedar = generateCedar("block-sanctioned", 1, "deny", constraints, orgTarget);
    expect(cedar).toContain("forbid (");
    expect(cedar).toContain('[context.vendor].containsAny(["sanctioned-vendor-001"])');
  });

  it("includes policy metadata as comments", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", max: 5000 }],
      },
    ];

    const cedar = generateCedar("org-spending-limits", 3, "allow", constraints, orgTarget);
    expect(cedar).toContain('// Policy: "org-spending-limits" (v3)');
    expect(cedar).toContain(`// Assigned to: ${orgTarget}`);
  });

  it("handles numeric dimension: context.amount <= N", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", max: 5000 }],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    expect(cedar).toContain("context.amount <= 5000");
  });

  it("handles set dimension: [context.vendor].containsAny([...])", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [{ name: "vendor", kind: "set", members: ["aws", "azure", "gcp"] }],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    expect(cedar).toContain('[context.vendor].containsAny(["aws", "azure", "gcp"])');
    // Must NOT use "context.vendor in [...]" syntax
    expect(cedar).not.toContain("context.vendor in");
  });

  it("handles boolean dimension: context.X == true/false", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [
          { name: "requires_human_approval", kind: "boolean", value: true, restrictive: true },
        ],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    expect(cedar).toContain("context.requires_human_approval == true");
  });

  it("handles temporal dimension: skipped in Cedar (checked at resolution time)", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [{ name: "budget_expiry", kind: "temporal", expiry: "2026-12-31" }],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    // Temporal dimensions should not appear in when clause
    expect(cedar).not.toContain("budget_expiry");
    // No when clause since only temporal
    expect(cedar).not.toContain("when {");
  });

  it("handles rate dimension: context.transactions_last_hour <= N", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [{ name: "transactions", kind: "rate", limit: 10, window: "1 hour" }],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    expect(cedar).toContain("context.transactions_last_hour <= 10");
  });

  it("handles rate dimension with day window", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [{ name: "transactions", kind: "rate", limit: 50, window: "1 day" }],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    expect(cedar).toContain("context.transactions_last_day <= 50");
  });

  it("handles policy with no dimensions (unconditional)", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    expect(cedar).toContain("permit (");
    expect(cedar).not.toContain("when {");
    // Should end with just semicolon
    expect(cedar).toMatch(/resource\n\)\n;$/);
  });

  it("handles policy with only temporal dimensions (no when clause)", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [
          { name: "budget_expiry", kind: "temporal", expiry: "2026-12-31" },
          { name: "approval_expiry", kind: "temporal", expiry: "2026-06-30" },
        ],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    expect(cedar).not.toContain("when {");
  });

  it("handles policy with multiple action types (separate blocks)", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", max: 5000 }],
      },
      {
        actionTypeId: "00000000-0000-0000-0000-000000000104",
        actionName: "expense.submit",
        dimensions: [{ name: "amount", kind: "numeric", max: 1000 }],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    // Both actions should be present as separate blocks
    expect(cedar).toContain('action == Action::"expense.submit"');
    expect(cedar).toContain('action == Action::"purchase.initiate"');
    // Sorted alphabetically: expense.submit before purchase.initiate
    const expenseIdx = cedar.indexOf("expense.submit");
    const purchaseIdx = cedar.indexOf("purchase.initiate");
    expect(expenseIdx).toBeLessThan(purchaseIdx);
  });

  it("sorts dimensions alphabetically for determinism", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [
          { name: "vendor", kind: "set", members: ["aws"] },
          { name: "amount", kind: "numeric", max: 5000 },
          { name: "category", kind: "set", members: ["compute"] },
        ],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    const amountIdx = cedar.indexOf("context.amount");
    const categoryIdx = cedar.indexOf("context.category");
    const vendorIdx = cedar.indexOf("context.vendor");
    expect(amountIdx).toBeLessThan(categoryIdx);
    expect(categoryIdx).toBeLessThan(vendorIdx);
  });

  it("joins multiple conditions with &&", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseActionId,
        actionName: "purchase.initiate",
        dimensions: [
          { name: "amount", kind: "numeric", max: 5000 },
          { name: "vendor", kind: "set", members: ["aws"] },
        ],
      },
    ];

    const cedar = generateCedar("test", 1, "allow", constraints, orgTarget);
    expect(cedar).toContain("&&");
  });
});
