# Gates: First-Time User Onboarding & Full Feature Usability Verification

OWNS: vscode-extension/scripts/test-first-run-onboarding.js, vscode-extension/src/extension.ts, vscode-extension/src/ConfigurationCenter.ts, vscode-extension/src/DashboardProvider.ts, GATES.md

Scope: Comprehensive end-to-end verification of first-time user installation, clean-slate activation, broker auto-start, configuration center, webview resilience in zero-CLI environments, and full feature workflow usability.

- [x] G1: VSIX package contains all necessary assets without missing bundled dependencies
  CHECK: node vscode-extension/scripts/test-first-run-onboarding.js --gate-package
  EXPECT: gate 1 passed: package assets verified
  EVIDENCE: VSIX unpack verified; extension.js, broker/index.js (316KB), broker/server.js, webview/quota-core.js, assets/ip-orchestrator-plugin present.

- [x] G2: Clean extension activation and automatic broker daemon cold-start in isolated profile
  CHECK: node vscode-extension/scripts/test-first-run-onboarding.js --gate-activation
  EXPECT: gate 2 passed: clean activation verified
  EVIDENCE: Clean activation on isolated temp directory succeeded; broker daemon cold-started on dynamic port; /health returned service 'integrated-power-broker'; offerFirstRunSetup prompted user with Open Configuration Center.

- [x] G3: Configuration Center initializes all 4 sections with valid default states
  CHECK: node vscode-extension/scripts/test-first-run-onboarding.js --gate-configuration
  EXPECT: gate 3 passed: configuration center verified
  EVIDENCE: Antigravity plugin inspect plan generated with blocked=false; 4 sections (Plugin, Broker, Local LLM, Quota) active; default state uncompleted for clean onboarding.

- [x] G4: Webview dashboard renders stably without crashing in vanilla zero-CLI environment
  CHECK: node vscode-extension/scripts/test-first-run-onboarding.js --gate-webview
  EXPECT: gate 4 passed: webview resilience verified
  EVIDENCE: Browser-like headless context verified with quota-core.js bundle; window.IPQuota bound; fallback gauge tick gradients and 5-hour quota clamping handle undefined/zero inputs safely without exceptions.

- [x] G5: Full feature user journey (Work Queue, Pre-warm, Broker REST/MCP) passes end-to-end
  CHECK: node vscode-extension/scripts/test-first-run-onboarding.js --gate-e2e
  EXPECT: gate 5 passed: full feature journey verified
  EVIDENCE: Task created (201 Created, ID returned) and listed; initial quota settings persisted with initializeFrom='ide' and retrieved; prewarm modes verified; Google Drive MCP path resolver returned cross-platform path structure.
