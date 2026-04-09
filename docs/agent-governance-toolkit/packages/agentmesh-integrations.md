# agentmesh-integrations

## 1. Package Overview

Collection of 22 standalone integration packages that connect the Agent Governance Toolkit to third-party agent frameworks. Each integration provides trust-gated tool execution, cryptographic identity (Ed25519), and governance callbacks for its target framework. Integrations are independently installable packages with their own `pyproject.toml`.

- **Location**: `packages/agentmesh-integrations/`
- **Language**: Python
- **No top-level package** — each subdirectory is a separate installable package

### Integration Inventory

| Integration | Directory | Target Framework | Key Features |
|------------|-----------|-----------------|--------------|
| `langchain-agentmesh` | `langchain-agentmesh/` | LangChain | Trust-gated tools, identity, callbacks |
| `crewai-agentmesh` | `crewai-agentmesh/` | CrewAI | Governed crews and agents |
| `openai-agents-agentmesh` | `openai-agents-agentmesh/` | OpenAI Agents SDK | Middleware integration |
| `openai-agents-trust` | `openai-agents-trust/` | OpenAI Agents SDK | Trust layer |
| `llamaindex-agentmesh` | `llamaindex-agentmesh/` | LlamaIndex | Query engine governance |
| `langgraph-trust` | `langgraph-trust/` | LangGraph | Trust-gated graph nodes |
| `adk-agentmesh` | `adk-agentmesh/` | Google ADK | Adapter |
| `haystack-agentmesh` | `haystack-agentmesh/` | Haystack | Pipeline governance |
| `dify` | `dify/` | Dify | Plugin |
| `pydantic-ai-governance` | `pydantic-ai-governance/` | Pydantic AI | Governance layer |
| `flowise-agentmesh` | `flowise-agentmesh/` | Flowise | Flow governance |
| `langflow-agentmesh` | `langflow-agentmesh/` | LangFlow | Flow governance |
| `mastra-agentmesh` | `mastra-agentmesh/` | Mastra | Adapter |
| `a2a-protocol` | `a2a-protocol/` | Agent-to-Agent | Protocol implementation |
| `aps-agentmesh` | `aps-agentmesh/` | Azure Prompt Shields | Defense integration |
| `copilot-governance` | `copilot-governance/` | GitHub Copilot | Governance layer |
| `mcp-trust-proxy` | `mcp-trust-proxy/` | MCP | Trust proxy |
| `nostr-wot` | `nostr-wot/` | Nostr | Web of trust |
| `scopeblind-protect-mcp` | `scopeblind-protect-mcp/` | Scopeblind | MCP protection |
| `template-agentmesh` | `template-agentmesh/` | Template | Starter template |

## 2. Architecture

### Common Pattern Across All Integrations

Every integration implements the same core interfaces:

1. **`VerificationIdentity`** — Ed25519 cryptographic identity for agents
2. **`TrustGatedTool`** — Wraps framework tools with trust requirements
3. **`TrustedToolExecutor`** — Executes tools with identity verification
4. **`TrustCallbackHandler`** — Monitors trust events during execution

### Reference Implementation: langchain-agentmesh

```
langchain-agentmesh/
├── pyproject.toml                    # langchain-core + cryptography deps
├── langchain_agentmesh/
│   ├── __init__.py                   # Re-exports public API
│   ├── identity.py                   # VerificationIdentity (Ed25519)
│   ├── tools.py                      # TrustGatedTool, TrustedToolExecutor
│   ├── trust.py                      # Trust verification logic
│   └── callbacks.py                  # TrustCallbackHandler for LangChain
└── tests/
    └── test_agentmesh.py
```

## 3. Key APIs (langchain-agentmesh as example)

```python
from langchain_agentmesh import VerificationIdentity, TrustGatedTool, TrustedToolExecutor

# Generate cryptographic identity
identity = VerificationIdentity.generate("my-agent")

# Wrap a LangChain tool with trust requirements
gated_tool = TrustGatedTool(
    tool=my_langchain_tool,
    required_capabilities=["web_search"],
    min_trust_score=500,
)

# Execute with identity verification
executor = TrustedToolExecutor(identity=identity)
result = executor.invoke(gated_tool, "search query")
```

### Callback Integration

```python
from langchain_agentmesh.callbacks import TrustCallbackHandler

handler = TrustCallbackHandler(identity=identity)
# Pass to LangChain agent as callback handler
agent.run("task", callbacks=[handler])
# handler logs trust events, policy decisions, etc.
```

## 4. Installation

Each integration is installed independently:

```bash
pip install langchain-agentmesh
pip install crewai-agentmesh
pip install openai-agents-agentmesh
pip install llamaindex-agentmesh
pip install langgraph-trust
# etc.
```

Or install via dev mode for development:

```bash
pip install -e "packages/agentmesh-integrations/langchain-agentmesh[dev]"
```

## 5. Development Notes

### Creating a New Integration

Use `template-agentmesh/` as a starting point. Key files to create:
1. `pyproject.toml` with framework dependency
2. `your_integration/__init__.py` re-exporting public API
3. `your_integration/identity.py` — `VerificationIdentity`
4. `your_integration/tools.py` — `TrustGatedTool`, `TrustedToolExecutor`
5. `tests/test_your_integration.py`

See `CONTRIBUTING.md` Integration Author Guide for detailed instructions.

### Testing

```bash
cd packages/agentmesh-integrations/<integration-name>
pytest tests/ -x -q
```

### Dependencies

Each integration depends on its framework's core package:
- `langchain-agentmesh` → `langchain-core >=0.2, <1.0`
- All require `cryptography >=45.0.3, <47.0` for Ed25519

## 6. Relevance to Our Project

**Use**: Whichever integrations match our agent framework choices. If using LangChain, install `langchain-agentmesh`. If using OpenAI Agents SDK, install `openai-agents-agentmesh`.

**Skip**: Integrations for frameworks we don't use. The `template-agentmesh` is only for building new integrations.

**Architecture mapping**: These integrations are what our merchant SDK uses — they wrap the framework-specific agent tools with trust-gated execution, so every tool call by a merchant agent is identity-verified and policy-checked.
