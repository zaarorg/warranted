"""Tests for rules engine integration in the sidecar.

Tests the Cedar policy engine path, local fallback path, and
dual-layer category enforcement.
"""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Ensure deterministic seed is set before importing sidecar
os.environ["ED25519_SEED"] = "test-seed-for-pytest"


@pytest_asyncio.fixture
async def client():
    """Async HTTP client bound to the sidecar ASGI app."""
    from sidecar.server import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class TestLocalFallbackNotConfigured:
    """Rules engine not configured — RULES_ENGINE_URL is empty."""

    @pytest.mark.asyncio
    async def test_fallback_when_not_configured(self, client):
        """When RULES_ENGINE_URL is empty, falls back to local checks."""
        with patch("sidecar.server.RULES_ENGINE_URL", ""), \
             patch("sidecar.server.AGENT_RULES_ENGINE_ID", ""):
            resp = await client.post(
                "/check_authorization",
                params={"vendor": "aws", "amount": "2500", "category": "compute"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["authorized"] is True
        assert data["policy_engine"] == "local"

    @pytest.mark.asyncio
    async def test_fallback_denies_over_limit(self, client):
        """Local fallback correctly denies over-limit purchases."""
        with patch("sidecar.server.RULES_ENGINE_URL", ""), \
             patch("sidecar.server.AGENT_RULES_ENGINE_ID", ""):
            resp = await client.post(
                "/check_authorization",
                params={"vendor": "aws", "amount": "6000", "category": "compute"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["authorized"] is False
        assert data["policy_engine"] == "local"


class TestLocalFallbackUnreachable:
    """Rules engine configured but unreachable."""

    @pytest.mark.asyncio
    async def test_fallback_when_unreachable(self, client):
        """When rules engine is unreachable, falls back to local checks."""
        with patch("sidecar.server.RULES_ENGINE_URL", "http://localhost:99999"), \
             patch("sidecar.server.AGENT_RULES_ENGINE_ID", "fake-uuid"):
            resp = await client.post(
                "/check_authorization",
                params={"vendor": "aws", "amount": "2500", "category": "compute"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["authorized"] is True
        assert data["policy_engine"] == "local"


class TestCedarPath:
    """Rules engine reachable — Cedar policy evaluation path."""

    @pytest.mark.asyncio
    async def test_cedar_allow(self, client):
        """Cedar Allow decision is mapped to authorized=true."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "decision": "Allow",
            "diagnostics": ["policy0"],
        }
        mock_response.raise_for_status = MagicMock()

        mock_client_instance = AsyncMock()
        mock_client_instance.post.return_value = mock_response
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)

        with patch("sidecar.server.RULES_ENGINE_URL", "http://engine:3001"), \
             patch("sidecar.server.AGENT_RULES_ENGINE_ID", "test-agent-uuid"), \
             patch("httpx.AsyncClient", return_value=mock_client_instance):
            resp = await client.post(
                "/check_authorization",
                params={"vendor": "aws", "amount": "2500", "category": "compute"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["authorized"] is True
        assert data["policy_engine"] == "cedar"
        assert "policy0" in data["diagnostics"]

    @pytest.mark.asyncio
    async def test_cedar_deny(self, client):
        """Cedar Deny decision is mapped to authorized=false."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "decision": "Deny",
            "diagnostics": [],
        }
        mock_response.raise_for_status = MagicMock()

        mock_client_instance = AsyncMock()
        mock_client_instance.post.return_value = mock_response
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)

        with patch("sidecar.server.RULES_ENGINE_URL", "http://engine:3001"), \
             patch("sidecar.server.AGENT_RULES_ENGINE_ID", "test-agent-uuid"), \
             patch("httpx.AsyncClient", return_value=mock_client_instance):
            resp = await client.post(
                "/check_authorization",
                params={"vendor": "aws", "amount": "6000", "category": "compute"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["authorized"] is False
        assert data["policy_engine"] == "cedar"


class TestDualLayerCategoryEnforcement:
    """Cedar allows but sidecar catches unauthorized category locally."""

    @pytest.mark.asyncio
    async def test_cedar_allow_but_category_denied_locally(self, client):
        """Even if Cedar says Allow, unauthorized categories are blocked."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "decision": "Allow",
            "diagnostics": ["policy0"],
        }
        mock_response.raise_for_status = MagicMock()

        mock_client_instance = AsyncMock()
        mock_client_instance.post.return_value = mock_response
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)

        with patch("sidecar.server.RULES_ENGINE_URL", "http://engine:3001"), \
             patch("sidecar.server.AGENT_RULES_ENGINE_ID", "test-agent-uuid"), \
             patch("httpx.AsyncClient", return_value=mock_client_instance):
            resp = await client.post(
                "/check_authorization",
                params={"vendor": "aws", "amount": "100", "category": "weapons"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["authorized"] is False
        assert data["policy_engine"] == "cedar"
        # Check that the category denial reason is present
        reasons = data["reasons"]
        assert any("weapons" in r.lower() or "category" in r.lower() for r in reasons)
