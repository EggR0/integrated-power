# Changelog

## [0.10.0] - 2026-10-15

### Added & Major Features

- **Google Drive 5TB Secondary Storage Broker Integration (`src/broker/gdriveStorage.ts`, `docs/reference/google-drive-storage-broker.ko.md`)**:
  - Connected 5TB Google One Cloud Storage (user Google account) as a Tier 2 secondary cloud storage tier for the Integrated POWER broker.
  - **Option B (Drive Ingestion Service)**: Scans Google Drive `IntegratedPower/Inbox` for mobile/web Gemini notes and documents, automatically ingesting them into broker `TaskEnvelope` queues with full idempotency (`idempotencyKey: gdrive_inbox_{fileId}`) and atomic moving to `Inbox/processed`.
  - **Option C (Artifact Offloader)**: Background multi-part offloading of large local artifacts (.vsix bundles, browser QA WebP/MP4 recordings, heavy logs) to `IntegratedPower/Artifacts/{taskId}/`, preserving permanent `webViewLink` references in the broker `EventLedger` while protecting local SSD disk space.
- **Self-Contained Google Drive MCP Authenticator (`scripts/setup-gdrive-mcp.js`, `docs/guides/google-drive-mcp-setup.ko.md`)**:
  - Implemented standalone Node.js OAuth 2.0 authenticator avoiding Windows path normalization bugs (`D:\C:\...`).
  - Generated full-control scope (`https://www.googleapis.com/auth/drive`) tokens with automatic token refresh (`GoogleDriveAuth`).
  - Authored comprehensive, reproducible step-by-step setup and troubleshooting guide for external user deployment.
  - Automatically configured Antigravity IDE global `mcp_config.json` with `gdrive` MCP server entry.
- **Unlazy Completion Discipline**: Formulated and passed all acceptance gates (`GATES.md`) with live E2E Google Drive API verification (verified 5120.0 GB quota and real-time artifact upload).

## [0.9.27] - 2026-10-14

### Fixed & Enhanced

- **5-Hour Quota Active Countdown Display at Full Capacity (`shared/quota/metric.ts`, `webview/quota-core.js`)**:
  - Resolved issue where 100% full 5-hour quota windows unconditionally displayed `· Ready` instead of showing active reset countdown times (such as `4h 35m` or `· 4:35`).
  - Updated display logic so that if an active reset time is strictly less than 5 hours (`diffMs < 5h`), the live countdown time is displayed while preserving `canPrewarm = true` and `isReady = true` for pre-warm automation.
  - Full dormant `· Ready` is now displayed only when the reset timestamp is missing, expired, or represents a full 5-hour resting state.

## [0.9.26] - 2026-10-14

### Fixed & Enhanced

- **Broker Approval Reject Route Implementation (`broker/server.ts`, `broker/broker.ts`)**:
  - Implemented missing `POST /v1/approvals/:id/reject` HTTP route in the broker server (`server.ts`), resolving the `404: not_found` error when clicking the "Reject" button on approvals (such as `budget-overage` or `external-send`).
  - Added `reject` method to `IntegratedPowerBroker` (`broker.ts`) with user decision auditing, atomic task cancellation, and approval queue removal.
  - Added `task.rejected` event replay handling in the broker ledger state recovery loop.
  - Added end-to-end regression test for approval rejection in `test-dashboard-approval-revision.js`.

## [0.9.25] - 2026-10-14

### Fixed & Enhanced

- **Webview Message ReferenceError & Broker Startup Synchronization (`webview/main.js`, `DashboardController.ts`, `DashboardProvider.ts`, `extension.ts`)**:
  - Fixed critical `ReferenceError: optionalNumber is not defined` inside `normalizeUsageSummary` in `webview/main.js` which caused the webview's `state` message listener to crash upon receiving `claudeDirectUsage`, leaving the UI permanently frozen in a `05:17 PM` skeleton state.
  - Promoted `optionalNumber` helper to outer scope and wrapped the entire webview message listener with try/catch to ensure resilient state handling.
  - Handled broker startup grace period in `DashboardController.refreshBrokerControls()`: suppressed premature red `Integrated Power broker is not started` error when the background broker server is still starting up.
  - Linked `brokerController.start()` completion in `extension.ts` to automatically refresh broker controls, quota settings, and dashboard state once the broker port becomes available.

