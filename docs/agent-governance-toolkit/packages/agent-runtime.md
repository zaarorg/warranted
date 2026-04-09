# agentmesh-runtime

## 1. Package Overview

Successor to agent-hypervisor. Re-exports the full Hypervisor public API and adds deployment utilities (Docker, Kubernetes deployers). Designed for incremental migration — callers can switch imports from `hypervisor` to `agent_runtime` without code changes.

- **Package name**: `agentmesh-runtime` (PyPI), import as `agent_runtime`
- **Version**: 3.0.2
- **Language**: Python >=3.11
- **Install**: `pip install agentmesh-runtime`
- **Core dependencies**: agent-hypervisor >=2.1, jsonschema >=4.0
- **Build system**: hatchling

## 2. Architecture

### Directory Structure

```
packages/agent-runtime/src/agent_runtime/
├── __init__.py    # Re-exports all hypervisor APIs + deployment module
└── deploy.py      # DockerDeployer, KubernetesDeployer, GovernanceConfig
```

The package is intentionally thin — it delegates to `hypervisor` for all runtime functionality and adds only the deployment layer.

### Relationship to agent-hypervisor

```python
# These are equivalent:
from hypervisor import Hypervisor, SessionConfig
from agent_runtime import Hypervisor, SessionConfig

# agent_runtime adds:
from agent_runtime import DockerDeployer, KubernetesDeployer, GovernanceConfig
```

## 3. Key APIs

### All Hypervisor APIs (re-exported)

See [agent-hypervisor.md](agent-hypervisor.md) for the full API. Every class and function from `hypervisor` is available via `agent_runtime`.

### Deployment (new in agent_runtime)

```python
from agent_runtime import DockerDeployer, KubernetesDeployer, GovernanceConfig
from agent_runtime import DeploymentResult, DeploymentStatus, DeploymentTarget

config = GovernanceConfig(
    policy_path="policies/production.yaml",
    audit_enabled=True,
)

# Docker deployment
docker = DockerDeployer(config=config)
result: DeploymentResult = await docker.deploy(target=DeploymentTarget(...))

# Kubernetes deployment
k8s = KubernetesDeployer(config=config)
result: DeploymentResult = await k8s.deploy(target=DeploymentTarget(...))
```

## 4. Development Notes

### Running Tests

```bash
cd packages/agent-runtime
pytest tests/ -x -q
```

### Migration Path

To migrate from `hypervisor` to `agent_runtime`:
1. `pip install agentmesh-runtime` (pulls agent-hypervisor as dependency)
2. Change imports: `from hypervisor import X` → `from agent_runtime import X`
3. No API changes needed

## 5. Relevance to Our Project

**Use**: Same as agent-hypervisor, plus `DockerDeployer`/`KubernetesDeployer` for deploying governed agents. Prefer importing from `agent_runtime` over `hypervisor` for forward compatibility.

**Skip**: Nothing additional — this is a thin wrapper.
