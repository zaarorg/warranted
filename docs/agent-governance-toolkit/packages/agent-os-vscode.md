# @microsoft/agent-os-vscode

## 1. Package Overview

VS Code extension providing kernel-level safety for AI coding assistants. Intercepts AI-suggested code changes and evaluates them against configurable policies before they reach your codebase. Supports CMVK (Cross-Model Verification Kernel) multi-model review, policy editor, workflow designer, SLO dashboard, agent topology graph, governance hub, enterprise SSO, and CI/CD integration.

- **Package name**: `@microsoft/agent-os-vscode`
- **Version**: 3.1.0
- **Language**: TypeScript
- **Requires**: VS Code >=1.85.0
- **Dependencies**: axios 1.13.6, ws 8.20.0
- **Dev stack**: TypeScript 5.3, React 19.2, Tailwind CSS 3.4, esbuild
- **Entry point**: `out/extension.js`

## 2. Architecture

### Directory Structure

```
packages/agent-os-vscode/
├── package.json             # Extension manifest, commands, configuration
├── src/
│   ├── extension.ts         # Activation entry point
│   ├── webviews/            # React-based webview panels
│   │   └── shared/          # Shared CSS (Tailwind)
│   └── ...
├── snippets/
│   └── agent-os.code-snippets  # Python/TS/JS/YAML snippets
├── out/                     # Compiled output
├── esbuild.webview.mjs      # Webview bundling
└── tailwind.config.*
```

### Key Commands (30+)

| Command | Description |
|---------|-------------|
| `agent-os.reviewCode` | Review selected code with CMVK multi-model verification |
| `agent-os.toggleSafety` | Toggle safety mode on/off |
| `agent-os.showAuditLog` | View audit log of AI actions |
| `agent-os.configurePolicy` | Open policy configuration |
| `agent-os.openPolicyEditor` | Visual policy editor |
| `agent-os.openWorkflowDesigner` | Visual workflow designer |
| `agent-os.showMetrics` | Metrics dashboard |
| `agent-os.showSLOWebview` | SLO dashboard (visual) |
| `agent-os.showTopologyGraph` | Agent topology graph |
| `agent-os.showGovernanceHub` | Governance hub |
| `agent-os.showKernelDebugger` | Kernel debugger |
| `agent-os.checkCompliance` | Check compliance |
| `agent-os.exportReport` | Export governance report |
| `agent-os.signIn` | Enterprise SSO sign-in |
| `agent-os.setupCICD` | CI/CD integration setup |
| `agent-os.installHooks` | Install git hooks |

### Configuration Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `agentOS.enabled` | `true` | Enable safety checks |
| `agentOS.mode` | `"basic"` | basic / enhanced / enterprise |
| `agentOS.policies.blockDestructiveSQL` | `true` | Block DROP/DELETE/TRUNCATE |
| `agentOS.policies.blockFileDeletes` | `true` | Block rm -rf |
| `agentOS.policies.blockSecretExposure` | `true` | Block hardcoded secrets |
| `agentOS.policies.blockPrivilegeEscalation` | `true` | Block sudo/chmod 777 |
| `agentOS.cmvk.enabled` | `false` | Multi-model verification |
| `agentOS.cmvk.models` | `["gpt-4", "claude-sonnet-4", "gemini-pro"]` | CMVK model list |
| `agentOS.cmvk.consensusThreshold` | `0.8` | Min consensus ratio |
| `agentOS.enterprise.sso.provider` | — | azure / okta / google / github |
| `agentOS.enterprise.compliance.framework` | — | soc2 / gdpr / hipaa / pci-dss |
| `agentOS.governance.pythonPath` | `"python"` | Python with agent-failsafe installed |
| `agentOS.governance.refreshIntervalMs` | `10000` | Polling interval |

## 3. Build & Development

```bash
cd packages/agent-os-vscode
npm install
npm run compile          # TypeScript + webviews
npm run watch            # Watch mode
npm run lint             # ESLint
npm test                 # Run tests
npm run package          # Create VSIX
```

### Webview Build

```bash
npm run build:css        # Tailwind CSS
npm run build:webviews   # esbuild for React webviews
npm run watch:webviews   # Watch mode for webviews
```

## 4. Development Notes

- The extension activates on startup (`onStartupFinished`) — always running
- Sidebar provides a unified webview panel (React-based)
- Can connect to a running agent-failsafe server or auto-start one via `agentOS.governance.pythonPath`
- All dev dependencies use exact version pinning (no ^ or ~)

## 5. Relevance to Our Project

**Use**: As a developer tool for team members working on governed agent code. The policy editor and SLO dashboard provide visual feedback during development.

**Skip**: This is an IDE tool, not a runtime component. It doesn't need to be deployed with our services.
