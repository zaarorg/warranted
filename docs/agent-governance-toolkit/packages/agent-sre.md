# agent-sre

## 1. Package Overview

Reliability engineering for AI agent systems. Brings SRE practices to autonomous agents: SLO engine with error budgets, burn-rate alerting, chaos engineering, replay debugging, progressive delivery, circuit breakers, fleet management, cost tracking, incident management, anomaly detection, and SBOM generation. Integrates with 12+ observability platforms.

- **Package name**: `agent-sre` (PyPI), import as `agent_sre`
- **Version**: 3.0.2
- **Language**: Python >=3.10
- **Install**: `pip install agent-sre`
- **Core dependencies**: pydantic, pyyaml, croniter, opentelemetry-api, opentelemetry-sdk
- **Build system**: hatchling
- **CLI**: `agent-sre` command

### Optional Extras

| Extra | What it adds |
|-------|-------------|
| `api` | FastAPI server for SRE API |
| `otel` | OpenTelemetry OTLP exporter |
| `langfuse` | Langfuse integration |
| `arize` | Arize Phoenix integration |
| `langchain` | LangChain callback integration |
| `llamaindex` | LlamaIndex integration |
| `braintrust` | Braintrust integration |
| `helicone` | Helicone integration |
| `datadog` | Datadog (ddtrace) |
| `langsmith` | LangSmith integration |
| `wandb` | Weights & Biases integration |
| `mlflow` | MLflow integration |
| `agentops` | AgentOps integration |
| `all` | All integrations above |

## 2. Architecture

### Directory Structure

```
packages/agent-sre/src/agent_sre/
├── __init__.py           # Exports SLO, ErrorBudget, SLI, SLIRegistry, SLIValue
├── __main__.py           # CLI entry point
├── providers.py          # Provider abstractions
├── sbom.py               # SBOM generation
├── signing.py            # Signing utilities
├── accuracy_declaration.py  # Accuracy/quality declarations
├── slo/                  # SLO engine
│   ├── indicators.py     # SLI, SLIRegistry, SLIValue, TaskSuccessRate, etc.
│   └── objectives.py     # SLO, ErrorBudget
├── alerts/               # Burn-rate alerting
├── anomaly/              # Anomaly detection
├── cascade/              # Cascading failure protection
├── chaos/                # Chaos engineering
├── cost/                 # Cost tracking and budgeting
├── delivery/             # Progressive delivery (canary, blue-green)
├── evals/                # Agent evaluation framework
├── experiments/          # A/B testing for agents
├── fleet/                # Fleet management
├── incidents/            # Incident management
├── integrations/         # 12+ platform integrations
│   ├── prometheus/
│   ├── langfuse/
│   ├── arize/
│   ├── braintrust/
│   ├── helicone/
│   ├── agentops/
│   └── ...
├── k8s/                  # Kubernetes operator support
├── mcp/                  # MCP reliability primitives
├── replay/               # Replay debugging
├── specs/                # Spec definitions
├── tracing/              # Distributed tracing
├── adapters/             # Framework adapters
├── api/                  # FastAPI REST API
├── benchmarks/           # Performance benchmarks
├── certification/        # Agent certification
└── cli/                  # CLI commands
```

## 3. Key APIs

### SLO Engine

```python
from agent_sre import SLO, ErrorBudget, SLI, SLIRegistry, SLIValue
from agent_sre.slo.indicators import TaskSuccessRate

# Define an SLI (Service Level Indicator)
sli = TaskSuccessRate(target=0.95)

# Create an SLO with error budget
slo = SLO(
    name="my-agent-reliability",
    indicators=[sli],
    error_budget=ErrorBudget(total=0.05)  # 5% error budget
)

# Record events
slo.record_event(good=True)   # successful task
slo.record_event(good=False)  # failed task

# Check status
# SLO transitions: HEALTHY → WARNING → CRITICAL → EXHAUSTED
status = slo.status()
remaining = slo.error_budget.remaining()
```

### SLI Registry

```python
from agent_sre import SLIRegistry

registry = SLIRegistry()
# Register custom SLIs
registry.register("task_accuracy", custom_accuracy_sli)
registry.register("response_latency", latency_sli)
```

## 4. Usage Patterns

### Basic SLO monitoring

```python
from agent_sre import SLO, ErrorBudget
from agent_sre.slo.indicators import TaskSuccessRate

slo = SLO("researcher", indicators=[TaskSuccessRate(target=0.95)],
          error_budget=ErrorBudget(total=0.05))

# In your agent loop:
for task in tasks:
    result = agent.execute(task)
    slo.record_event(good=result.success)

if slo.status() == "EXHAUSTED":
    # Freeze deployments, alert on-call
    pass
```

### CLI

```bash
agent-sre status              # Show SLO status across all agents
agent-sre replay <session-id> # Replay a failed session for debugging
```

## 5. Configuration

SLOs are configured programmatically via constructors or via YAML:

```yaml
slos:
  - name: researcher-reliability
    target: 0.95
    window: 30d
    indicators:
      - type: task_success_rate
        target: 0.95
```

## 6. Development Notes

### Running Tests

```bash
cd packages/agent-sre
pytest tests/ -x -q
pytest tests/ -m "not slow"
```

### Extensive sub-package structure

This is one of the most feature-rich packages with 20+ sub-directories covering chaos engineering, fleet management, cost tracking, etc. Many of these are independent modules that can be used standalone.

## 7. Relevance to Our Project

**Use**: `SLO`, `ErrorBudget`, `SLI` (core reliability monitoring for our agents), chaos engineering module (testing resilience), cost tracking (merchant billing)

**Skip**: Most observability integrations unless we use those specific platforms, k8s operator (unless deploying on k8s), certification module

**Architecture mapping**: Agent SRE provides the reliability layer — our compliance layer uses SLOs to define and enforce agent reliability guarantees. Error budgets gate merchant agent deployments.
