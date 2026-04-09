# agent-hypervisor

## 1. Package Overview

Runtime supervisor for multi-agent shared sessions. Provides 4-tier execution rings, saga orchestration with compensating transactions, joint liability tracking (vouching, slashing, causal attribution), session management with vector clocks and intent locks, kill switch, rate limiting, and hash-chained audit trails. This is the core runtime implementation — `agentmesh-runtime` re-exports its full API.

- **Package name**: `agent-hypervisor` (PyPI), import as `hypervisor`
- **Version**: 3.0.2
- **Language**: Python >=3.11
- **Install**: `pip install agent-hypervisor`
- **Core dependencies**: pydantic >=2.4 (only dependency)
- **Build system**: hatchling
- **CLI**: `hypervisor` command

### Optional Extras

| Extra | What it adds |
|-------|-------------|
| `nexus` | structlog (structured logging) |
| `api` | fastapi, uvicorn (REST API) |
| `full` | nexus |
| `observability` | agent-sre (metrics bridge) |
| `otel` | opentelemetry-api (span creation) |
| `blockchain` | web3 (reserved, not yet used) |

## 2. Architecture

### Directory Structure

```
packages/agent-hypervisor/src/hypervisor/
├── __init__.py              # Re-exports full public API
├── core.py                  # Hypervisor — top-level orchestrator
├── models.py                # ConsistencyMode, ExecutionRing, SessionConfig, SessionState
├── constants.py             # Centralized constants
├── session/                 # Session management
│   ├── __init__.py          # SharedSessionObject
│   ├── sso.py               # SessionVFS, VFSEdit
│   ├── vector_clock.py      # VectorClock, VectorClockManager
│   ├── intent_locks.py      # IntentLockManager, DeadlockError
│   └── isolation.py         # IsolationLevel
├── rings/                   # Execution rings (4-tier privilege)
│   ├── enforcer.py          # RingEnforcer
│   ├── classifier.py        # ActionClassifier
│   ├── elevation.py         # RingElevationManager
│   └── breach_detector.py   # RingBreachDetector, BreachSeverity
├── saga/                    # Saga orchestration
│   ├── orchestrator.py      # SagaOrchestrator
│   ├── state_machine.py     # SagaState, StepState
│   ├── fan_out.py           # FanOutOrchestrator, FanOutPolicy
│   ├── checkpoint.py        # CheckpointManager, SemanticCheckpoint
│   └── dsl.py               # SagaDSLParser, SagaDefinition
├── liability/               # Joint liability tracking
│   ├── __init__.py          # LiabilityMatrix
│   ├── vouching.py          # VouchingEngine, VouchRecord
│   ├── slashing.py          # SlashingEngine
│   ├── attribution.py       # CausalAttributor, AttributionResult
│   ├── quarantine.py        # QuarantineManager, QuarantineReason
│   └── ledger.py            # LiabilityLedger, LedgerEntryType
├── audit/                   # Audit infrastructure
│   ├── delta.py             # DeltaEngine (state change capture)
│   ├── commitment.py        # CommitmentEngine (hash-chain commitments)
│   └── gc.py                # EphemeralGC (garbage collection)
├── verification/
│   └── history.py           # TransactionHistoryVerifier
├── observability/
│   ├── event_bus.py         # HypervisorEventBus, EventType, HypervisorEvent
│   └── causal_trace.py      # CausalTraceId
├── security/
│   ├── kill_switch.py       # KillSwitch, KillResult
│   └── rate_limiter.py      # AgentRateLimiter, RateLimitExceeded
├── reversibility/
│   └── registry.py          # ReversibilityRegistry
├── integrations/            # External system integrations
├── cli/                     # CLI commands
└── tests/
```

## 3. Key APIs

### Core Hypervisor

```python
from hypervisor import Hypervisor, SessionConfig, ConsistencyMode, ExecutionRing

hv = Hypervisor()
session = await hv.create_session(config=SessionConfig(
    consistency_mode=ConsistencyMode.EVENTUAL,
    default_ring=ExecutionRing.RING_2,
))
```

### Execution Rings (4-tier privilege model)

