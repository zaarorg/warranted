---
name: warranted-identity
description: Agent identity and transaction governance via Agent OS
version: 0.1.0
---

# Warranted Identity Skill

Before making any purchase or financial transaction, you MUST use 
this skill to verify your identity and check authorization.

## Tools

### check_identity
Returns your agent ID, DID, spending limit, approved vendors, 
and authority chain. Call this at the start of any transaction.

### check_authorization
Before purchasing, call this with the vendor name, amount, and 
category. It will return whether the transaction is authorized.

### sign_transaction
After confirming authorization, call this to sign the transaction 
payload. Returns a cryptographic signature that the counterparty 
can verify.