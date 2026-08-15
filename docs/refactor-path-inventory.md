# Integrated Power VSX Extension Path Inventory & Backup Index

## Repository Scope: Antigravity IDE / VS Code Extension (Track 1)

### Core Components & Authorities
- **VSIX Extension**:
  - `vscode-extension/src/` (extension.ts, BrokerController.ts, DashboardController.ts, TokenManager.ts, storagePath.ts, broker engine)
  - `vscode-extension/src/broker/autostart.ts` (Windows Registry autostart management and self-test)
  - `vscode-extension/src/broker/AgyQuotaClient.ts` (Native Google Cloud Code quota API client with Credential Manager integration)
  - `vscode-extension/src/broker/tokenScanner.ts` (Live Agy, Codex session, multi-GPU and Task Routing scanner)
  - `vscode-extension/src/broker/runScanner.ts` (Workspace .agent-runs/runs.jsonl and local_llm_metrics.csv scanner)
  - `vscode-extension/src/broker/server.ts` (Broker HTTP endpoints: `/v1/system/autostart`, `/v1/tokens/status`, `/v1/runs`, `/v1/metrics/local-llm`, `/mcp`)
  - `vscode-extension/webview/` (Dashboard webview UI, main.js, styles.css)
  - `vscode-extension/package.json` (Extension manifest, configuration for notifyOnFullTokens and autoStartOnBoot)
  - `vscode-extension/scripts/` (build-extension.js, run-headless-tests.js, run-broker-tests.js, run-reuse-gate.js, test-compact-ui.js, test-gpu-selection.js)
- **Bundled Orchestrator & Knowledge Assets**:
  - `vscode-extension/assets/ip-orchestrator-plugin/` (Full plugin for IDE installation)
  - `vscode-extension/assets/knowledge-tools/` (Private Git Knowledge onboarding tools)
  - `vscode-extension/assets/private-git-knowledge.md`
  - `vscode-extension/assets/start-d-local-llm.ps1`
- **Documentation**:
  - `docs/refactor-path-inventory.md` (This path inventory index)
  - `docs/reuse-map.md`
  - `docs/adr/0001-reuse-boundaries.md`
  - `docs/reference/multi-ai-broker.ko.md`
  - `docs/marketing/`
  - `AGENTS.md`
  - `README.md`
- **Package Output**:
  - `vscode-extension/integrated-power-0.8.0.vsix`

### Decoupled / Standalone Control Center (Track 2)
- `d:\Workspace\integrated-power-control-center` -> Standalone repository at `https://github.com/EggR0/integrated-power-control-center`
  - `index.html` (Token Status as default view, multi-GPU live cards, Local LLM benchmark table, Agent Runs timeline, Windows startup & notification controls)
  - `src/main.js` (Token status polling, Web Audio API synthesizer chime & OS notification for 100% full tokens, multi-GPU render, runs & local LLM metrics rendering, host integrations one-click actions)
  - `src/style.css` (Fluent 2.0 Dark Glassmorphism aesthetic, quota gauge rings, glowing model accents, switch toggles, data tables)
  - `src-tauri/src/main.rs` (Release GUI application centered on active monitor, system tray menu)
  - `src-tauri/target/release/integrated-power-control-center.exe` (Standalone release binary)
  - `start-control-center.cmd` (Interactive Windows launcher script)
