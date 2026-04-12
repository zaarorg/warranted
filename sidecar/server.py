import json
import hashlib
import logging
import os
import time
import base64
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    PrivateFormat,
    NoEncryption,
)
from iatp.attestation import ReputationManager
from iatp.models import TrustLevel

logger = logging.getLogger("warranted-sidecar")

app = FastAPI()

# ---------------------------------------------------------------------------
# Crypto identity — deterministic from seed or random at startup
# ---------------------------------------------------------------------------
ED25519_SEED = os.environ.get("ED25519_SEED", "demo-seed-123")

# Derive a deterministic 32-byte seed from the env var
_seed_bytes = hashlib.sha256(ED25519_SEED.encode()).digest()
PRIVATE_KEY = Ed25519PrivateKey.from_private_bytes(_seed_bytes)
logger.info("Ed25519 key derived from ED25519_SEED (deterministic)")

PUBLIC_KEY = PRIVATE_KEY.public_key()
PUBLIC_KEY_B64 = base64.b64encode(
    PUBLIC_KEY.public_bytes(Encoding.Raw, PublicFormat.Raw)
).decode()

# DID derived from the public key hash (real crypto, not a human label)
_pub_bytes = PUBLIC_KEY.public_bytes(Encoding.Raw, PublicFormat.Raw)
_pub_hash = hashlib.sha256(_pub_bytes).hexdigest()
AGENT_DID = f"did:mesh:{_pub_hash[:40]}"

# ---------------------------------------------------------------------------
# Reputation / trust
# ---------------------------------------------------------------------------
reputation_mgr = ReputationManager()
AGENT_ID = "openclaw-agent-001"
_score = reputation_mgr.get_or_create_score(AGENT_ID)
reputation_mgr.record_success(AGENT_ID, trace_id="boot")

# ---------------------------------------------------------------------------
# Rules engine proxy (Phase 4)
# ---------------------------------------------------------------------------
RULES_ENGINE_URL = os.environ.get("RULES_ENGINE_URL", "")
INTERNAL_API_SECRET = os.environ.get("INTERNAL_API_SECRET", "")

# ---------------------------------------------------------------------------
# Spending policy (fallback when rules engine is not configured)
# ---------------------------------------------------------------------------
SPENDING_LIMIT = 5000
APPROVED_VENDORS = ["aws", "azure", "gcp", "github", "vercel", "railway", "vendor-acme-001"]
PERMITTED_CATEGORIES = ["compute", "software-licenses", "cloud-services", "api-credits"]

# Authority chain — DIDs of the delegation chain above this agent
AUTHORITY_CHAIN = [
    "did:mesh:cfo",
    "did:mesh:vp-eng",
    AGENT_DID,
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _sign(payload_bytes: bytes) -> str:
    """Sign bytes with our Ed25519 private key, return base64 signature."""
    return base64.b64encode(PRIVATE_KEY.sign(payload_bytes)).decode()


def _verify(payload_bytes: bytes, signature_b64: str) -> bool:
    """Verify an Ed25519 signature against our public key."""
    try:
        sig = base64.b64decode(signature_b64)
        PUBLIC_KEY.verify(sig, payload_bytes)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
PLATFORM_TEAM_GROUP_ID = "00000000-0000-0000-0000-000000000021"


@app.on_event("startup")
async def register_agent_in_rules_engine():
    """Register this agent's DID in the rules engine Platform team on startup."""
    if not RULES_ENGINE_URL:
        return
    base_url = RULES_ENGINE_URL.rsplit("/check", 1)[0]
    members_url = f"{base_url}/groups/{PLATFORM_TEAM_GROUP_ID}/members"
    headers = {}
    if INTERNAL_API_SECRET:
        headers["X-Internal-Token"] = INTERNAL_API_SECRET
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                members_url,
                json={"agentDid": AGENT_DID},
                headers=headers,
            )
            if resp.status_code in (200, 201):
                logger.info(f"Registered agent {AGENT_DID} in Platform team")
            elif resp.status_code == 409:
                logger.info(f"Agent {AGENT_DID} already registered in Platform team")
            else:
                logger.warning(f"Agent registration returned {resp.status_code}: {resp.text}")
    except Exception as e:
        logger.warning(f"Could not register agent in rules engine: {e}")


