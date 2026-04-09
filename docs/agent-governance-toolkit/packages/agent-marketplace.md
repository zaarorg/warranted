# agentmesh-marketplace

## 1. Package Overview

Plugin lifecycle management for governed agent ecosystems. Discover, install, verify, and sign plugins with Ed25519 signing and semver-aware version resolution. Provides trust tiers, quality scoring, compliance evaluation, schema adapters for Claude and Copilot plugin formats, workflow bundles, and usage-based trust adjustment.

- **Package name**: `agentmesh-marketplace` (PyPI), import as `agent_marketplace`
- **Version**: 3.0.2
- **Language**: Python >=3.9
- **Install**: `pip install agentmesh-marketplace`
- **Core dependencies**: pydantic, pyyaml, cryptography
- **Build system**: setuptools
- **Optional**: `[cli]` extra for click + rich CLI

## 2. Architecture

### Directory Structure

```
packages/agent-marketplace/src/agent_marketplace/
├── __init__.py              # Re-exports all public API
├── manifest.py              # PluginManifest, PluginType, load_manifest, save_manifest
├── registry.py              # PluginRegistry
├── installer.py             # PluginInstaller
├── signing.py               # PluginSigner, verify_signature
├── trust_tiers.py           # 5-tier trust system, PluginTrustStore
├── quality_scoring.py       # QualityScore, QualityBadge, QualityDimension
├── quality_assessment.py    # QualityAssessor, QualityAssessmentReport
├── marketplace_policy.py    # MarketplacePolicy, evaluate_plugin_compliance
├── schema_adapters.py       # ClaudePluginManifest, CopilotPluginManifest adapters
├── usage_trust.py           # UsageTrustScorer (adjust trust based on usage signals)
├── workflow_bundle.py       # WorkflowBundle, BundleRegistry
└── exceptions.py            # MarketplaceError
```

## 3. Key APIs

### Plugin Manifest

```python
from agent_marketplace import PluginManifest, PluginType, load_manifest, save_manifest

manifest = PluginManifest(
    name="my-plugin",
    version="1.0.0",
    plugin_type=PluginType.TOOL,
    description="A governed tool plugin",
    capabilities=["web_search"],
)
save_manifest(manifest, "plugin.json")
loaded = load_manifest("plugin.json")
```

### Plugin Registry & Installation

```python
from agent_marketplace import PluginRegistry, PluginInstaller

registry = PluginRegistry()
registry.register(manifest)
plugins = registry.search(query="web search")

installer = PluginInstaller()
installer.install(manifest, target_dir="/plugins")
```

### Ed25519 Signing

```python
from agent_marketplace import PluginSigner, verify_signature

signer = PluginSigner.generate()  # Creates Ed25519 keypair
signature = signer.sign(manifest)

# Verify signature
is_valid = verify_signature(manifest, signature, signer.public_key)
```

### Trust Tiers

```python
from agent_marketplace import get_trust_tier, compute_initial_score, TRUST_TIERS

# 5 tiers matching AgentMesh trust scoring
score = compute_initial_score(manifest)
tier = get_trust_tier(score)  # Returns tier name and config

from agent_marketplace import PluginTrustStore, filter_capabilities
store = PluginTrustStore()
allowed_caps = filter_capabilities(manifest.capabilities, tier)
```

### Quality Assessment

```python
from agent_marketplace import QualityAssessor, QualityAssessmentReport

assessor = QualityAssessor()
report: QualityAssessmentReport = assessor.assess(manifest)
# report.grade → AssessmentGrade (A/B/C/D/F)
# report.dimensions → list of DimensionResult
```

### Schema Adapters (Claude, Copilot)

```python
from agent_marketplace import (
    adapt_to_canonical, detect_manifest_format,
    ClaudePluginManifest, CopilotPluginManifest,
    extract_capabilities, extract_mcp_servers,
)

format_type = detect_manifest_format(raw_manifest)
canonical = adapt_to_canonical(raw_manifest)  # Converts to PluginManifest
```

### Marketplace Policy & Compliance

```python
from agent_marketplace import MarketplacePolicy, evaluate_plugin_compliance, ComplianceResult

policy = MarketplacePolicy(
    require_signing=True,
    min_quality_score=70,
    blocked_capabilities=["shell_exec"],
)
result: ComplianceResult = evaluate_plugin_compliance(manifest, policy)
```

## 4. Development Notes

### Running Tests

```bash
cd packages/agent-marketplace
pytest tests/ -x -q
```

## 5. Relevance to Our Project

**Use**: `PluginRegistry`, `PluginManifest`, `PluginSigner` (our registry component), `MarketplacePolicy` (compliance checks), `QualityAssessor` (plugin quality gates), schema adapters (if ingesting third-party plugin formats)

**Skip**: `WorkflowBundle` (unless we need multi-plugin orchestration), `UsageTrustScorer` (optional optimization)

**Architecture mapping**: The marketplace is our registry's foundation — plugin manifests define what tools are available, signing ensures integrity, trust tiers control what capabilities each plugin can access.