## [0.9.24] - 2026-10-14

### Fixed & Enhanced

- **Webview Infinite Loading & Refresh Hang Resolution (`DashboardController.ts`, `DashboardProvider.ts`, `webview/main.js`)**:
  - Fixed `DashboardController.mergeTokenStatus` discarding previous token metrics when newly polled partial status had undefined percentages, preventing token status from resetting to empty skeleton state during refresh.
  - Added startup disk cache restoration from `token_status.json` so valid quota capacity and broker tasks display immediately upon webview mount without skeleton flicker.
  - Eliminated deadlock/hang in webview `ready` and `refresh` message handlers by decoupling serial await chains into independent asynchronous pipelines and publishing initial `brokerState` immediately on mount.
  - Added `isTokenRefreshing` mutex and protected against `tokenRefreshGeneration` race conditions where active quota fetches were discarded by rapid background polling ticks.

## [0.9.23] - 2026-10-14

### Fixed & Enhanced

- **Pre-warm 100% Ready Window Activation & Button Fix (`shared/quota/metric.ts`, `DashboardController.ts`, `webview/quota-core.js`)**:
  - Eliminated the erroneous `resetTime > Date.now()` and `hasActiveFutureCountdown` blocker that falsely treated fully refilled 100% quota windows as actively recharging, restoring the `[⚡ Pre-warm]` button to active status when capacity is full.
  - Resolved `once` pre-warm mode failing to trigger and remaining stuck without reverting to `click`: auto-prewarm evaluation cleanly dispatches on 100% Ready windows and automatically reverts target mode to `click` upon dispatch.
  - Added timestamp fallback guards (`updatedAt` / `lastSync`) in `getPrewarmEligibility` and broker prewarm request execution, preventing false rejection when individual quota pool measurement timestamps are coalescing.
  - Preserved `quotaPools` collection through `DashboardController.mergeTokenStatus` to protect telemetry metadata.

## [0.9.22] - 2026-10-13

### Added & Enhanced

- **Antigravity IDE Trajectory & Chat History Auto-Recovery (`AntigravityHistorySync.ts`, `sync_history.py`)**:
  - Automatically recovers and synchronizes missing Antigravity IDE conversation history and session trajectories from local brain logs and checkpoints into VS Code/Antigravity storage.
  - Protobuf Wire Spec compliant reconstruction of `antigravityTrajectorySummaries` in LevelDB storage.
  - Periodic background sync and real-time brain directory watcher with host platform guard (`isAntigravityHost`).
- **Configuration Center Force Sync Button (`ConfigurationCenter.ts`, `configurationModel.ts`)**:
  - Added dedicated "대화 기록 강제 동기화 (Force Sync History)" button to both Overview and Dashboard tabs in the Configuration Center.
  - Host environment guard ensures the sync button and status feedback are exclusively active in Antigravity IDE while cleanly hidden in standard VS Code hosts.

## [0.9.8] - 2026-10-10

### Fixed & Enhanced

- **Compact Sidebar Overflow Prevention & Multi-Line Label Elimination**:
  - Removed overflowing multi-line text label (`⚡ Pre-warm:`) from model section headers, replacing it with an ultra-compact icon and responsive segmented button controls.
  - Implemented 3-stage responsive text tokens (`.text-full`, `.text-medium`, `.text-short`: `Click`/`Once`/`Always` -> `Clk`/`1x`/`Alw`) to ensure zero horizontal clipping even on narrow sidebars (< 160px).
  - Fixed false-positive pre-warm target mapping so non-rolling windows (such as `Claude (API & CLI)` and GPU monitors) never display irrelevant pre-warm controls.
  - Added repository guideline in `AGENTS.md` and detailed reference in `docs/reference/compact-ui-overflow-prevention.ko.md` with automated regression tests in `scripts/test-compact-ui.js`.

## [0.9.7] - 2026-10-10

### Fixed & Enhanced

