/**
 * Demo client script that exercises the Warranted Storefront SDK
 * against a running vendor server and sidecar.
 *
 * Usage:
 *   Terminal 1: ED25519_SEED=test-seed-123 uvicorn sidecar.server:app --port 8100
 *   Terminal 2: bun run scripts/demo-vendor-server.ts
 *   Terminal 3: bun run scripts/demo-storefront.ts
 */

const VENDOR_URL = process.env.VENDOR_URL || "http://localhost:3001";
const SIDECAR_URL = process.env.SIDECAR_URL || "http://localhost:8100";

// ANSI colors
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function green(s: string) { return `${GREEN}${s}${RESET}`; }
function red(s: string) { return `${RED}${s}${RESET}`; }
function yellow(s: string) { return `${YELLOW}${s}${RESET}`; }
function cyan(s: string) { return `${CYAN}${s}${RESET}`; }

async function main() {
  console.log(yellow("\nWarranted Storefront SDK — Demo"));
  console.log("=".repeat(60));

  // ═══════════════════════════════════════════
  // HAPPY PATH
  // ═══════════════════════════════════════════
  console.log(green("\nSCENARIO 1: Authorized Purchase (Happy Path)\n"));

  // Step 1: Get JWT from sidecar
  let token: string;
  let did: string;
  try {
    console.log("Step 1: Getting agent JWT from sidecar...");
    const tokenRes = await fetch(`${SIDECAR_URL}/issue_token`, { method: "POST" });
    const tokenData = await tokenRes.json();
    token = tokenData.token;
    did = tokenData.did;
    console.log(green(`  Token received for ${did}`));
  } catch (err) {
    console.error(red(`  Failed to get token: ${err}`));
    process.exit(1);
  }

  // Step 2: Discover storefront
  try {
    console.log("\nStep 2: Discovering storefront...");
    const manifestRes = await fetch(`${VENDOR_URL}/.well-known/agent-storefront.json`);
    const manifest = await manifestRes.json();
    console.log(green(`  Found: ${manifest.name}`));
    console.log(cyan(`  Registry: ${manifest.warranted_registry}`));
    console.log(cyan(`  Payment: ${manifest.accepted_payment.join(", ")}`));
  } catch (err) {
    console.error(red(`  Failed to discover storefront: ${err}`));
  }

  // Step 3: Browse catalog
  try {
    console.log("\nStep 3: Browsing catalog...");
    const catalogRes = await fetch(`${VENDOR_URL}/agent-checkout/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const catalog = await catalogRes.json();
    console.log(green(`  ${catalog.items.length} items available:`));
    for (const item of catalog.items) {
      console.log(cyan(`     - ${item.name}: $${item.price} (${item.category})`));
    }
  } catch (err) {
    console.error(red(`  Failed to browse catalog: ${err}`));
  }

  // Step 4: Create session
  let sessionId: string;
  try {
    console.log("\nStep 4: Creating transaction session...");
    const sessionRes = await fetch(`${VENDOR_URL}/agent-checkout/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ sku: "gpu-hours-100", quantity: 1 }],
        transactionType: "fixed-price",
      }),
    });
    const session = await sessionRes.json();
    sessionId = session.sessionId;
    console.log(green(`  Session created: ${session.sessionId}`));
    console.log(cyan(`  Status: ${session.status}`));
    console.log(cyan(`  Total: $${session.totalAmount}`));
  } catch (err) {
    console.error(red(`  Failed to create session: ${err}`));
    process.exit(1);
  }

  // Step 5: Settle
  try {
    console.log("\nStep 5: Settling transaction...");
    const settleRes = await fetch(
      `${VENDOR_URL}/agent-checkout/session/${sessionId}/settle`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const settlement = await settleRes.json();
    console.log(green("  Settlement complete!"));
    console.log(cyan(`  Receipt: ${settlement.receiptId}`));
    console.log(cyan(`  Settled at: ${settlement.settledAt}`));

    if (settlement.receipt) {
      console.log(yellow("\n  Transaction Receipt:"));
      console.log(cyan(`     Buyer DID: ${settlement.receipt.buyer.did}`));
      console.log(cyan(`     Vendor: ${settlement.receipt.vendor.name}`));
      console.log(cyan(`     Amount: $${settlement.receipt.totalAmount}`));
      console.log(
        cyan(`     Authority Chain: ${settlement.receipt.buyer.authorityChain.join(" -> ")}`)
      );
      console.log(
        cyan(
          `     Compliance: all ${settlement.receipt.compliance.rulesEvaluated.length} rules passed`
        )
      );
      console.log(cyan(`     Settlement: ${settlement.receipt.settlement.method}`));
      console.log(
        cyan(
          `     Platform Signature: ${settlement.receipt.signatures.platformSignature.slice(0, 20)}...`
        )
      );
    }
  } catch (err) {
    console.error(red(`  Failed to settle: ${err}`));
  }

  // ═══════════════════════════════════════════
  // FAILURE PATH
  // ═══════════════════════════════════════════
  console.log("\n" + "=".repeat(60));
  console.log(red("\nSCENARIO 2: Policy Violations (Failure Path)\n"));

  // Failure 1: Over spending limit
  try {
    console.log("Test 1: Purchase exceeding spending limit ($5,000)...");
    const overLimitRes = await fetch(`${VENDOR_URL}/agent-checkout/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ sku: "gpu-hours-500", quantity: 1 }],
        transactionType: "fixed-price",
      }),
    });
    const overLimitBody = await overLimitRes.json();
    console.log(red(`  Blocked! Status: ${overLimitRes.status}`));
    console.log(cyan(`  Error: ${overLimitBody.error.code} — ${overLimitBody.error.message}`));
  } catch (err) {
    console.error(red(`  Unexpected error: ${err}`));
  }

  // Failure 2: No auth token
  try {
    console.log("\nTest 2: Request without authentication...");
    const noAuthRes = await fetch(`${VENDOR_URL}/agent-checkout/catalog`);
    const noAuthBody = await noAuthRes.json();
    console.log(red(`  Blocked! Status: ${noAuthRes.status}`));
    console.log(cyan(`  Error: ${noAuthBody.error.code} — ${noAuthBody.error.message}`));
  } catch (err) {
    console.error(red(`  Unexpected error: ${err}`));
  }

  // Failure 3: Invalid/forged token
  try {
    console.log("\nTest 3: Request with forged token...");
    const forgedRes = await fetch(`${VENDOR_URL}/agent-checkout/catalog`, {
      headers: { Authorization: "Bearer eyJhbGciOiJFZERTQSJ9.fake.fake" },
    });
    const forgedBody = await forgedRes.json();
    console.log(red(`  Blocked! Status: ${forgedRes.status}`));
    console.log(cyan(`  Error: ${forgedBody.error.code} — ${forgedBody.error.message}`));
  } catch (err) {
    console.error(red(`  Unexpected error: ${err}`));
  }

  console.log("\n" + "=".repeat(60));
  console.log(green("Demo complete. All scenarios executed."));
  console.log("=".repeat(60) + "\n");
}

main().catch((err) => {
  console.error(red(`Fatal error: ${err}`));
  process.exit(1);
});
