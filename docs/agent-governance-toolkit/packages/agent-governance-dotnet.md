# Microsoft.AgentGovernance (.NET SDK)

## 1. Package Overview

Full .NET implementation of the Agent Governance Toolkit covering policy enforcement, zero-trust identity (Ed25519), execution rings, saga orchestration, SLO engine, circuit breaker, rate limiting, audit logging, and OpenTelemetry metrics. Compatible with Microsoft Agent Framework and Semantic Kernel.

- **Package name**: `Microsoft.AgentGovernance` (NuGet)
- **Version**: 3.0.2
- **Language**: C# / .NET 8.0+
- **Install**: `dotnet add package Microsoft.AgentGovernance`
- **Dependencies**: YamlDotNet 16.3.0 (only external dependency)
- **Namespace**: `AgentGovernance`

## 2. Architecture

### Directory Structure

```
packages/agent-governance-dotnet/
├── src/AgentGovernance/
│   ├── AgentGovernance.csproj
│   ├── Policy/
│   │   ├── PolicyEngine.cs          # Core policy evaluation
│   │   ├── Policy.cs                # Policy model
│   │   ├── PolicyRule.cs            # Rule definitions
│   │   ├── PolicyDecision.cs        # Allow/deny result
│   │   └── ConflictResolution.cs    # Rule conflict handling
│   ├── Trust/
│   │   ├── AgentIdentity.cs         # Ed25519 identity
│   │   ├── TrustVerifier.cs         # Trust verification
│   │   ├── IdentityRegistry.cs      # Identity management
│   │   ├── FileTrustStore.cs        # File-based trust storage
│   │   └── Jwk.cs                   # JSON Web Key support
│   ├── Hypervisor/
│   │   ├── ExecutionRings.cs        # 4-tier privilege model
│   │   └── SagaOrchestrator.cs      # Saga orchestration
│   ├── Audit/
│   │   ├── AuditLogger.cs           # Audit logging
│   │   ├── AuditEmitter.cs          # Event emission
│   │   └── GovernanceEvent.cs       # Event model
│   ├── Sre/
│   │   ├── SloEngine.cs             # SLO engine
│   │   └── CircuitBreaker.cs        # Circuit breaker pattern
│   ├── RateLimiting/
│   │   └── RateLimiter.cs           # Rate limiting
│   ├── Telemetry/
│   │   └── GovernanceMetrics.cs     # OpenTelemetry metrics
│   └── Integration/
│       └── GovernanceMiddleware.cs   # ASP.NET middleware
├── tests/AgentGovernance.Tests/
│   └── AgentGovernance.Tests.csproj
└── README.md
```

## 3. Key APIs

### Policy Engine

```csharp
using AgentGovernance;
using AgentGovernance.Policy;

var kernel = new GovernanceKernel(new GovernanceOptions
{
    PolicyPaths = new() { "policies/default.yaml" },
});

var result = kernel.EvaluateToolCall(
    agentId: "did:mesh:researcher-1",
    toolName: "web_search",
    args: new() { ["query"] = "latest AI news" }
);

if (result.Allowed) { /* proceed */ }
```

### Trust / Identity

```csharp
using AgentGovernance.Trust;

var identity = AgentIdentity.Generate("my-agent");
var registry = new IdentityRegistry();
registry.Register(identity);

var verifier = new TrustVerifier(registry);
var verified = verifier.Verify(identity);
```

### Execution Rings

```csharp
using AgentGovernance.Hypervisor;

var rings = new ExecutionRings();
var allowed = rings.CheckAccess(agentRing: 2, action: "file_write");
```

### Saga Orchestration

```csharp
using AgentGovernance.Hypervisor;

var saga = new SagaOrchestrator();
saga.AddStep("reserve", Reserve, CompensateReserve);
saga.AddStep("charge", Charge, CompensateCharge);
var result = await saga.ExecuteAsync();
```

### Audit & Telemetry

```csharp
using AgentGovernance.Audit;
using AgentGovernance.Telemetry;

var logger = new AuditLogger();
logger.Log(new GovernanceEvent { AgentId = "agent-1", Action = "tool_call", Decision = "allow" });

var metrics = new GovernanceMetrics();  // OpenTelemetry compatible
```

### ASP.NET Middleware

```csharp
using AgentGovernance.Integration;

// In Startup.cs or Program.cs
app.UseGovernanceMiddleware(options => {
    options.PolicyPath = "policies/default.yaml";
    options.AuditEnabled = true;
});
```

## 4. Development Notes

### Running Tests

```bash
cd packages/agent-governance-dotnet
dotnet test
```

### Single external dependency

Only YamlDotNet for YAML policy file parsing. All crypto, identity, and governance logic is implemented in pure C#.

## 5. Relevance to Our Project

**Use**: If building .NET components or Semantic Kernel integrations. The `GovernanceMiddleware` is useful for ASP.NET-based agent APIs.

**Skip**: If our stack is Python-only, the .NET SDK provides equivalent functionality to the Python packages.
