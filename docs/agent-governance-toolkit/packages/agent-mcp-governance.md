# agent-mcp-governance

## 1. Package Overview

Thin re-export surface providing 4 governance classes from agent-os-kernel for standalone MCP (Model Context Protocol) usage. This package exists so downstream consumers can get governance primitives without pulling in the full monorepo. Alpha status with minimal code.

- **Package name**: `agent-mcp-governance` (PyPI), import as `agent_mcp_governance`
- **Version**: 0.1.0
- **Language**: Python >=3.10
- **Install**: `pip install agent-mcp-governance`
- **Dependencies**: agent-os-kernel >=3.0, <4.0
- **Build system**: setuptools
- **Maturity**: Alpha (Development Status 3)

## 2. Architecture

### Directory Structure

```
packages/agent-mcp-governance/
├── README.md
├── pyproject.toml
└── src/agent_mcp_governance/
    └── __init__.py          # 25 lines — just re-exports
```

Total: 1 Python file, 25 lines of code. No tests in this package.

## 3. Key APIs

All 4 classes are re-exported from agent-os-kernel:

```python
from agent_mcp_governance import GovernanceMiddleware, AuditMiddleware, TrustGate, BehaviorMonitor

# GovernanceMiddleware — policy enforcement (rate limits, allow-lists, content filters)
# Source: agent_os.governance.middleware
gov = GovernanceMiddleware(
    blocked_patterns=[r"(?i)ignore previous instructions"],
    allowed_tools=["web-search", "read-file"],
    rate_limit_per_minute=60,
)

# AuditMiddleware — tamper-evident audit logging with hash chain
# Source: agent_os.audit.middleware
audit = AuditMiddleware(capture_data=True)

# TrustGate — DID-based trust verification for agent handoffs
# Source: agent_os.trust.gate
gate = TrustGate(min_trust_score=500)

# BehaviorMonitor — per-agent anomaly detection and quarantine
# Source: agent_os.services.behavior_monitor
monitor = BehaviorMonitor(burst_threshold=100, consecutive_failure_threshold=20)
```

## 4. Development Notes

- No tests in this package — the underlying classes are tested in agent-os
- This package is a convenience facade; the real implementation lives in agent-os-kernel

## 5. Relevance to Our Project

**Use**: Potentially useful if building a standalone MCP server that needs governance but doesn't want the full agent-os surface area. Otherwise, import directly from `agent_os`.

**Skip**: If you already depend on agent-os-kernel, this package adds no value.
