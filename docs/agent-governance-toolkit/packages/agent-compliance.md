# agent-governance-toolkit (Agent Compliance)

## 1. Package Overview

The unified installer and runtime policy enforcement package. This is the umbrella package that optionally pulls in all other AGT packages via extras. Also provides its own modules: supply chain guard (dependency scanning), prompt defense evaluator, integrity verification, policy linting, and promotion gates.

- **Package name**: `agent-governance-toolkit` (PyPI), import as `agent_compliance`
- **Version**: 3.0.2
- **Language**: Python >=3.9
- **Install**: `pip install agent-governance-toolkit` (core) or `pip install agent-governance-toolkit[full]` (everything)
- **Core dependencies**: pydantic >=2.4
- **Build system**: setuptools
- **CLI**: `agent-governance-toolkit`, `agent-governance`, or `agent-compliance`

### Optional Extras

| Extra | What it adds |
|-------|-------------|
| `kernel` | agent-os-kernel |
| `mesh` | agentmesh-platform |
| `runtime` | agentmesh-runtime |
| `sre` | agent-sre |
| `cedar` | cedarpy (Cedar policy backend) |
| `full` | kernel + mesh + runtime + sre |

## 2. Architecture

### Directory Structure

```
packages/agent-compliance/src/agent_compliance/
├── __init__.py           # Re-exports StatelessKernel, SupplyChainGuard, PromptDefenseEvaluator
├── supply_chain.py       # SupplyChainGuard, SupplyChainFinding, SupplyChainConfig
├── prompt_defense.py     # PromptDefenseEvaluator, PromptDefenseConfig/Finding/Report
├── integrity.py          # Integrity verification (SHA-256 tamper detection)
├── lint_policy.py        # Policy linting and validation
├── promotion.py          # Promotion gates (staging → production)
├── verify.py             # Verification utilities
├── governance/           # Governance-specific modules
├── security/             # Security modules
└── cli/                  # CLI commands
```

## 3. Key APIs

### Supply Chain Guard

```python
from agent_compliance.supply_chain import SupplyChainGuard, SupplyChainConfig, SupplyChainFinding

config = SupplyChainConfig(
    check_typosquatting=True,
    check_version_age=True,      # 7-day rule
    check_maintainer_changes=True,
)
guard = SupplyChainGuard(config=config)
findings: list[SupplyChainFinding] = guard.scan("requirements.txt")
for finding in findings:
    print(f"{finding.severity}: {finding.package} — {finding.description}")
```

### Prompt Defense Evaluator

```python
from agent_compliance.prompt_defense import (
    PromptDefenseEvaluator,
    PromptDefenseConfig,
    PromptDefenseFinding,
    PromptDefenseReport,
)

evaluator = PromptDefenseEvaluator(config=PromptDefenseConfig(
    sensitivity=0.8,
    check_injection=True,
    check_jailbreak=True,
))
report: PromptDefenseReport = evaluator.evaluate(prompt="user input here")
if report.findings:
    for finding in report.findings:
        print(f"{finding.type}: {finding.description}")
```

### Integrity Verification

```python
from agent_compliance.integrity import verify_module_integrity

# SHA-256 tamper detection of governance modules at startup
result = verify_module_integrity(modules=["agent_os", "agentmesh", "hypervisor"])
```

## 4. Usage Patterns

### Full stack install and verification

```python
# pip install agent-governance-toolkit[full]
from agent_compliance import SupplyChainGuard, PromptDefenseEvaluator
from agent_os import StatelessKernel      # available via [kernel] extra
from agentmesh import AgentIdentity       # available via [mesh] extra
```

### CLI

```bash
agent-governance-toolkit scan           # Run supply chain scan
agent-governance-toolkit lint           # Lint policy files
agent-governance-toolkit verify         # Verify module integrity
agent-compliance check                  # Check compliance status
```

## 5. Development Notes

### Running Tests

```bash
cd packages/agent-compliance
pytest tests/ -x -q
```

### Note on naming

The package name on PyPI is `agent-governance-toolkit` but the import path is `agent_compliance`. The previous name was `ai-agent-compliance` (deprecated).

## 6. Relevance to Our Project

**Use**: `SupplyChainGuard` (scan our dependencies), `PromptDefenseEvaluator` (input validation), integrity verification (startup checks), the `[full]` extra as the single install command

**Skip**: Policy linting CLI (dev-time tool), promotion gates (unless we have staging/prod distinction)

**Architecture mapping**: This is our compliance layer's foundation — supply chain guard runs in CI, prompt defense evaluator runs in our input pipeline, integrity verification runs at service startup.
