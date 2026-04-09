# agent-os-kernel

## 1. Package Overview

The policy engine kernel for the Agent Governance Toolkit. Provides deterministic action interception at <0.1ms p99 latency, prompt injection detection, MCP tool-poisoning scanning, semantic policy evaluation, context budget scheduling, and a POSIX-inspired control plane with signals, VFS, and execution rings. The largest package in the monorepo with 40+ core modules plus 15+ framework adapters.

- **Package name**: `agent-os-kernel` (PyPI), import as `agent_os`
- **Version**: 3.0.2
- **Language**: Python >=3.9
- **Install**: `pip install agent-os-kernel` (core) or `pip install agent-os-kernel[full]` (all extras)
- **Core dependencies**: pydantic >=2.4, rich >=13.0
- **Build system**: hatchling

### Optional Extras

| Extra | What it adds |
|-------|-------------|
| `cmvk` | numpy (multi-model verification) |
| `iatp` | fastapi, uvicorn, httpx, cryptography, pynacl (identity/auth) |
| `amb` | anyio, aiofiles (agent message bus) |
| `observability` | prometheus-client, opentelemetry-api/sdk |
| `mcp` | mcp >=1.0 (Model Context Protocol) |
| `nexus` | iatp + pyyaml, structlog, aiohttp |
| `full` | all of the above |
| `hypervisor` | agentmesh-runtime (runtime supervisor bridge) |

## 2. Architecture

### Directory Structure

```
packages/agent-os/
├── src/agent_os/           # Core package (40+ modules)
│   ├── __init__.py         # Re-exports everything; detects optional packages
│   ├── base_agent.py       # BaseAgent, ToolUsingAgent, AgentConfig
│   ├── stateless.py        # StatelessKernel, stateless_execute
│   ├── mcp_security.py     # MCPSecurityScanner (tool poisoning detection)
│   ├── mcp_gateway.py      # MCP gateway for external tool governance
│   ├── mcp_session_auth.py # MCPSessionAuthenticator
│   ├── mcp_response_scanner.py  # Response-side MCP scanning
│   ├── prompt_injection.py # PromptInjectionDetector
│   ├── semantic_policy.py  # SemanticPolicyEngine (intent classification)
│   ├── context_budget.py   # ContextScheduler (token budget management)
│   ├── content_governance.py    # ContentQualityEvaluator
│   ├── execution_context_policy.py  # ContextualPolicyEngine
│   ├── credential_redactor.py   # CredentialRedactor (secret scanning)
│   ├── mcp_message_signer.py    # Ed25519 message signing for MCP
│   ├── mcp_sliding_rate_limiter.py  # Per-agent rate limiting
│   ├── mute.py             # face_agent/mute_agent decorators (reasoning/execution split)
│   ├── sandbox.py          # Code sandbox provider
│   ├── adversarial.py      # Adversarial testing utilities
│   ├── circuit_breaker.py  # Circuit breaker pattern
│   ├── event_bus.py        # Internal event bus
│   ├── transparency.py     # Transparency/explainability
│   ├── trust_root.py       # Trust root management
│   ├── shift_left_metrics.py    # Shift-left violation tracking
│   ├── github_enterprise.py     # GitHub Enterprise governance
│   ├── integrations/       # Framework adapters (15+)
│   │   ├── langchain_adapter.py
│   │   ├── crewai_adapter.py
│   │   ├── openai_agents_sdk.py
│   │   ├── autogen_adapter.py
│   │   ├── llamaindex_adapter.py
│   │   ├── google_adk_adapter.py
│   │   ├── anthropic_adapter.py
│   │   ├── maf_adapter.py
│   │   └── ... (14 more)
│   ├── server/             # FastAPI governance server
│   ├── cli/                # CLI commands
│   ├── governance/         # Governance middleware
│   ├── audit/              # Audit middleware
│   ├── trust/              # Trust gate
│   └── services/           # Behavior monitor, etc.
├── modules/                # Sub-packages bundled into wheel
│   ├── primitives/         # agent_primitives — base failure models
│   ├── cmvk/               # cmvk — multi-model verification kernel
│   ├── caas/               # caas — context-as-a-service pipelines
│   ├── emk/                # emk — episodic memory kernel
│   ├── iatp/               # iatp — identity & auth transport protocol
│   ├── amb/                # amb_core — agent message bus
│   ├── atr/                # atr — agent tool registry
│   ├── control-plane/      # agent_control_plane — kernel space, VFS, signals
│   ├── observability/      # agent_os_observability
│   ├── nexus/              # nexus — trust exchange
│   ├── scak/               # agent_kernel — self-correcting kernel
│   ├── mute-agent/         # mute_agent — reasoning/execution split
│   └── mcp-kernel-server/  # mcp_kernel_server — MCP server implementation
└── tests/
```

