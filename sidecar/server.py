import json
import hashlib
import logging
import os
import time
import base64
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
ED25519_SEED = os.environ.get("ED25519_SEED")

if ED25519_SEED:
    # Derive a deterministic 32-byte seed from the env var
    _seed_bytes = hashlib.sha256(ED25519_SEED.encode()).digest()
    PRIVATE_KEY = Ed25519PrivateKey.from_private_bytes(_seed_bytes)
    logger.info("Ed25519 key derived from ED25519_SEED (deterministic)")
else:
    PRIVATE_KEY = Ed25519PrivateKey.generate()
    logger.warning(
        "ED25519_SEED not set — using random key. DID will change on restart."
    )

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
# Spending policy (unchanged)
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
# Rules Engine integration
# ---------------------------------------------------------------------------
RULES_ENGINE_URL = os.environ.get("RULES_ENGINE_URL", "")
AGENT_RULES_ENGINE_ID = os.environ.get("AGENT_RULES_ENGINE_ID", "")


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


async def _check_rules_engine(vendor: str, amount: float, category: str) -> dict | None:
    """Call the rules engine POST /check endpoint. Returns None if unreachable."""
    if not RULES_ENGINE_URL or not AGENT_RULES_ENGINE_ID:
        return None

    check_request = {
        "principal": f'Agent::"{AGENT_RULES_ENGINE_ID}"',
        "action": 'Action::"purchase.initiate"',
        "resource": 'Resource::"any"',
        "context": {
            "amount": amount,
            "vendor": vendor,
        },
    }

    try:
        import httpx

        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{RULES_ENGINE_URL}/check",
                json=check_request,
            )
            resp.raise_for_status()
            return resp.json()
    except ImportError:
        logger.warning("httpx not installed, skipping rules engine")
        return None
    except Exception as e:
        logger.warning(f"Rules engine unreachable: {e}")
        return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
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

    # Try rules engine first
    cedar_result = await _check_rules_engine(vendor, amount, category)

    if cedar_result is not None:
        authorized = cedar_result.get("decision") == "Allow"
        diagnostics = cedar_result.get("diagnostics", [])

        # Dual-layer category enforcement: Cedar doesn't check category yet,
        # so enforce it locally even if Cedar says Allow
        if authorized and category not in PERMITTED_CATEGORIES:
            authorized = False

        reasons = []
        if not authorized:
            if amount > SPENDING_LIMIT:
                reasons.append(f"Amount ${amount} exceeds limit of ${SPENDING_LIMIT}")
            if vendor not in APPROVED_VENDORS:
                reasons.append(f"Vendor '{vendor}' not on approved list")
            if category not in PERMITTED_CATEGORIES:
                reasons.append(f"Category '{category}' not authorized")
            if not reasons:
                reasons.append("Denied by policy engine")

        return {
            "authorized": authorized,
            "reasons": reasons if reasons else ["within policy"],
            "requires_approval": amount > 1000,
            "agent_id": AGENT_ID,
            "did": AGENT_DID,
            "trust_score": score.score,
            "trust_level": trust_level.value,
            "vendor": vendor,
            "amount": amount,
            "category": category,
            "policy_engine": "cedar",
            "diagnostics": diagnostics,
        }

    # Fallback: local checks (rules engine unreachable or not configured)
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
        "policy_engine": "local",
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
