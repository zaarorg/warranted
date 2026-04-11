import { Hono } from "hono";
import { WarrantedSDK } from "../../../packages/storefront-sdk/src/index";

const sidecarUrl = process.env.SIDECAR_URL || "http://localhost:8100";
const port = Number(process.env.PORT) || 3001;

const warranted = new WarrantedSDK({
  vendorId: "vendor-acme-001",
  registryUrl: sidecarUrl,
  webhookSecret: "whsec_demo",
  minTrustScore: 0,
  catalog: [
    {
      sku: "gpu-hours-100",
      name: "100 GPU Hours (A100)",
      price: 2500,
      currency: "usd",
      category: "compute",
      available: true,
    },
    {
      sku: "gpu-hours-500",
      name: "500 GPU Hours (A100)",
      price: 10000,
      currency: "usd",
      category: "compute",
      available: true,
    },
    {
      sku: "api-credits-10k",
      name: "10K API Credits",
      price: 500,
      currency: "usd",
      category: "api-credits",
      available: true,
    },
  ],
});

warranted.onSettlement(async (event) => {
  console.log("\n  SETTLEMENT RECEIVED");
  console.log(`  Session: ${event.sessionId}`);
  console.log(`  Agent: ${event.agentDid}`);
  console.log(
    `  Items: ${event.items.map((i) => `${i.sku} x${i.quantity}`).join(", ")}`
  );
  console.log(`  Total: $${event.totalAmount}`);
  console.log(`  Receipt: ${event.receiptId}`);
});

const app = new Hono();

app.get("/", (c) =>
  c.json({ name: "Acme Cloud Compute Demo Vendor", status: "running" })
);

app.route("/", warranted.routes());

console.log("Acme Cloud Compute — Demo Vendor Server");
console.log(`   Listening on http://localhost:${port}`);
console.log(`   Sidecar: ${sidecarUrl}`);
console.log(`   Catalog: 3 items`);

export default {
  port,
  fetch: app.fetch,
};