### Internal Data Flow

```
Agent Action → PolicyEngine.evaluate() → PolicyDecision(allowed/denied)
                    ↓ if control plane installed
            KernelSpace → SyscallRequest → ProtectionRing check
                    ↓
            AgentVFS (virtual filesystem) → FlightRecorder (audit)
```

## 3. Key APIs

### Policy Enforcement

```python
from agent_os import PolicyEngine, PolicyRule

# PolicyEngine — evaluates agent actions against capability rules
engine = PolicyEngine(capabilities=CapabilityModel(
    allowed_tools=["web_search", "file_read"],
    denied_tools=["file_write", "shell_exec"],
    max_tokens_per_call=4096
))
decision = engine.evaluate(agent_id="agent-1", action="tool_call", tool="web_search")
# Returns: PolicyDecision(allowed=bool, reason=str)
```

### Stateless Kernel (MCP June 2026 pattern)

```python
from agent_os import StatelessKernel, stateless_execute, ExecutionRequest

# One-shot stateless execution with policy enforcement
result = await stateless_execute(
    action="database_query",
    params={"query": "SELECT * FROM users"},
    agent_id="analyst-001",
    policies=["read_only"]
)
# Returns: ExecutionResult(success=bool, data=Any, audit_trail=list)
```

### MCP Security Scanner

```python
from agent_os import MCPSecurityScanner, MCPThreatType

scanner = MCPSecurityScanner()
result = scanner.scan_tool(tool_definition)
# Returns: ScanResult(threats=[MCPThreat(type, severity, description)], safe=bool)
# Detects: tool poisoning, typosquatting, hidden instructions, rug-pull attacks
```

### Prompt Injection Detection

```python
from agent_os import PromptInjectionDetector, DetectionConfig

detector = PromptInjectionDetector(config=DetectionConfig(
    sensitivity=0.8,
    block_on_detection=True
))
result = detector.analyze(text="Ignore all previous instructions...")
# Returns: DetectionResult(is_injection=bool, injection_type=InjectionType, threat_level=ThreatLevel)
```

### POSIX-Inspired Control Plane (requires [full])

```python
from agent_os import KernelSpace, AgentSignal, AgentVFS, ProtectionRing

kernel = KernelSpace()
ctx = kernel.create_agent_context("agent-001")
await ctx.write("/mem/working/task.txt", "Hello World")

# Signals
from agent_os import kill_agent, pause_agent, policy_violation
kill_agent(agent_id="agent-001")
```

### Context Budget Scheduler

```python
from agent_os import ContextScheduler, ContextWindow, ContextPriority

scheduler = ContextScheduler(max_tokens=128000)
window = scheduler.allocate(agent_id="agent-1", priority=ContextPriority.HIGH, tokens=4096)
```

### Semantic Policy Engine

```python
from agent_os import SemanticPolicyEngine, IntentCategory

engine = SemanticPolicyEngine()
classification = engine.classify("Delete all user records")
# Returns: IntentClassification(category=IntentCategory, confidence=float)
if classification.category == IntentCategory.DESTRUCTIVE:
    raise PolicyDenied("Destructive intent detected")
```

### OPA/Rego and Cedar Policy Support

