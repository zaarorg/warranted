"""Tests for the POST /issue_token endpoint."""

import time

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_issue_token_returns_jwt(client: AsyncClient):
    """Endpoint returns a token string, DID, and expiration."""
    response = await client.post("/issue_token")
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert "did" in data
    assert "expires_at" in data
    assert data["did"].startswith("did:mesh:")


@pytest.mark.asyncio
async def test_jwt_has_correct_claims(client: AsyncClient):
    """JWT decodes to the expected claims structure."""
    from sidecar.server import PUBLIC_KEY

    response = await client.post("/issue_token")
    data = response.json()
    token = data["token"]

    pub_pem = PUBLIC_KEY.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    decoded = pyjwt.decode(token, pub_pem, algorithms=["EdDSA"])

    assert decoded["sub"] == data["did"]
    assert decoded["iss"] == "warranted-sidecar"
    assert "iat" in decoded
    assert "exp" in decoded
    assert decoded["agentId"] == "openclaw-agent-001"
    assert isinstance(decoded["spendingLimit"], int)
    assert isinstance(decoded["categories"], list)
    assert isinstance(decoded["approvedVendors"], list)
    assert isinstance(decoded["authorityChain"], list)
    assert decoded["dailySpendLimit"] > 0


@pytest.mark.asyncio
async def test_jwt_signature_verifiable(client: AsyncClient):
    """JWT signature must verify against the sidecar's public key."""
    from sidecar.server import PUBLIC_KEY

    response = await client.post("/issue_token")
    token = response.json()["token"]

    pub_pem = PUBLIC_KEY.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    # This will raise if signature is invalid
    decoded = pyjwt.decode(token, pub_pem, algorithms=["EdDSA"])
    assert decoded["sub"].startswith("did:mesh:")


@pytest.mark.asyncio
async def test_jwt_expiration_is_24h(client: AsyncClient):
    """Token should expire approximately 24 hours from now."""
    from sidecar.server import PUBLIC_KEY

    response = await client.post("/issue_token")
    token = response.json()["token"]

    pub_pem = PUBLIC_KEY.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    decoded = pyjwt.decode(token, pub_pem, algorithms=["EdDSA"])

    ttl = decoded["exp"] - decoded["iat"]
    assert ttl == 86400  # exactly 24 hours


@pytest.mark.asyncio
async def test_jwt_invalid_with_wrong_key(client: AsyncClient):
    """Token must not verify with a different key."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    response = await client.post("/issue_token")
    token = response.json()["token"]

    # Generate a random different key
    wrong_key = Ed25519PrivateKey.generate().public_key()
    wrong_pem = wrong_key.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)

    with pytest.raises(pyjwt.exceptions.InvalidSignatureError):
        pyjwt.decode(token, wrong_pem, algorithms=["EdDSA"])
