# agentmesh-platform

## 1. Package Overview

The zero-trust identity and trust mesh for AI agent ecosystems. Provides Ed25519 cryptographic identity, SPIFFE/SVID support, trust scoring (0-1000), delegation chains, protocol bridges (A2A, MCP, IATP), governance policies with compliance frameworks, shadow mode for safe policy testing, and a reward/learning engine.

- **Package name**: `agentmesh-platform` (PyPI), import as `agentmesh`
- **Version**: 3.0.2
- **Language**: Python >=3.11
- **Install**: `pip install agentmesh-platform`
- **Core dependencies**: pydantic[email], cryptography, pynacl, httpx, aiohttp, pyyaml, structlog, click, rich
- **Build system**: hatchling
- **CLI**: `agentmesh` command

### Optional Extras

| Extra | What it adds |
|-------|-------------|
| `redis` | Redis for distributed state |
| `server` | FastAPI + uvicorn for API server |
| `storage` | Redis async + SQLAlchemy + asyncpg |
| `observability` | OpenTelemetry + Prometheus |
| `langchain` | langchain-core integration |
| `django` | Django middleware support |
| `websocket` | WebSocket transport |
| `grpc` | gRPC transport |
| `agent-os` | Bridge to agent-os-kernel |
| `all` | server + storage + observability |

## 2. Architecture

### Directory Structure

```
packages/agent-mesh/src/agentmesh/
├── __init__.py          # Re-exports identity, trust, governance, reward, client
├── identity/            # AgentIdentity, AgentDID, Credential, SPIFFE, delegation
├── trust/               # TrustBridge, TrustHandshake, CapabilityScope/Grant/Registry
├── governance/          # PolicyEngine, Policy, ComplianceEngine, AuditLog, ShadowMode
├── reward/              # RewardEngine, TrustScore, RewardDimension
├── client.py            # AgentMeshClient (unified API)
├── trust_types.py       # AgentProfile, TrustRecord, TrustTracker
├── exceptions.py        # Exception hierarchy
├── core/                # Core utilities
├── cli/                 # CLI commands (trust report, etc.)
├── dashboard/           # Web dashboard
├── events/              # Event bus, analytics
├── gateway/             # API gateway
├── integrations/        # Framework integrations (langchain, crewai, django, mcp, etc.)
├── marketplace/         # Marketplace integration
├── observability/       # OTel, Prometheus exporters
├── services/            # API services
├── storage/             # Redis, SQL backends
└── transport/           # WebSocket, gRPC, base transport
```

### SDKs (non-Python)

```
packages/agent-mesh/sdks/
├── typescript/          # @agentmesh/sdk (npm)
├── rust/                # agentmesh + agentmesh-mcp (crates.io)
└── go/                  # agentmesh Go module
```

## 3. Key APIs

### Identity

```python
from agentmesh import AgentIdentity, AgentDID, Credential, CredentialManager

# Generate new identity with Ed25519 keypair
identity = AgentIdentity.generate("my-agent")
# identity.did → "did:mesh:..." (decentralized identifier)
# identity.public_key → Ed25519 public key bytes

# SPIFFE identity support
from agentmesh import SPIFFEIdentity, SVID
spiffe = SPIFFEIdentity(spiffe_id="spiffe://example.org/agent/my-agent")

# Delegation chains
from agentmesh import DelegationLink, ScopeChain, HumanSponsor
link = DelegationLink(delegator=parent_identity, delegate=child_identity, scopes=["read"])
```

### Trust

```python
from agentmesh import TrustBridge, TrustHandshake, HandshakeResult

bridge = TrustBridge()
result = bridge.verify(identity)
# result includes trust score (0-1000), tier, capabilities

# Trust handshake between agents
handshake = TrustHandshake(initiator=alice, responder=bob)
result: HandshakeResult = await handshake.execute()

# Capability-based access
from agentmesh import CapabilityScope, CapabilityGrant, CapabilityRegistry
registry = CapabilityRegistry()
grant = CapabilityGrant(identity=identity, scope=CapabilityScope(actions=["read", "write"]))
registry.register(grant)
```

### Governance

