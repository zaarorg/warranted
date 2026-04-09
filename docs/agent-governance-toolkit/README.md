# Agent Governance Toolkit — Reference Documentation

> Generated from commit `20c876dd` on 2026-04-09

## 1. Overview

Agent Governance Toolkit (AGT) is a Microsoft open-source monorepo providing runtime governance infrastructure for AI agents. It provides deterministic policy enforcement, zero-trust identity, execution sandboxing, and SRE primitives across Python, TypeScript, .NET, Rust, and Go. It covers all 10 OWASP Agentic Top 10 risks (ASI-01 through ASI-10) with 9,500+ tests.

This is **not** a prompt guardrails or content moderation tool — it governs agent *actions* (tool calls, resource access, inter-agent communication) at the application layer.

## 2. Ecosystem Map

| Package | Directory | Language | PyPI / Registry Name | Maturity | Key Dependencies |
|---------|-----------|----------|---------------------|----------|-----------------|
| Agent OS | `packages/agent-os/` | Python | `agent-os-kernel` | Stable (Beta) | pydantic, rich |
| AgentMesh | `packages/agent-mesh/` | Python | `agentmesh-platform` | Stable (Beta) | pydantic, cryptography, pynacl, httpx, aiohttp, pyyaml, structlog |
| Agent Runtime | `packages/agent-runtime/` | Python | `agentmesh-runtime` | Stable (Beta) | agent-hypervisor, jsonschema |
| Agent Hypervisor | `packages/agent-hypervisor/` | Python | `agent-hypervisor` | Stable (Beta) | pydantic |
| Agent SRE | `packages/agent-sre/` | Python | `agent-sre` | Stable (Beta) | pydantic, pyyaml, croniter, opentelemetry |
| Agent Compliance | `packages/agent-compliance/` | Python | `agent-governance-toolkit` | Stable (Beta) | pydantic |
| Agent Marketplace | `packages/agent-marketplace/` | Python | `agentmesh-marketplace` | Stable (Beta) | pydantic, pyyaml, cryptography |
| Agent Lightning | `packages/agent-lightning/` | Python | `agentmesh-lightning` | Stable (Beta) | none (agent-os-kernel optional) |
| MCP Governance | `packages/agent-mcp-governance/` | Python | `agent-mcp-governance` | Alpha (v0.1.0) | agent-os-kernel |
| .NET SDK | `packages/agent-governance-dotnet/` | C# | `Microsoft.AgentGovernance` | Stable (Beta) | YamlDotNet |
| VS Code Extension | `packages/agent-os-vscode/` | TypeScript | `@microsoft/agent-os-vscode` | Stable | axios, ws |
| Integrations | `packages/agentmesh-integrations/` | Python | per-integration | Varies | per-integration |

All Python packages are at version **3.0.2** (except agent-mcp-governance at 0.1.0).

## 3. Architecture Summary

### Four-Layer Model

```
Application Layer — AGENT OS (Policy Engine)
    Policy evaluation, action interception, prompt injection detection,
    MCP security scanning, capability models, audit logging

Infrastructure Layer — AGENT HYPERVISOR / RUNTIME
    Execution rings (4-tier privilege), saga orchestration, kill switch,
    session management, vector clocks, liability tracking

Network Layer — AGENTMESH
    Zero-trust identity (Ed25519/SPIFFE), trust scoring (0-1000),
    protocol bridges (A2A, MCP, IATP), governance policies, compliance

Reliability Layer — AGENT SRE
    SLOs, error budgets, burn-rate alerts, chaos engineering,
    replay debugging, progressive delivery, circuit breakers
```

### Data Flow

1. **Agent requests action** → Agent OS Policy Engine intercepts
2. **Policy evaluation** (<0.1ms) → allow/deny decision based on capability model + rules
3. If allowed → **AgentMesh verifies identity** (Ed25519 credentials, trust score check)
4. **Hypervisor enforces execution ring** constraints (resource limits, privilege tier)
5. **Action executes** in sandboxed context
6. **Audit entry** appended to hash-chained log
7. **SRE** records SLI, updates error budget, fires alerts if needed

### Package Dependencies (Internal)

```
agent-compliance (umbrella) ──► agent-os-kernel
                              ──► agentmesh-platform
                              ──► agentmesh-runtime ──► agent-hypervisor
                              ──► agent-sre

agent-mcp-governance ──► agent-os-kernel

agentmesh-lightning ──► agent-os-kernel (optional)
agentmesh-marketplace (standalone)
agent-os-vscode (standalone, TypeScript)
agent-governance-dotnet (standalone, C#)
```