- **Model-Specific Independent Pre-Warm Modes**: Added independent automation mode controls (`Click`, `Once`, `Always`) for Gemini, Claude, and ChatGPT embedded directly into each model's section header row.
- **Accurate Real-Time Reset Countdown**: Restored real server-calculated refresh countdown display (`Refreshes in Xh Ym`) on 100% quota windows instead of masking it with static `Ready` text.
- **Genuine Provider Probe & Live Telemetry Refresh**: Replaced premature process abortion and hardcoded 5-hour local timestamp injection with genuine CLI probe execution and immediate live provider telemetry synchronization.
- **Gemini Weekly Quota Calculation Fix**: Fixed false-positive weekly quota exhaustion bug where Gemini percentage-only telemetry was incorrectly evaluated as 0% exhausted due to zero absolute token counters.
- **Settings Persistence**: Added `prewarmModeGemini`, `prewarmModeClaude`, and `prewarmModeChatGPT` configuration options.

## [0.9.5] - 2026-10-09

### Changed & Fixed

- Official Open VSX Registry marketplace release of the 3-mode Pre-warm quota optimization (`click`, `once`, `always`).
- Integrated automated GitHub Actions CI/CD pipeline for Open VSX with OIDC Trusted Publishing and PAT authentication fallback.
- Synchronized Control Center and Webview runtime footers and version manifests across both monorepo and standalone repositories.

## [0.9.4] - 2026-10-08

### Added

- **3-Mode Quota Pre-Warm Strategy** (`click`, `once`, `always`):
  - Pre-warm window activation: triggers an instantaneous cancellation ping on idle 100% quota windows to arm the 5-hour recharge cycle early while retaining >99.9% token capacity.
  - Three user-selectable automation modes:
    - `click`: On-demand manual trigger via the UI toolbar.
    - `once`: Automatically arms the 5-hour countdown once on initial ready state, then returns to manual mode.
    - `always`: Continuously monitors and arms fresh 100% quota windows with strict throttle protection.
  - Pre-warm interactive UI toolbar with live state badges (`Ready`, `Armed`, `Prewarming...`, `Success`, `Error`) and mode switcher in both Extension Webview and Control Center.
- Added `integratedPower.quota.prewarmMode` configuration property in `package.json`.

### Changed & Fixed

- **Hardened Lowest / Strongest Capacity Metric**:
  - Filtered out unauthenticated (`unauthenticated`, `offline`, `disabled`) and viewConfig-hidden providers from `calculateCapacitySummary`.
  - Prevents logged-out or disabled services from falsely reporting as 0% "Lowest" remaining quota.
- **Phantom Countdown Elimination**:
  - Quota windows at 100% capacity no longer display active countdown timers prior to user activity, showing `Ready` and arming the Pre-warm trigger instead.
- Cross-app synchronization and DOM XSS verification between VS Code extension and standalone Control Center.

## [0.9.3] - 2026-10-08

### Changed

- Revamped marketplace documentation: placed Quick Start, Open VSX installation instructions, and core real-world use cases at the top of the README.
- Preserved complete deep-dive technical architecture, security boundaries, and runtime specifications in the dedicated reference section.
- Synchronized Open VSX package metadata and release distribution assets.

## [0.9.2] - 2026-10-08

### Added

- Added per-window 100% full recharge notifications for 8 distinct targets:
  - Antigravity IDE Gemini (5-Hour & Weekly)
  - Antigravity IDE Claude (5-Hour & Weekly)
  - ChatGPT / Codex (5-Hour & Weekly)
  - Anthropic Claude Direct (5-Hour & Weekly)
- Configurable notification settings in settings (`integratedPower.notifications.*`) allowing users to toggle notifications per target.

### Changed

- Aligned publisher and extension identity to `EggR0` / `EggR0.integrated-power` for Open VSX verified publisher compatibility.
- Standardized quota model labels under Antigravity IDE: simplified to `Gemini` and `Claude` without version number noise.
- Hardened compact UI layout to prevent line wraps and overflow when reset hours are 2-3 digits (e.g. `151h`).
- Standardized time and minute formatting across full, medium, and compact webview displays.
- Strengthened shared quota calculation logic (`shared/quota`) and verified parity across webview and desktop control-center.
- Hardened local LLM probe stability, GPU caching, and shared capacity summary.

