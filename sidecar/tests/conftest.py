import os
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Set a deterministic seed before importing the sidecar module
os.environ["ED25519_SEED"] = "test-seed-for-pytest"


@pytest.fixture
def seed():
    """Return the deterministic seed used for tests."""
    return "test-seed-for-pytest"


@pytest_asyncio.fixture
async def client():
    """Async HTTP client bound to the sidecar ASGI app."""
    from sidecar.server import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