### Required vs Optional

- **Core trio**: agent-os-kernel + agentmesh-platform + agent-hypervisor — covers policy, identity, and runtime
- **Umbrella install**: `pip install agent-governance-toolkit[full]` pulls everything
- **Minimal install**: `pip install agent-os-kernel` for just the policy engine
- **Optional**: agent-sre (reliability), agent-marketplace (plugins), agent-lightning (RL training)

## 4. Quick Start for Our Project

### Full install (all Python packages)

```bash
pip install agent-governance-toolkit[full]
```

### Individual packages

```bash
pip install agent-os-kernel           # Policy engine core
pip install agent-os-kernel[full]     # Policy engine + all optional deps
pip install agentmesh-platform        # Zero-trust identity & trust
pip install agentmesh-runtime         # Execution supervisor (includes agent-hypervisor)
pip install agent-sre                 # SLOs, error budgets, observability
pip install agentmesh-marketplace     # Plugin lifecycle
pip install agentmesh-lightning       # RL training governance
```

### TypeScript / .NET / Rust / Go

```bash
npm install @agentmesh/sdk                                         # TypeScript
dotnet add package Microsoft.AgentGovernance                       # .NET
cargo add agentmesh                                                # Rust
go get github.com/microsoft/agent-governance-toolkit/sdks/go       # Go
```

### Development install (editable)

```bash
pip install -e "packages/agent-os[dev]"
pip install -e "packages/agent-mesh[dev]"
pip install -e "packages/agent-hypervisor[dev]"
pip install -e "packages/agent-runtime[dev]"
pip install -e "packages/agent-sre[dev]"
pip install -e "packages/agent-compliance[dev]"
pip install -e "packages/agent-marketplace[dev]"
pip install -e "packages/agent-lightning[dev]"
```

## 5. Package Summaries

### Agent OS (`agent-os-kernel`)

The policy engine kernel. Provides deterministic action interception at <0.1ms p99, prompt injection detection, MCP tool-poisoning scanning, semantic policy evaluation, context budget scheduling, and stateless kernel execution. Also includes a POSIX-inspired control plane with signals, VFS, and execution rings. The largest package with 40+ modules including adapters for 15+ frameworks.

**Key classes**: `PolicyEngine`, `KernelSpace`, `MCPSecurityScanner`, `PromptInjectionDetector`, `SemanticPolicyEngine`, `StatelessKernel`, `BaseAgent`, `ContextScheduler`, `CredentialRedactor`

```python
from agent_os import PolicyEngine, KernelSpace, MCPSecurityScanner
engine = PolicyEngine(capabilities={"allowed_tools": ["web_search"]})
decision = engine.evaluate(agent_id="agent-1", action="tool_call", tool="web_search")
```

[Detailed docs →](packages/agent-os.md)

### AgentMesh (`agentmesh-platform`)

Zero-trust identity and trust mesh. Provides Ed25519 cryptographic agent identity, SPIFFE/SVID support, trust scoring on a 0-1000 scale, delegation chains, protocol bridges (A2A, MCP, IATP), governance policies with compliance frameworks, shadow mode for testing policies, and a reward/learning engine.

**Key classes**: `AgentIdentity`, `AgentDID`, `TrustBridge`, `PolicyEngine`, `ComplianceEngine`, `AuditLog`, `RewardEngine`, `TrustScore`, `AgentMeshClient`

```python
from agentmesh import AgentIdentity, TrustBridge, PolicyEngine
identity = AgentIdentity.generate("my-agent")
bridge = TrustBridge()
result = bridge.verify(identity)
```

[Detailed docs →](packages/agent-mesh.md)

### Agent Hypervisor (`agent-hypervisor`)

Runtime supervisor for multi-agent shared sessions. Provides 4-tier execution rings, saga orchestration with compensating transactions, liability tracking (vouching, slashing, causal attribution), session management with vector clocks and intent locks, kill switch, rate limiting, and hash-chained audit trails. This is the core implementation; agent-runtime re-exports its API.

**Key classes**: `Hypervisor`, `SessionConfig`, `ExecutionRing`, `SagaOrchestrator`, `RingEnforcer`, `KillSwitch`, `LiabilityMatrix`, `VouchingEngine`

```python
from hypervisor import Hypervisor, SessionConfig, ConsistencyMode
hv = Hypervisor()
session = await hv.create_session(config=SessionConfig(consistency_mode=ConsistencyMode.EVENTUAL))
```

