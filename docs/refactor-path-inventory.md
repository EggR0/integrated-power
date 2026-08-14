# Integrated Power VSX Extension Path Inventory & Backup Index

## Repository Scope: Antigravity IDE / VS Code Extension (Track 1)

### Core Components & Authorities
- **VSIX Extension**:
  - `vscode-extension/src/` (extension.ts, BrokerController.ts, DashboardController.ts, TokenManager.ts, storagePath.ts, broker engine)
  - `vscode-extension/webview/` (Dashboard webview UI, main.js, styles.css)
  - `vscode-extension/package.json` (Extension manifest, commands, menus, views)
  - `vscode-extension/scripts/` (build-extension.js, run-headless-tests.js, run-broker-tests.js, run-reuse-gate.js, test-compact-ui.js, test-gpu-selection.js)
- **Bundled Orchestrator & Knowledge Assets**:
  - `vscode-extension/assets/ip-orchestrator-plugin/` (Full plugin for IDE installation)
  - `vscode-extension/assets/knowledge-tools/` (Private Git Knowledge onboarding tools)
  - `vscode-extension/assets/private-git-knowledge.md`
  - `vscode-extension/assets/start-d-local-llm.ps1`
- **Documentation**:
  - `docs/reuse-map.md`
  - `docs/adr/0001-reuse-boundaries.md`
  - `docs/reference/multi-ai-broker.ko.md`
  - `docs/marketing/`
  - `AGENTS.md`
  - `README.md`
- **Package Output**:
  - `vscode-extension/integrated-power-0.8.0.vsix`

### Decoupled / Migrated to Track 2 Standalone Repo
- `control-center/` -> Standalone repository at `https://github.com/EggR0/integrated-power-control-center`
- `.github/workflows/control-center.yml` -> Migrated to Track 2 `.github/workflows/release.yml`
