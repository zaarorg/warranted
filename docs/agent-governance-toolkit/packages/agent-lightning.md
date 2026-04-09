# agentmesh-lightning

## 1. Package Overview

RL training governance integration for the Agent-Lightning framework. Provides governed runners that enforce policies during reinforcement learning training, policy-based reward shaping (convert governance violations into RL penalties), flight recorder emitters for audit logs, and governed training environments.

- **Package name**: `agentmesh-lightning` (PyPI), import as `agent_lightning_gov`
- **Version**: 3.0.2
- **Language**: Python >=3.9
- **Install**: `pip install agentmesh-lightning`
- **Core dependencies**: none (zero dependencies by default)
- **Optional**: `[agent-os]` extra adds agent-os-kernel >=2.0
- **Build system**: setuptools

## 2. Architecture

### Directory Structure

```
packages/agent-lightning/src/agent_lightning_gov/
├── __init__.py          # Exports GovernedRunner, PolicyReward, FlightRecorderEmitter, GovernedEnvironment
├── runner.py            # GovernedRunner — Agent-Lightning runner with policy enforcement
├── reward.py            # PolicyReward, policy_penalty — convert violations to RL penalties
├── emitter.py           # FlightRecorderEmitter — export audit logs to LightningStore
└── environment.py       # GovernedEnvironment — training environment with governance constraints
```

## 3. Key APIs

```python
from agent_lightning_gov import GovernedRunner, PolicyReward, FlightRecorderEmitter, GovernedEnvironment

# GovernedRunner — wraps Agent-Lightning runner with policy checks
# Enforces governance policies during training episodes
runner = GovernedRunner(kernel)

# PolicyReward — shapes RL rewards based on governance compliance
# Penalizes agents for policy violations during training
reward_fn = PolicyReward(kernel, base_reward_fn=accuracy)
penalty = policy_penalty(violation)  # standalone penalty function

# FlightRecorderEmitter — sends audit logs to LightningStore
emitter = FlightRecorderEmitter(store=lightning_store)

# GovernedEnvironment — training env with governance constraints
env = GovernedEnvironment(
    base_env=training_env,
    policies=["no_destructive_actions"],
)
```

## 4. Usage Patterns

```python
from agent_lightning_gov import GovernedRunner, PolicyReward
from agent_os import KernelSpace
from agent_os.policies import SQLPolicy

# Setup governed training
kernel = KernelSpace(policy=SQLPolicy())
runner = GovernedRunner(kernel)
reward_fn = PolicyReward(kernel, base_reward_fn=accuracy)

# Training loop
for episode in training_episodes:
    result = runner.execute(episode)
    reward = reward_fn.compute(result)
    # Reward is reduced by policy violations
```

## 5. Development Notes

### Running Tests

```bash
cd packages/agent-lightning
pytest tests/ -x -q
```

### Zero-dependency design

The base package has no dependencies — agent-os-kernel is optional. This means the package can be installed in lightweight training environments without pulling in the full governance stack.

## 6. Relevance to Our Project

**Use**: Only if training RL agents with governance constraints. `PolicyReward` is useful if we want to train agents that learn to be compliant.

**Skip**: If not doing RL training, this package is not needed.