## [0.7.4] - 2026-07-28

### Changed

- Bundled the Win11 Knowledge setup, route, and save tools in the extension so
  Configuration Center no longer requires a separate environment-bootstrap
  installation.
- Added a non-overwriting Obsidian scaffold and deterministic routing policy
  for Inbox, Projects, reusable Knowledge, Areas, and Templates.
- Made user-owned Knowledge `main` the canonical global store and prohibited
  task-named Knowledge branches in the installed rules and save commands.
- Added current Knowledge branch, routing-policy, and remaining agent-branch
  diagnostics to Configuration Center.

## [0.7.3] - 2026-07-28

### Changed

- Changed the managed Antigravity IDE plugin and skill identity to
  `ip-orchestrator-plugin` and `ip-orchestrator`.
- Added exact-path, non-destructive migration from recognized
  `eggr-orchestrator` and `codex-orchestrator` installations.
- Moved the default product state root to
  `%LOCALAPPDATA%\IntegratedPower\state`; legacy state is copied once without
  deleting the old directory.
- Made Configuration Center environment refresh re-read the live Windows
  user/system PATH and standard CLI install locations, so newly installed
  GitHub CLI can be detected without restarting the IDE.
- Added GitHub login/remote detection and an explicit Knowledge `origin`
  reconfiguration action.
- Clarified which dependencies are optional and separated the non-mutating
  Knowledge setup wizard from automatic `save-agent-worklog` synchronization.
- Expanded the Configuration Center and README explanations of why Dashboard,
  Integrated Orchestrator, and Private Git Knowledge are separate.

All notable user-facing changes to Integrated Power are recorded here.

## [0.7.2] - 2026-07-28

### Changed

- Adopted `EggR` as the publisher and `EggR.integrated-power` as the extension
  identity.
- Moved the public repository to `EggR0/integrated-power`.
- Removed release numbers and review-state wording from the packaged README so
  routine GitHub documentation changes do not become stale marketplace text.

## [0.7.1] - 2026-07-28

### Changed

- Adopted `integratedpower.integrated-power` as the canonical extension ID
  before the first marketplace publication.

## [0.7.0] - 2026-07-28

Planned as the first Open VSX public release.

### Changed

- Adopted the Integrated Power product and publisher display name.
- Renamed the user-facing orchestration component to Integrated Orchestrator
  while retaining `eggr-orchestrator` as its compatibility identifier.
- Clarified that Open VSX is a distribution channel and Antigravity IDE on
  Windows 11 is the initial supported runtime.
- Added public licensing, commercial licensing, security, privacy and support
  boundaries.

### Security

- On Windows, the Dashboard continues to read the signed-in user's local Agy
  credential in a local process and query the usage API.
- Actual Agy access-token and refresh-token values are not written to Integrated
  Power settings, logs or the public repository.
- Users may also inspect Agy usage directly with the official TUI `/usage`
  command.
- Public packages contain no user Knowledge data, conversations, credentials,
  private remotes, developer paths or operational records.
- Integrated Power does not create, append to or replace `GEMINI.md`.

## [0.6.0] - 2026-07-27

Internal Windows 11 stabilization release.

### Added

- A safe Configuration Center for Dashboard, Orchestrator and user-owned
  Private Git Knowledge, with independent setup and installation lifecycles.
- Hardware-aware local LLM candidate selection using VRAM, Compute Capability,
  backend constraints, installed model evidence and user override policy.
- Orchestrator installation planning, ownership checks, backup, atomic
  activation, rollback and idempotent reinstall behavior.

### Changed

- Restricted plugin discovery and migration to known Antigravity IDE plugin
  roots instead of searching user directories recursively.
- Preserved `eggr-orchestrator` and `eggr-orchestrator-plugin` as machine
  identifiers.

### Security

- Blocked replacement of unrecognized same-name plugin directories.
- Removed `GEMINI.md` creation and replacement from the extension lifecycle.
- Kept developer Knowledge, credentials, user paths and private remotes out of
  distributable artifacts.