[Detailed docs →](packages/agent-hypervisor.md)

### Agent Runtime (`agentmesh-runtime`)

Successor to agent-hypervisor. Re-exports the full Hypervisor API and adds deployment utilities (Docker, Kubernetes deployers). Callers can migrate imports from `hypervisor` to `agent_runtime` incrementally.

**Key classes**: Same as Hypervisor plus `DockerDeployer`, `KubernetesDeployer`, `GovernanceConfig`

```python
from agent_runtime import Hypervisor, SessionConfig, DockerDeployer
```

[Detailed docs →](packages/agent-runtime.md)

### Agent SRE (`agent-sre`)

Reliability engineering for AI agents. Provides SLO engine with error budgets, burn-rate alerting, chaos engineering, replay debugging, progressive delivery, circuit breakers, fleet management, cost tracking, incident management, and anomaly detection. Integrates with 12+ observability platforms (Prometheus, Langfuse, Arize, Braintrust, Datadog, etc.).

**Key classes**: `SLO`, `ErrorBudget`, `SLI`, `SLIRegistry`

```python
from agent_sre import SLO, ErrorBudget
from agent_sre.slo.indicators import TaskSuccessRate
sli = TaskSuccessRate(target=0.95)
slo = SLO("my-agent", indicators=[sli], error_budget=ErrorBudget(total=0.05))
slo.record_event(good=True)
```

[Detailed docs →](packages/agent-sre.md)

### Agent Compliance (`agent-governance-toolkit`)

Unified installer and runtime policy enforcement. The umbrella package that optionally pulls in all other packages. Also provides supply chain guard, prompt defense evaluator, integrity verification, and policy linting. Three CLI entry points: `agent-governance-toolkit`, `agent-governance`, `agent-compliance`.

**Key classes**: `SupplyChainGuard`, `PromptDefenseEvaluator`, `StatelessKernel` (re-exported)

```python
from agent_compliance.supply_chain import SupplyChainGuard
guard = SupplyChainGuard(config=SupplyChainConfig())
findings = guard.scan("requirements.txt")
```

[Detailed docs →](packages/agent-compliance.md)

### Agent Marketplace (`agentmesh-marketplace`)

Plugin lifecycle management. Discover, install, verify, and sign plugins with Ed25519 signing and semver-aware version resolution. Supports trust tiers, quality scoring, compliance evaluation, schema adapters for Claude and Copilot plugin formats, and workflow bundles.

**Key classes**: `PluginRegistry`, `PluginManifest`, `PluginSigner`, `PluginInstaller`, `MarketplacePolicy`, `QualityAssessor`

```python
from agent_marketplace import PluginRegistry, PluginManifest, PluginSigner
registry = PluginRegistry()
signer = PluginSigner.generate()
manifest = PluginManifest(name="my-plugin", version="1.0.0", ...)
```

[Detailed docs →](packages/agent-marketplace.md)

### Agent Lightning (`agentmesh-lightning`)

RL training governance for Agent-Lightning framework. Provides governed runners that enforce policies during training, policy-based reward shaping, flight recorder emitters for audit logs, and governed training environments.

**Key classes**: `GovernedRunner`, `PolicyReward`, `FlightRecorderEmitter`, `GovernedEnvironment`

```python
from agent_lightning_gov import GovernedRunner, PolicyReward
runner = GovernedRunner(kernel)
reward_fn = PolicyReward(kernel, base_reward_fn=accuracy)
```

[Detailed docs →](packages/agent-lightning.md)

### MCP Governance (`agent-mcp-governance`)

Thin re-export surface providing 4 governance classes from agent-os-kernel for standalone MCP use. Alpha status (v0.1.0). Only 25 lines of actual code.

**Key classes**: `GovernanceMiddleware`, `AuditMiddleware`, `TrustGate`, `BehaviorMonitor`

[Detailed docs →](packages/agent-mcp-governance.md)

### .NET SDK (`Microsoft.AgentGovernance`)

Full .NET 8.0+ implementation covering policy enforcement, trust/identity (Ed25519), execution rings, saga orchestration, SLO engine, circuit breaker, rate limiting, audit logging, and OpenTelemetry metrics. Single dependency: YamlDotNet.

**Key namespaces**: `AgentGovernance.Policy`, `AgentGovernance.Trust`, `AgentGovernance.Hypervisor`, `AgentGovernance.Audit`, `AgentGovernance.Sre`

[Detailed docs →](packages/agent-governance-dotnet.md)

