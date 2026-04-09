---
name: warranted-identity
description: "Agent identity and transaction governance via Warranted. Use when: agent needs to verify identity, check spending authorization, or sign financial transactions. NOT for: non-financial operations."
version: 0.3.0
metadata:
  {
    "openclaw":
      {
        "requires": { "bins": ["curl"] },
      },
  }
---

# Warranted Identity Skill

Before making any purchase or financial transaction, you MUST use
this skill to verify your identity and check authorization.

## Rules

- ALWAYS call check_identity first
- NEVER purchase without calling check_authorization
- If authorized is false, STOP and report the reason

## Commands

### check_identity

Returns your agent DID (Ed25519 crypto identity), public key,
trust score, spending limit, and approved vendors.

```bash
curl -s http://warranted-sidecar:8100/check_identity
```

### check_authorization

Before purchasing, call this with the vendor name, amount, and
category. Returns whether the transaction is authorized, along
with your DID and trust score.

```bash
curl -s -X POST "http://warranted-sidecar:8100/check_authorization?vendor=VENDOR&amount=AMOUNT&category=CATEGORY"
```

Example:

```bash
curl -s -X POST "http://warranted-sidecar:8100/check_authorization?vendor=aws&amount=500&category=compute"
```

### sign_transaction

After confirming authorization, call this to sign the transaction
with Ed25519. Returns a cryptographic signature verifiable with the
public key.

```bash
curl -s -X POST "http://warranted-sidecar:8100/sign_transaction?vendor=VENDOR&amount=AMOUNT&item=ITEM&category=CATEGORY"
```

Example:

```bash
curl -s -X POST "http://warranted-sidecar:8100/sign_transaction?vendor=aws&amount=500&item=ec2-instance&category=compute"
```

### verify_signature

Verify an Ed25519 signature against a payload. Use this to confirm
that a previously signed transaction is authentic.

```bash
curl -s -G "http://warranted-sidecar:8100/verify_signature" --data-urlencode "payload=PAYLOAD_JSON" --data-urlencode "signature=SIGNATURE_B64"
```
