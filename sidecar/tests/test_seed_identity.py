"""Tests for deterministic Ed25519 key derivation from ED25519_SEED."""

import hashlib
import os

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


def _did_from_seed(seed: str) -> str:
    """Reproduce the sidecar's key derivation logic to compute expected DID."""
    seed_bytes = hashlib.sha256(seed.encode()).digest()
    private_key = Ed25519PrivateKey.from_private_bytes(seed_bytes)
    pub_bytes = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    pub_hash = hashlib.sha256(pub_bytes).hexdigest()
    return f"did:mesh:{pub_hash[:40]}"


class TestSeedIdentity:
    def test_same_seed_produces_same_did(self, seed: str):
        """Same seed must always produce the same DID."""
        did_1 = _did_from_seed(seed)
        did_2 = _did_from_seed(seed)
        assert did_1 == did_2

    def test_different_seed_produces_different_did(self, seed: str):
        """Different seeds must produce different DIDs."""
        did_original = _did_from_seed(seed)
        did_other = _did_from_seed("completely-different-seed")
        assert did_original != did_other

    def test_did_format(self, seed: str):
        """DID must follow the did:mesh:<hex> format."""
        did = _did_from_seed(seed)
        assert did.startswith("did:mesh:")
        hex_part = did.split(":")[-1]
        assert len(hex_part) == 40
        # Verify it's valid hex
        int(hex_part, 16)

    def test_sidecar_module_uses_seed(self, seed: str):
        """The running sidecar module should use the seed from env."""
        from sidecar.server import AGENT_DID

        expected_did = _did_from_seed(seed)
        assert AGENT_DID == expected_did


class TestRandomFallback:
    def test_random_key_without_seed(self):
        """Without ED25519_SEED, each key generation is random."""
        key_1 = Ed25519PrivateKey.generate()
        key_2 = Ed25519PrivateKey.generate()
        pub_1 = key_1.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        pub_2 = key_2.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        # Extremely unlikely to be equal
        assert pub_1 != pub_2