@app.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)


@app.get("/")
async def root():
    return {
        "service": "warranted-governance-sidecar",
        "status": "running",
        "endpoints": [
            "/check_identity",
            "/check_authorization",
            "/sign_transaction",
            "/verify_signature",
            "/issue_token",
            "/my_policies",
        ],
    }


@app.get("/check_identity")
async def check_identity():
    score = reputation_mgr.get_or_create_score(AGENT_ID)
    trust_level = reputation_mgr.get_trust_level(AGENT_ID)
    return {
        "agent_id": AGENT_ID,
        "did": AGENT_DID,
        "public_key": PUBLIC_KEY_B64,
        "trust_score": score.score,
        "trust_level": trust_level.value,
        "lifecycle_state": "active",
        "spending_limit": SPENDING_LIMIT,
        "approved_vendors": APPROVED_VENDORS,
        "authority_chain": AUTHORITY_CHAIN,
        "status": "verified",
    }


@app.post("/check_authorization")
async def check_authorization(vendor: str, amount: float, category: str):
    score = reputation_mgr.get_or_create_score(AGENT_ID)
    trust_level = reputation_mgr.get_trust_level(AGENT_ID)

    # Proxy to rules engine when configured
    if RULES_ENGINE_URL:
        try:
            check_request = {
                "principal": f'Agent::"{AGENT_DID}"',
                "action": 'Action::"purchase.initiate"',
                "resource": f'Resource::"{vendor}"',
                "context": {
                    "amount": amount,
                    "vendor": vendor,
                    "category": category,
                },
            }
            headers = {}
            if INTERNAL_API_SECRET:
                headers["X-Internal-Token"] = INTERNAL_API_SECRET
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    RULES_ENGINE_URL,
                    json=check_request,
                    headers=headers,
                )
                result = response.json()

            data = result.get("data", result)  # unwrap { success, data } envelope
            authorized = data.get("decision") == "Allow"
            diagnostics = data.get("diagnostics", [])
            reasons = diagnostics if not authorized and diagnostics else (["within policy"] if authorized else ["policy denied"])
            requires_approval = data.get("details", {}).get("requires_human_approval", False)

            return {
                "authorized": authorized,
                "reasons": reasons,
                "requires_approval": requires_approval,
                "agent_id": AGENT_ID,
                "did": AGENT_DID,
                "trust_score": score.score,
                "trust_level": trust_level.value,
                "vendor": vendor,
                "amount": amount,
                "category": category,
            }
        except Exception as e:
            logger.warning(f"Rules engine proxy failed, falling back to local checks: {e}")

    # Fallback to hardcoded checks (existing behavior)
    reasons = []
    if amount > SPENDING_LIMIT:
        reasons.append(f"Amount ${amount} exceeds limit of ${SPENDING_LIMIT}")
    if vendor not in APPROVED_VENDORS:
        reasons.append(f"Vendor '{vendor}' not on approved list")
    if category not in PERMITTED_CATEGORIES:
        reasons.append(f"Category '{category}' not authorized")

    return {
        "authorized": len(reasons) == 0,
        "reasons": reasons if reasons else ["within policy"],
        "requires_approval": amount > 1000,
        "agent_id": AGENT_ID,
        "did": AGENT_DID,
        "trust_score": score.score,
        "trust_level": trust_level.value,
        "vendor": vendor,
        "amount": amount,
        "category": category,
    }


@app.post("/sign_transaction")
async def sign_transaction(
    vendor: str, amount: float, item: str, category: str = "compute"
):
    auth = await check_authorization(vendor, amount, category)
    if not auth["authorized"]:
        return {"signed": False, "reasons": auth["reasons"]}

    payload = json.dumps(
        {
            "agent_id": AGENT_ID,
            "did": AGENT_DID,
            "vendor": vendor,
            "amount": amount,
            "item": item,
            "timestamp": time.time(),
            "nonce": hashlib.sha256(str(time.time()).encode()).hexdigest()[:16],
        },
        sort_keys=True,
    )

    signature = _sign(payload.encode())

    return {
        "signed": True,
        "payload": json.loads(payload),
        "signature": signature,
        "public_key": PUBLIC_KEY_B64,
        "algorithm": "Ed25519",
    }


