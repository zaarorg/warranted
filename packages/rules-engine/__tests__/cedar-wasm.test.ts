import { describe, expect, it } from "vitest";
import { initCedar } from "../src/cedar-wasm";
import type { CedarEngine } from "../src/cedar-wasm";

describe("cedar wasm", () => {
  it("loads WASM successfully in Bun", async () => {
    const engine = await initCedar();
    expect(engine).toBeDefined();
  });

  it("initCedar returns CedarEngine with all expected methods", async () => {
    const engine = await initCedar();
    expect(typeof engine.loadPolicies).toBe("function");
    expect(typeof engine.loadEntities).toBe("function");
    expect(typeof engine.check).toBe("function");
    expect(typeof engine.getBundleHash).toBe("function");
  });

  it("simple permit policy evaluates to Allow", async () => {
    const engine = await initCedar();
    engine.loadPolicies(["permit(principal, action, resource);"]);
    const result = engine.check({
      principal: 'Agent::"test"',
      action: 'Action::"test"',
      resource: 'Resource::"test"',
      context: {},
    });
    expect(result.decision).toBe("Allow");
  });

  it("no matching permit evaluates to Deny", async () => {
    const engine = await initCedar();
    engine.loadPolicies([]);
    const result = engine.check({
      principal: 'Agent::"test"',
      action: 'Action::"test"',
      resource: 'Resource::"test"',
      context: {},
    });
    expect(result.decision).toBe("Deny");
  });

  it("forbid overrides permit", async () => {
    const engine = await initCedar();
    engine.loadPolicies([
      "permit(principal, action, resource);",
      "forbid(principal, action, resource);",
    ]);
    const result = engine.check({
      principal: 'Agent::"test"',
      action: 'Action::"test"',
      resource: 'Resource::"test"',
      context: {},
    });
    expect(result.decision).toBe("Deny");
  });

  it("permit with when clause checks context values", async () => {
    const engine = await initCedar();
    engine.loadPolicies([
      'permit(principal, action, resource) when { context.amount <= 5000 };',
    ]);

    const allowed = engine.check({
      principal: 'Agent::"test"',
      action: 'Action::"purchase"',
      resource: 'Resource::"vendor"',
      context: { amount: 3000 },
    });
    expect(allowed.decision).toBe("Allow");

    const denied = engine.check({
      principal: 'Agent::"test"',
      action: 'Action::"purchase"',
      resource: 'Resource::"vendor"',
      context: { amount: 6000 },
    });
    expect(denied.decision).toBe("Deny");
  });

  it("entity hierarchy allows principal in Group", async () => {
    const engine = await initCedar();
    engine.loadPolicies([
      'permit(principal in Group::"finance-team", action, resource);',
    ]);
    engine.loadEntities([
      {
        uid: 'Agent::"agent-1"',
        parents: ['Group::"finance-team"'],
        attrs: {},
      },
      {
        uid: 'Group::"finance-team"',
        parents: [],
        attrs: {},
      },
    ]);

    const memberResult = engine.check({
      principal: 'Agent::"agent-1"',
      action: 'Action::"test"',
      resource: 'Resource::"test"',
      context: {},
    });
    expect(memberResult.decision).toBe("Allow");

    const nonMemberResult = engine.check({
      principal: 'Agent::"agent-2"',
      action: 'Action::"test"',
      resource: 'Resource::"test"',
      context: {},
    });
    expect(nonMemberResult.decision).toBe("Deny");
  });

  it("getBundleHash returns consistent SHA-256 hash", async () => {
    const engine = await initCedar();
    engine.loadPolicies([
      "permit(principal, action, resource);",
      "forbid(principal, action, resource);",
    ]);
    const hash1 = engine.getBundleHash();
    const hash2 = engine.getBundleHash();
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("getBundleHash changes when policies change", async () => {
    const engine = await initCedar();
    engine.loadPolicies(["permit(principal, action, resource);"]);
    const hash1 = engine.getBundleHash();

    engine.loadPolicies(["forbid(principal, action, resource);"]);
    const hash2 = engine.getBundleHash();

    expect(hash1).not.toBe(hash2);
  });
});
