#!/usr/bin/env bun
export {};
/**
 * Storefront Integration Test Script
 *
 * Validates a running storefront by executing the full purchasing flow:
 * discover → catalog → create session → settle.
 *
 * Usage:
 *   bun run scripts/test-storefront.ts --url http://localhost:3001
 *   bun run scripts/test-storefront.ts --url http://localhost:3001 --sidecar-url http://localhost:8100
 *   bun run scripts/test-storefront.ts --url http://localhost:3001 --token <pre-obtained-jwt>
 */

const RED = "\x1b[31m" as const;
const GREEN = "\x1b[32m" as const;
const RESET = "\x1b[0m" as const;

function pass(step: string, detail?: string) {
  const msg = detail ? `${step} — ${detail}` : step;
  console.log(`${GREEN}  ✓ ${msg}${RESET}`);
}

function fail(step: string, detail?: string) {
  const msg = detail ? `${step} — ${detail}` : step;
  console.log(`${RED}  ✗ ${msg}${RESET}`);
}

function parseArgs(args: string[]): { url?: string; token?: string; sidecarUrl: string } {
  const result: { url?: string; token?: string; sidecarUrl: string } = {
    sidecarUrl: "http://localhost:8100",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--url":
        result.url = args[++i] ?? undefined;
        break;
      case "--token":
        result.token = args[++i] ?? undefined;
        break;
      case "--sidecar-url":
        result.sidecarUrl = args[++i] ?? "http://localhost:8100";
        break;
    }
  }

  return result;
}

async function getToken(sidecarUrl: string): Promise<string> {
  const res = await fetch(`${sidecarUrl}/issue_token`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to get token from sidecar (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.token;
}

interface StepResult {
  name: string;
  passed: boolean;
  detail?: string;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    console.error("Usage: test-storefront.ts --url <storefront-url> [--token <jwt>] [--sidecar-url <url>]");
    process.exit(1);
  }

  const baseUrl = args.url.replace(/\/$/, "");
  const results: StepResult[] = [];

  console.log(`\nTesting storefront: ${baseUrl}\n`);

  // Step 1: Obtain token
  let token: string;
  try {
    if (args.token) {
      token = args.token;
      pass("Token", "using provided token");
      results.push({ name: "Token", passed: true });
    } else {
      token = await getToken(args.sidecarUrl);
      pass("Token", `obtained from sidecar (${args.sidecarUrl})`);
      results.push({ name: "Token", passed: true });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("Token", msg);
    results.push({ name: "Token", passed: false, detail: msg });
    printSummary(results);
    process.exit(1);
  }

  // Step 2: Discover manifest
  try {
    const res = await fetch(`${baseUrl}/.well-known/agent-storefront.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    if (!manifest.name || !manifest.version) throw new Error("Missing name or version in manifest");
    pass("Manifest", `${manifest.name} v${manifest.version}`);
    results.push({ name: "Manifest", passed: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("Manifest", msg);
    results.push({ name: "Manifest", passed: false, detail: msg });
  }

  // Step 3: Browse catalog
  let catalogItems: Array<{ sku: string }> = [];
  try {
    const res = await fetch(`${baseUrl}/agent-checkout/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const items = data.items ?? data.catalog ?? data;
    if (!Array.isArray(items) || items.length === 0) throw new Error("Empty catalog");
    catalogItems = items;
    pass("Catalog", `${items.length} item(s) available`);
    results.push({ name: "Catalog", passed: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("Catalog", msg);
    results.push({ name: "Catalog", passed: false, detail: msg });
  }

  // Step 4: Create session
  let sessionId: string | null = null;
  try {
    if (catalogItems.length === 0) throw new Error("No catalog items to purchase");
    const firstItem = catalogItems[0]!;
    const res = await fetch(`${baseUrl}/agent-checkout/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: [{ sku: firstItem.sku, quantity: 1 }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    sessionId = data.sessionId ?? data.session_id ?? null;
    if (!sessionId) throw new Error("No sessionId in response");
    pass("Session", `created ${sessionId}`);
    results.push({ name: "Session", passed: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("Session", msg);
    results.push({ name: "Session", passed: false, detail: msg });
  }

  // Step 5: Settle
  try {
    if (!sessionId) throw new Error("No session to settle");
    const res = await fetch(`${baseUrl}/agent-checkout/session/${sessionId}/settle`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const receiptId = data.receipt?.receiptId ?? data.receiptId ?? null;
    if (receiptId) {
      pass("Settle", `receipt ${receiptId}`);
    } else {
      pass("Settle", "settled (no receipt ID returned)");
    }
    results.push({ name: "Settle", passed: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("Settle", msg);
    results.push({ name: "Settle", passed: false, detail: msg });
  }

  printSummary(results);
  const allPassed = results.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

function printSummary(results: StepResult[]) {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`\n  ${passed}/${total} steps passed\n`);
}

run().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