```python
from agentmesh import PolicyEngine, Policy, PolicyRule, PolicyDecision
from agentmesh import ComplianceEngine, ComplianceFramework, ComplianceReport

# Policy evaluation
engine = PolicyEngine()
engine.load_rego("policies/mesh.rego", package="agentmesh")
decision: PolicyDecision = engine.evaluate("did:mesh:agent-1", {"tool_name": "analyze"})

# Compliance frameworks
compliance = ComplianceEngine()
report: ComplianceReport = compliance.evaluate(framework=ComplianceFramework.SOC2)

# Shadow mode — test policies without enforcing
from agentmesh import ShadowMode, ShadowResult
shadow = ShadowMode(engine)
result: ShadowResult = shadow.evaluate(action)  # logs but doesn't block
```

### Audit

```python
from agentmesh import AuditLog, AuditEntry, AuditChain

log = AuditLog()
log.append(AuditEntry(agent_id="agent-1", action="tool_call", decision="allow"))
chain = AuditChain(log)  # hash-chained for tamper evidence
```

### Reward Engine

```python
from agentmesh import RewardEngine, TrustScore, RewardDimension, RewardSignal

engine = RewardEngine()
signal = RewardSignal(agent_id="agent-1", dimension=RewardDimension.COMPLIANCE, value=0.95)
engine.record(signal)
score: TrustScore = engine.compute_score("agent-1")
```

### Unified Client

```python
from agentmesh import AgentMeshClient, GovernanceResult

client = AgentMeshClient(agent_id="my-agent")
result: GovernanceResult = client.execute_with_governance(action="data.read", params=None)
```

## 4. Usage Patterns

### Register agent and verify trust

```python
from agentmesh import AgentIdentity, TrustBridge, CapabilityRegistry, CapabilityGrant, CapabilityScope

identity = AgentIdentity.generate("analyzer-agent")
bridge = TrustBridge()
bridge.register(identity)

registry = CapabilityRegistry()
registry.register(CapabilityGrant(
    identity=identity,
    scope=CapabilityScope(actions=["read", "analyze"])
))

# Later, verify before action
verification = bridge.verify(identity)
if verification.trust_score >= 500:
    # Standard tier — proceed
    pass
```

### Cross-agent communication with trust gates

```python
from agentmesh import TrustHandshake, AgentIdentity

alice = AgentIdentity.generate("alice")
bob = AgentIdentity.generate("bob")

handshake = TrustHandshake(initiator=alice, responder=bob)
result = await handshake.execute()
if result.success:
    # Secure channel established
    pass
```

## 5. Configuration

| Config | Type | Purpose |
|--------|------|---------|
| Trust score thresholds | Constructor params on TrustBridge | Define tier boundaries |
| Storage backend | `[storage]` extra + connection string | Redis/SQL for distributed state |
| Transport | `[websocket]` or `[grpc]` extra | Inter-agent communication |
| OTel endpoint | Environment variable | Observability export |

### CLI

```bash
agentmesh trust report           # Visualize trust scores and agent activity
agentmesh identity generate      # Generate new agent identity
```

## 6. Development Notes

### Running Tests

```bash
cd packages/agent-mesh
pytest tests/ -x -q
pytest tests/ -m "not slow"        # Skip load tests
pytest tests/ -m benchmark         # Crypto benchmarks
pytest tests/ -m fuzz              # Fuzzing tests
```

### Python Version

Requires Python **>=3.11** (stricter than most packages which support 3.9+).

### Test Markers

- `fuzz` — fuzzing tests with malformed inputs
- `benchmark` — crypto operation benchmarks
- `slow` — long-running load tests
- `integration` — E2E integration tests

## 7. Relevance to Our Project

**Use**: `AgentIdentity`, `TrustBridge`, `TrustHandshake`, `PolicyEngine`, `AuditLog`, `CapabilityRegistry`, `AgentMeshClient`

**Skip**: Dashboard, marketplace integration, most transport layers (unless we need gRPC/WebSocket between agents)

**Architecture mapping**: AgentMesh provides the identity layer for our registry (every agent gets a DID), trust scoring for our compliance layer, and audit chain for our audit trail. The `TrustHandshake` enables secure merchant-to-platform agent communication.