### VS Code Extension (`@microsoft/agent-os-vscode`)

VS Code extension providing kernel-level safety for AI coding assistants. Blocks destructive operations, supports CMVK multi-model verification, policy editor, workflow designer, SLO dashboard, agent topology graph, governance hub, and enterprise SSO. Runs on VS Code 1.85+.

[Detailed docs →](packages/agent-os-vscode.md)

### Integrations (`agentmesh-integrations`)

22 standalone integration packages for third-party frameworks. Each provides trust-gated tool execution, cryptographic identity, and governance callbacks for its target framework.

**Key integrations**: langchain-agentmesh, crewai-agentmesh, openai-agents-agentmesh, llamaindex-agentmesh, adk-agentmesh (Google), langgraph-trust, haystack-agentmesh, dify, pydantic-ai-governance

[Detailed docs →](packages/agentmesh-integrations.md)

## 6. Cross-Cutting Patterns

### Authentication & Trust

All packages share the Ed25519 identity model from AgentMesh:
1. Agent generates `AgentIdentity` with Ed25519 keypair → gets a `did:mesh:*` DID
2. Identity is registered with `TrustBridge` → initial trust score of 500 (Standard tier)
3. Every action is signed and verified → trust score adjusts based on compliance history
4. Score tiers gate capabilities: Untrusted (0-299), Probationary (300-499), Standard (500-699), Trusted (700-899), Verified Partner (900-1000)

### Audit Logging

Audit flows through hash-chained append-only logs:
1. `agent_os.AuditEntry` records policy decisions with timestamps
2. `hypervisor.DeltaEngine` captures session state changes
3. `hypervisor.CommitmentEngine` creates hash-chain commitments
4. `agentmesh.AuditLog` / `AuditChain` provides cross-agent audit
5. All entries include `agent_id`, `action`, `decision`, `timestamp`, `parent_hash`

### Policy Propagation

Policies are defined in YAML and evaluated deterministically:
1. **Agent OS `PolicyEngine`** — capability-based: allowed/denied tools, token limits
2. **AgentMesh `PolicyEngine`** — governance-level: compliance frameworks, role-based rules
3. **Hypervisor `RingEnforcer`** — ring-level: what actions each execution ring allows
4. **Agent SRE `SLO`** — reliability-level: error budgets gate deployments

Policies support three backends: built-in (zero deps), OPA/Rego, and Cedar.

### Configuration Patterns

- YAML policy files in `examples/policies/` for reference configs
- Pydantic models for all configuration (validated at construction)
- Environment variables for secrets and endpoints
- Constructor parameters for programmatic configuration
- CLI tools (`agent-os`, `agentmesh`, `agent-sre`, `agent-governance`) for management

### Error Handling

- Custom exception hierarchies per package (e.g., `AgentMeshError → TrustError → TrustVerificationError`)
- Policy violations raise `PolicyDenied` or return `PolicyDecision(allowed=False)`
- Ring violations handled by `RingBreachDetector` with configurable severity
- Circuit breakers in agent-sre for cascading failure protection

## 7. Integration Map for Our Project

| Our Component | Toolkit Packages/Modules | Purpose |
|---------------|------------------------|---------|
| **Sidecar** | `agent_os.StatelessKernel`, `agent_os.mcp_gateway`, `agent_mcp_governance` | Stateless policy enforcement sidecar, MCP gateway for tool governance |
| **Transaction Engine** | `hypervisor.SagaOrchestrator`, `hypervisor.Hypervisor`, `agent_runtime.DockerDeployer` | Multi-step transaction orchestration with compensating actions, session management |
| **Registry** | `agent_marketplace.PluginRegistry`, `agent_marketplace.PluginManifest`, `agentmesh.CapabilityRegistry` | Plugin/agent discovery, manifest validation, capability registration |
| **Compliance Layer** | `agent_compliance.SupplyChainGuard`, `agentmesh.ComplianceEngine`, `agent_os.content_governance` | Supply chain scanning, compliance framework evaluation, content quality gates |
| **Audit Trail** | `agentmesh.AuditLog`, `hypervisor.DeltaEngine`, `hypervisor.CommitmentEngine`, `agent_os.AuditEntry` | Hash-chained immutable audit logs, state change tracking, commitment anchoring |
| **Merchant SDK** | `agentmesh-integrations/langchain-agentmesh` (or per-framework), `agentmesh.AgentIdentity`, `agentmesh.TrustBridge` | Trust-gated tool execution for merchant-side agents, identity verification |