```python
from hypervisor import RingEnforcer, ActionClassifier, ExecutionRing
from hypervisor import RingElevationManager, RingElevation

# Ring 0: Kernel — full access (policy engine only)
# Ring 1: Supervisor — can manage other agents
# Ring 2: User — standard operations
# Ring 3: Sandbox — restricted, read-only

enforcer = RingEnforcer()
allowed = enforcer.check(agent_ring=ExecutionRing.RING_2, action="file_write")

# Elevation request (Ring 2 → Ring 1)
elevator = RingElevationManager()
elevation: RingElevation = elevator.request(
    agent_id="agent-1",
    from_ring=ExecutionRing.RING_2,
    to_ring=ExecutionRing.RING_1,
    justification="needs supervisor access for deployment"
)
```

### Saga Orchestration

```python
from hypervisor import SagaOrchestrator, SagaState, CheckpointManager

saga = SagaOrchestrator()
# Define steps with compensating transactions
saga.add_step("reserve", action=reserve_fn, compensate=release_fn)
saga.add_step("charge", action=charge_fn, compensate=refund_fn)
saga.add_step("fulfill", action=fulfill_fn, compensate=cancel_fn)
result = await saga.execute()
# If any step fails, compensating transactions run in reverse order

# Fan-out orchestration
from hypervisor import FanOutOrchestrator, FanOutPolicy
fan_out = FanOutOrchestrator(policy=FanOutPolicy.ALL_MUST_SUCCEED)
results = await fan_out.execute(tasks=[task1, task2, task3])
```

### Liability Tracking

```python
from hypervisor import VouchingEngine, VouchRecord, SlashingEngine, LiabilityMatrix

# Vouching — agents vouch for each other
vouching = VouchingEngine()
vouch = VouchRecord(voucher="agent-a", vouchee="agent-b", stake=100)
vouching.record(vouch)

# Slashing — penalize on violation
slashing = SlashingEngine()
slashing.slash(agent_id="agent-b", amount=50, reason="policy violation")

# Causal attribution — who caused the failure?
from hypervisor import CausalAttributor, AttributionResult
attributor = CausalAttributor()
result: AttributionResult = attributor.analyze(session_id="sess-1", failure_event=event)
```

### Kill Switch

```python
from hypervisor import KillSwitch, KillResult

switch = KillSwitch()
result: KillResult = switch.terminate(agent_id="rogue-agent", reason="behavioral anomaly")
```

### Session Management

```python
from hypervisor import SharedSessionObject, SessionVFS, VectorClock

session = SharedSessionObject(session_id="sess-1")
vfs = SessionVFS(session)
await vfs.write("/shared/data.json", data, agent_id="agent-1")

# Vector clocks for causal ordering
from hypervisor import VectorClockManager
clocks = VectorClockManager()
clocks.tick("agent-1")
```

## 4. Configuration

- `SessionConfig` — consistency mode, default ring, timeout
- `FanOutPolicy` — ALL_MUST_SUCCEED, BEST_EFFORT, QUORUM
- `IsolationLevel` — READ_UNCOMMITTED, READ_COMMITTED, SERIALIZABLE
- `ConsistencyMode` — EVENTUAL, STRONG, CAUSAL

## 5. Development Notes

### Running Tests

```bash
cd packages/agent-hypervisor
pytest tests/ -x -q
pytest tests/ -m "not slow"
```

### Single dependency (pydantic)

The hypervisor has minimal dependencies by design — only pydantic. All external integrations use Protocol-based interfaces (duck typing) so backends are optional.

## 6. Relevance to Our Project

**Use**: `SagaOrchestrator` (transaction engine), `ExecutionRing`/`RingEnforcer` (privilege tiers for merchant vs platform agents), `KillSwitch` (rogue agent termination), `VouchingEngine` (merchant trust), `AuditDelta`/`CommitmentEngine` (audit trail)

**Skip**: `blockchain` extra (not yet implemented), CLI commands

**Architecture mapping**: The Hypervisor is the backbone of our transaction engine — sagas orchestrate multi-step merchant operations with compensating transactions. Execution rings enforce that merchant SDK agents operate at Ring 2 (User) while our platform agents operate at Ring 1 (Supervisor).
