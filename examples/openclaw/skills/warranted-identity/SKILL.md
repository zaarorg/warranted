---
name: warranted-identity
description: "Agent identity, transaction governance, and storefront purchasing via Warranted. Use when: agent needs to verify identity, check spending authorization, sign transactions, or purchase from a vendor storefront. NOT for: non-financial operations."
version: 0.3.0
metadata:
  {
    "openclaw":
      {
        "requires": { "bins": ["curl", "jq"] },
      },
  }
---

# Warranted Identity & Commerce Skill

You have access to a governance sidecar and a vendor storefront on
the Docker network.

## Services

- Governance sidecar: http://warranted-sidecar:8100
- Demo vendor storefront: http://demo-vendor:3001

## Identity & Authorization

### Check your identity

Returns your agent ID, DID, spending limit, and approved vendors.

```bash
curl -s http://warranted-sidecar:8100/check_identity
```

### View your governance policies

Returns all policies that apply to this agent, including the resolved
envelope (effective constraints per action type) and assigned policies.

```bash
curl -s http://warranted-sidecar:8100/my_policies
```

### Check if a purchase is authorized

Returns whether the transaction is authorized and why.

```bash
curl -s -X POST "http://warranted-sidecar:8100/check_authorization?vendor=VENDOR&amount=AMOUNT&category=CATEGORY"
```

Example:

```bash
curl -s -X POST "http://warranted-sidecar:8100/check_authorization?vendor=vendor-acme-001&amount=2500&category=compute"
```

### Get a transaction token

Returns a JWT you'll use for storefront requests. Save the "token" field value.

```bash
curl -s -X POST http://warranted-sidecar:8100/issue_token
```

## Storefront Purchasing

### Step 1: Discover the storefront

Shows what the vendor sells, accepted payment methods, and auth requirements.

```bash
curl -s http://demo-vendor:3001/.well-known/agent-storefront.json
```

### Step 2: Get your token

```bash
TOKEN=$(curl -s -X POST http://warranted-sidecar:8100/issue_token | jq -r .token)
```

### Step 3: Browse the catalog

Shows available items with prices and categories.

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://demo-vendor:3001/agent-checkout/catalog
```

### Step 4: Create a purchase session

Creates a transaction session. Save the sessionId.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"items":[{"sku":"SKU_HERE","quantity":1}],"transactionType":"fixed-price"}' http://demo-vendor:3001/agent-checkout/session
```

### Step 5: Settle the transaction

Completes the purchase and returns a signed receipt.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://demo-vendor:3001/agent-checkout/session/SESSION_ID/settle
```

## Rules

- ALWAYS check your identity first before any transaction
- ALWAYS get a fresh token before storefront requests
- NEVER proceed with a purchase without checking authorization
- If any step returns an error, report the error code and reason
- If authorized is false, STOP and explain why the purchase was denied