```python
from agent_os.policies import PolicyEvaluator

evaluator = PolicyEvaluator()
# OPA/Rego
evaluator.load_rego(rego_content='package agentos\ndefault allow = false\nallow { input.tool_name == "web_search" }')
# Cedar
evaluator.load_cedar(policy_content='permit(principal, action == Action::"ReadData", resource);')
decision = evaluator.evaluate({"tool_name": "web_search"})
```

## 4. Usage Patterns

### Minimal policy enforcement

```python
from agent_os import PolicyEngine

engine = PolicyEngine(capabilities={"allowed_tools": ["web_search"]})
decision = engine.evaluate(agent_id="a1", action="tool_call", tool="web_search")
if decision.allowed:
    # proceed
    pass
```

### MCP gateway with security scanning

```python
from agent_os import MCPSecurityScanner
from agent_os.mcp_gateway import MCPGateway

scanner = MCPSecurityScanner()
# Scan all registered MCP tools before allowing access
for tool in mcp_tools:
    result = scanner.scan_tool(tool)
    if not result.safe:
        print(f"Blocked: {tool.name} — {result.threats}")
```

### Credential redaction in audit logs

```python
from agent_os import CredentialRedactor, CredentialPattern

redactor = CredentialRedactor(patterns=[
    CredentialPattern(name="api_key", regex=r"sk-[a-zA-Z0-9]{20,}")
])
clean_text = redactor.redact("Token: sk-abc123def456ghi789jkl")
# Returns: "Token: [REDACTED:api_key]"
```

### Framework integration (LangChain example)

```python
from agent_os.integrations.langchain_adapter import AgentOSLangChainAdapter

adapter = AgentOSLangChainAdapter(
    allowed_tools=["web_search", "calculator"],
    audit_enabled=True
)
# Use adapter as LangChain callback handler or tool wrapper
```

## 5. Configuration

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `AGENT_OS_LOG_LEVEL` | Logging level | `INFO` |
| `AGENT_OS_POLICY_PATH` | Path to YAML policy files | none |

### Constructor Parameters

Most configuration is via constructor parameters on the relevant class (e.g., `PolicyEngine(capabilities=...)`, `DetectionConfig(sensitivity=0.8)`). All config classes are Pydantic models.

### CLI

```bash
agent-os                    # Main CLI entry point
agent-os scan-mcp <file>    # Scan MCP tool definitions for threats
```

## 6. Development Notes

### Running Tests

```bash
cd packages/agent-os
pytest tests/ -x -q                          # Core tests
pytest modules/*/tests -x -q                 # Module tests
pytest tests/ -m "not slow" -x -q            # Skip slow tests
pytest tests/ -m benchmark                   # Performance benchmarks
```

Test paths configured: `tests/` and `modules/*/tests`

### Known Limitations

- Control plane features (`KernelSpace`, `AgentVFS`, signals) require `agent-os-kernel[full]` — they silently become unavailable if the `agent_control_plane` module is not installed
- The policy engine and agents run in the same Python process — not OS-level isolation
- OPA/Rego requires the `opa` CLI to be installed for remote evaluation mode
- Cedar requires `cedarpy` package for embedded evaluation

### Module System

The `modules/` directory contains sub-packages that are remapped into the wheel root by hatchling. When installed, they appear as top-level packages:
- `modules/control-plane/src/agent_control_plane` → `import agent_control_plane`
- `modules/primitives/agent_primitives` → `import agent_primitives`
- `modules/cmvk/src/cmvk` → `import cmvk`
- etc.

This is configured in `pyproject.toml` under `[tool.hatch.build.targets.wheel.sources]`.

## 7. Relevance to Our Project

**Use**: `PolicyEngine`, `StatelessKernel`, `MCPSecurityScanner`, `PromptInjectionDetector`, `CredentialRedactor`, `AuditEntry`

**Skip**: Most framework adapters in `integrations/` (unless we use those specific frameworks), the POSIX control plane (complex, optional), `agent_lightning_gov` integration module

**Architecture mapping**: Agent OS is the policy enforcement core — our sidecar component wraps `StatelessKernel` for stateless per-request governance. The `MCPSecurityScanner` protects our tool registry. The `PromptInjectionDetector` sits in our input validation pipeline.
