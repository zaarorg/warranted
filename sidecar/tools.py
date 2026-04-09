import json
import asyncio
from iatp import TrustSidecar, TrustContext, AgentIdentity
from agent_os import StatelessKernel

# Load identity (in production this comes from your platform's registry)
AGENT_ID = "openclaw-agent-001"
SPENDING_LIMIT = 5000
APPROVED_VENDORS = ["aws", "azure", "gcp"]

kernel = StatelessKernel()
kernel.load_policy_yaml("""
version: "1.0"
name: openclaw-spending-policy
rules:
  - name: block-over-limit
    condition: "action == 'purchase'"
    action: deny
    when: "params.amount > 5000"
  - name: block-unapproved-vendor
    condition: "action == 'purchase'"
    action: deny
    when: "params.vendor not in ['aws', 'azure', 'gcp']"
  - name: escalate-high-value
    condition: "action == 'purchase'"
    action: escalate
    when: "params.amount > 1000"
""")

async def check_identity():
    return {
        "agent_id": AGENT_ID,
        "did": f"did:mesh:{AGENT_ID}",
        "spending_limit": SPENDING_LIMIT,
        "approved_vendors": APPROVED_VENDORS,
        "authority_chain": ["cfo", "vp-eng", AGENT_ID],
        "status": "verified"
    }

async def check_authorization(vendor: str, amount: float, category: str):
    result = await kernel.execute(
        action="purchase",
        params={"vendor": vendor, "amount": amount, "category": category},
        agent_id=AGENT_ID,
        policies=["openclaw-spending-policy"]
    )
    return {
        "authorized": result.allowed,
        "reason": result.reason if not result.allowed else "within policy",
        "requires_approval": amount > 1000,
        "agent_id": AGENT_ID,
        "vendor": vendor,
        "amount": amount
    }

async def sign_transaction(vendor: str, amount: float, item: str):
    auth = await check_authorization(vendor, amount, "compute")
    if not auth["authorized"]:
        return {"signed": False, "reason": auth["reason"]}
    
    # In production, this calls the sidecar's sign() API
    import hashlib, time
    payload = json.dumps({
        "agent_id": AGENT_ID,
        "vendor": vendor,
        "amount": amount,
        "item": item,
        "timestamp": time.time(),
        "nonce": hashlib.sha256(str(time.time()).encode()).hexdigest()[:16]
    })
    
    return {
        "signed": True,
        "payload": json.loads(payload),
        "signature": hashlib.sha256(payload.encode()).hexdigest(),
        "note": "Demo signature - production uses IATP sidecar with real keys"
    }