@app.get("/verify_signature")
async def verify_signature(payload: str, signature: str):
    valid = _verify(payload.encode(), signature)
    return {
        "valid": valid,
        "did": AGENT_DID,
        "public_key": PUBLIC_KEY_B64,
        "algorithm": "Ed25519",
    }


@app.get("/my_policies")
async def my_policies():
    """Return all Cedar policies governing this agent from the rules engine."""
    if not RULES_ENGINE_URL:
        return {
            "source": "local",
            "agent_did": AGENT_DID,
            "cedar_policies": [],
            "note": "Rules engine not configured — no Cedar policies available",
        }

    base_url = RULES_ENGINE_URL.rsplit("/check", 1)[0]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 1. Find which groups this agent belongs to
            members_resp = await client.get(
                f"{base_url}/groups/{PLATFORM_TEAM_GROUP_ID}/members"
            )
            # 2. Walk ancestors to get full group hierarchy
            ancestors_resp = await client.get(
                f"{base_url}/groups/{PLATFORM_TEAM_GROUP_ID}/ancestors"
            )
            ancestor_groups = ancestors_resp.json().get("data", [])
            group_ids = [g["id"] for g in ancestor_groups]

            # 3. Collect policy assignments from all groups in the hierarchy
            seen_policy_ids = set()
            for gid in group_ids:
                assignments_resp = await client.get(
                    f"{base_url}/assignments", params={"groupId": gid}
                )
                for a in assignments_resp.json().get("data", []):
                    seen_policy_ids.add(a["policyId"])

            # Also check direct agent assignments
            agent_assignments_resp = await client.get(
                f"{base_url}/assignments", params={"agentDid": AGENT_DID}
            )
            for a in agent_assignments_resp.json().get("data", []):
                seen_policy_ids.add(a["policyId"])

            # 4. Fetch each policy with its active version Cedar source
            cedar_policies = []
            for pid in seen_policy_ids:
                policy_resp = await client.get(f"{base_url}/rules/{pid}")
                policy = policy_resp.json().get("data", {})
                if not policy.get("activeVersionId"):
                    continue

                versions_resp = await client.get(f"{base_url}/rules/{pid}/versions")
                versions = versions_resp.json().get("data", [])
                active = next(
                    (v for v in versions if v["id"] == policy["activeVersionId"]),
                    None,
                )
                if active and active.get("cedarSource"):
                    cedar_policies.append({
                        "name": policy["name"],
                        "domain": policy["domain"],
                        "effect": policy["effect"],
                        "version": active.get("versionNumber", 1),
                        "cedar_source": active["cedarSource"],
                        "cedar_hash": active.get("cedarHash", ""),
                    })

        return {
            "source": "rules-engine",
            "agent_did": AGENT_DID,
            "policy_count": len(cedar_policies),
            "cedar_policies": cedar_policies,
        }
    except Exception as e:
        logger.warning(f"Failed to fetch policies from rules engine: {e}")
        return {
            "source": "local-fallback",
            "agent_did": AGENT_DID,
            "error": str(e),
            "cedar_policies": [],
        }


@app.post("/issue_token")
async def issue_token():
    """Issue a JWT signed with the sidecar's Ed25519 private key (EdDSA)."""
    import jwt
    from datetime import datetime, timezone

    now = int(time.time())
    exp = now + 86400  # 24 hours

    claims = {
        "sub": AGENT_DID,
        "iss": "warranted-sidecar",
        "iat": now,
        "exp": exp,
        "agentId": AGENT_ID,
        "spendingLimit": SPENDING_LIMIT,
        "dailySpendLimit": SPENDING_LIMIT * 2,
        "categories": PERMITTED_CATEGORIES,
        "approvedVendors": APPROVED_VENDORS,
        "authorityChain": AUTHORITY_CHAIN,
    }

    # PyJWT needs PEM-encoded private key for EdDSA
    private_key_pem = PRIVATE_KEY.private_bytes(
        Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
    )

    token = jwt.encode(claims, private_key_pem, algorithm="EdDSA")

    expires_at = datetime.fromtimestamp(exp, tz=timezone.utc).isoformat()

    return {
        "token": token,
        "did": AGENT_DID,
        "expires_at": expires_at,
    }
