# Changelog

## [0.11.1] - 2026-10-16

### Fixed & Enhanced

- **Dynamic AGY Model Resolution & Universal Family Fallback (`src/broker/agyModelResolver.ts`, `src/broker/server.ts`)**:
  - Dynamically discovers live models via `agy models` CLI with in-memory caching instead of hardcoding static model slugs.
  - Automatically matches family keywords (`gemini`, `claude`) and resolves lowest-resource / flash tiers, with generic model-name fallback.
  - Updated static fallbacks to active versions (`gemini-3.8-flash-low`, `claude-sonnet-5-5-low`).
  - Fixed prewarm process spawning by removing premature 250ms process kills and adopting `--print-timeout 3s` with clean exit-code handling.
- **Cross-Provider Weekly Quota Exhaustion Lock (`shared/quota/metric.ts`, `webview/main.js`, `control-center/src/main.js`)**:
  - Enforced weekly quota constraints across Gemini, Claude, and Codex/ChatGPT 5-hour windows.
  - When weekly quota reaches 0%, 5-hour window display locks to `0.00% remaining (Weekly exhausted)` with `critical` tone, disabling prewarm.
  - Updated `calculateCapacitySummary` to rank 5-hour windows by their effective ceiling, preventing 0% weekly models from erroneously winning the Best recommendation.
- **Primary Model Group Parsing (`src/TokenManager.ts`)**:
  - Prioritizes canonical model groups (`Gemini Models`) over separate preview tiers (`Gemini 4 Argon`), preventing conflicting weekly quotas from falsely causing `W Waiting`.

## [0.11.0] - 2026-10-15

### Added & Enhanced

- **First-Time User Onboarding & VSIX Integrity Verification (`GATES.md`, `scripts/test-first-run-onboarding.js`, `.vscodeignore`)**:
  - **Fixed VSIX Bundle Closure**: Resolved critical `.vscodeignore` bug where `out/broker/**` was omitted, ensuring the 1.48MB production VSIX completely packages all broker daemon runtime assets.
  - **Clean-Slate Isolation Gates**: Established 5 acceptance gates (G1~G5) verifying clean activation, automatic broker cold-start, 4 configuration center tabs, zero-CLI webview resilience, and full E2E user workflows in an isolated test environment.
  - **Permanent CI Regression**: Registered `test:onboarding` script in `package.json` and integrated into the primary `npm test` suite.
- **Configuration Center Modern Redesign (`src/ConfigurationCenter.ts`)**:
  - **Token Telemetry Guide Banner**: Added a modern glassmorphic guide card detailing exact prerequisites for real-time quota retrieval across Google Antigravity, OpenAI Codex, Anthropic Claude, and Local LLMs.
  - **Categorized Section Dividers**: Reorganized settings into clean semantic groups (*Providers & Quota*, *Agent Panels*, *Broker & System*, *Storage & Maintenance*) with pill badges.
  - **Refined Typography & Captions**: Replaced cluttered text with polished, concise single-line setting descriptions and hover transitions.
- **Unified Task Queue with Quick Add & AI Tag Classification (`src/broker/`, `webview/broker-controls.js`)**:
  - **Quick Add Task Queue**: Top-bar quick input field in the sidebar webview and global command `Integrated Power: Add Task to Queue` (`integratedPower.addTaskToQueue`), allowing users to jot down raw notes and tasks that are instantly recorded in the durable broker ledger.
  - **AI Tag Pool Matching & Generation (`POST /v1/tasks/:id/classify`, `GET /v1/tags`)**: Compares new task memos against existing historical tag pools, assigning existing tags or generating new semantic tags (`tags: [...]`) via user-chosen agent platform with robust offline heuristic fallbacks.
  - **One-Click Execution & Multi-Platform Switch Chips**: Added one-click run buttons (`[▶ Run on Codex]`) targeting AI-recommended platforms alongside instant switch chips (`[Local | Codex | Agy]`) for direct execution without extra navigation.
  - **Compact UI Strict Overflow Prevention**: Verified zero-overflow and zero dynamic `innerHTML` rendering down to 120px narrow sidebar widths.
- **Repository Architecture Cleanup & Standalone Daemon Fix (`scripts/standalone-broker.js`, `src/storagePath.ts`)**:
  - **Fixed Standalone Broker Daemon**: Fixed `TypeError: EncryptedFileLedger is not a constructor` and directory key path issues by adopting canonical `createPreferredEventLedger` and key loading with live E2E process lifecycle verification.
  - **Retired Zombie Code**: Safely retired ~96KB of unused modules (`DeadCodeManager`, `RefTransactionCoordinator`, `SerenaWasmIndexer`, `test-visual-graph-safety-guard`) and streamlined CI test chains.
  - **SSOT Path Consolidation**: Aligned `storagePath.ts` with cross-platform `platformPaths.ts` and replaced duplicate `sync_history.py` with a forwarding wrapper to the canonical extension asset.

## [0.10.1] - 2026-10-15

### Enhanced & Docs

- **Complete Overhaul of Documentation & READMEs**:
  - Overhauled repository root `README.md` and extension `README.md` with modern 4-tier system architecture diagrams, cross-platform OS path standards (Windows, macOS, Linux XDG), and clear multi-tier storage guides.
  - Published comprehensive end-user storage setup manuals: [Google Drive MCP Setup Guide](docs/guides/google-drive-mcp-setup.ko.md) and [Multi-Tier Storage Architecture Guide](docs/guides/storage-backends.ko.md).
- **Automated Open VSX CI/CD Pipeline on Tag Push**:
  - Updated `.github/workflows/publish-openvsx.yml` to trigger on both GitHub release publish events and direct Git version tags (`v*`), ensuring reliable and immediate marketplace synchronization.

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
- **Standalone Headless Broker & Cross-Platform Path Resolution (`src/broker/platformPaths.ts`, `scripts/standalone-broker.js`, `docs/reference/cross-platform-broker-ipcc.ko.md`)**:
  - Decoupled broker service from Antigravity IDE/VS Code into an independent daemon bound to loopback `127.0.0.1:37241`.
  - Added OS-neutral path and config resolution supporting Windows 11, macOS, and Linux (XDG Base Directory Specification).
  - Aligned with Integrated Power Control Center (IPCC, Tauri) for seamless multi-platform desktop orchestration.
- **Durable Agent-Broker Protocol & Knowledge Distillation Bridge (`src/broker/gdriveStorage.ts`, `docs/reference/durable-agent-broker-protocol.ko.md`)**:
  - Formalized durable task lifecycle accounting for agent non-autonomy, ephemeral sessions, and token exhaustion.
  - Implemented `DriveKnowledgeDistillationBridge` connecting Google Drive 5TB heavy binary offloading with GitHub/Obsidian curated text knowledge (`eggr-knowledge`) via markdown pointer links.
  - Enforced strict human-in-the-loop approval discipline and blocked autonomous agent self-approval.
- **Unlazy Completion Discipline**: Formulated and passed all acceptance gates (`GATES.md`) with live E2E Google Drive API verification (verified 5120.0 GB quota) and 5 cross-platform/durable protocol acceptance gates.

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

## [0.9.21] - 2026-10-12

### Fixed & Enhanced

- **Live Zero-Token ChatGPT/Codex Quota Telemetry via App-Server RPC (`codexAppServer.ts`, `TokenManager.ts`, `tokenScanner.ts`)**:
  - Implemented direct, periodic live rate limits query using the official Codex app-server JSON-RPC method `account/rateLimits/read` over stdio.
  - **Zero Token Consumption**: Fetches live OpenAI primary (5-hour window, `usedPercent`, `resetsAt`), secondary (weekly window, `usedPercent`, `resetsAt`), and reset credits (`rateLimitResetCredits.availableCount`) in <500ms without executing model prompts or consuming user quota.
  - Eliminates stale session discrepancies between ChatGPT Desktop App and the IDE dashboard: users no longer need to perform any coding work or execute CLI turns to view authentic live reset times and quota percentages.
  - Gracefully falls back to passive `~/.codex/sessions` JSONL parsing when the Codex app-server is offline.
  - Cached for 20 seconds during background continuous polling, and refreshed immediately upon manual user refresh (`forceRefresh = true`).

## [0.9.20] - 2026-10-11

### Fixed & Enhanced

- **Native Claude / Gemini 5-Hour Reset Time Ingestion Fix (`TokenManager`)**:
  - Fixed root cause where `TokenManager.fetchQuotaData` explicitly discarded `bucket.resetTime` (`(percentage < 99.95) ? bucket.resetTime : undefined`) when remaining fraction was 1.0 (100%), wiping out Claude's active rolling recharge timestamp (`3p-5h`).
  - Directly preserved `bucket.resetTime` across all 5-hour quota buckets from Cloud Code API so active countdowns (`· Refreshes in 1m`, `· 3:54`) render reliably matching AGQ.
- **Removed Synthetic Overrides & Pure Telemetry Grounding (`DashboardController`)**:
  - Eliminated artificial `isPrewarmedRecently` overrides that previously forged 99.9% quota and synthetic timestamps in `mergeTokenStatus`, ensuring 100% authentic upstream API telemetry is displayed.
- **Clean AGQ Timer Parity & UI Target Accuracy (`webview/main.js`)**:
  - Cleaned up metric display to match AGQ: whenever an active reset time exists, the genuine refresh countdown is rendered directly without synthetic badge distractions.
  - Hardened prewarm button group targeting: excluded non-applicable `Claude (API & CLI)` local direct usage row from prewarm actions.
- **Broker Prewarm Validation Parity (`broker/server.ts`)**:
  - Synchronized `/prewarm` endpoint validation with `DashboardController`, checking for existing active rolling recharge cycles to prevent duplicate pings.

## [0.9.19] - 2026-10-11

### Fixed & Enhanced

- **Active Rolling Recharge Countdown Display for 100% 5-Hour Windows**:
  - Fixed bug where 5-hour quota windows at 100% capacity unconditionally suppressed active countdown timers and forced `· Ready`, even when upstream providers already have an active rolling cycle running ahead of time (e.g. resets in 28m or 4h 18m matching AGQ).
  - Preserved valid future reset timestamps (`new Date(resetTime).getTime() > Date.now()`) across `TokenManager.sanitizeResetTime` and `DashboardController.sanitizeResetTime` instead of wiping them to `undefined` when percentage is 100%.
  - In `shared/quota/metric.ts`, distinguished between dormant 100% windows (no active rolling timer -> `· Ready` and `canPrewarm = true`) and active pre-warmed 100% windows (rolling timer running -> live countdown rendered, `canPrewarm = false`, `isPrewarmed = true`).
- **Dynamic Pre-Warm Button to Active Status Tag Transition**:
  - When a 5-hour window has an active recharge cycle running ahead of time, the `[⚡ Pre-warm]` action button automatically disappears and transitions to a compact `⚡ Active` badge (`<span class="prewarm-active-tag">⚡</span>`) alongside the live refresh countdown.
  - In `DashboardController.getPrewarmEligibility`, pre-warm requests for windows already running an active rolling cycle are cleanly refused with remaining time info, preventing duplicate pings.
  - Zero overflow guaranteed under narrow viewport widths (< 200px) with comprehensive regression test verification.

## [0.9.18] - 2026-10-11

### Fixed & Enhanced

- **Codex / ChatGPT Active Session Deep Tree Scanning**:
  - Fixed premature 80-file search truncation in `TokenManager.collectJsonlFiles`: sessions directory traversal now scans all date subfolders instead of halting upon reaching 80 files in the first directory visited.
  - When sessions are resumed across days, active threads in prior folders (e.g. `2026/09/10/rollout-...`) are now correctly discovered and ranked first by `mtimeMs`.
  - Accurately synchronizes ChatGPT official desktop app live usage (`5H 87%` reset at 19:14, `Weekly 98%` reset on Oct 18) instead of falling back to expired past sessions.
  - Added recursive directory walking to `tokenScanner.scanCodexQuota`.

## [0.9.17] - 2026-10-11

### Fixed & Enhanced

- **Instant Pre-Warm Trigger & Live 5-Hour Countdown Activation**:
  - Fixed prewarm button click failing to shift UI state from `· Ready` to active countdown: immediately applies optimistic prewarm transition (`applyPrewarmTransition`) to live state upon user click, dropping quota to 99.90% and starting the 5-hour recharge timer (`Refreshes in 4h 59m`).
  - Added prewarm retention guard in `mergeTokenStatus`: preserves active prewarmed countdown and 99.90% quota during 5-second polling cycles while remote telemetry catches up, preventing background polling from instantly reverting the window back to 100% Ready.
  - Added instant visual click feedback in Webview: `[data-prewarm]` button immediately disables and displays `⚡ Starting...` upon click.
- **CLI Ping Invocation Fix for Antigravity & ChatGPT**:
  - Resolved `agy.exe` model mismatch: passed exact CLI model name (`"Gemini 3.6 Flash (Low)"` / `"Claude Sonnet 5.5 (Low)"`) and eliminated `--effort low` parameter that caused `agy.exe` to error out.
  - Extended Codex instant abort watchdog from 250ms to 3000ms so `codex exec` has sufficient time to initialize Node/CLI and dispatch the turn to OpenAI before aborting.

## [0.9.16] - 2026-10-11

### Fixed & Enhanced

- **ChatGPT Desktop 100% / 100% Quota Synchronization**:
  - Resolved discrepancy between official ChatGPT desktop application (5h 100%, 1w 100%) and stale CLI session files from previous days (>12h old) by rolling over to 100% weekly quota with current 7-day cycle reset (`codexWeeklyPercentage = 100`, `codexWeeklyResetTime = 10/18`).
  - Eliminated zombie past timestamp resurrection (`resetsAt * 1000 <= Date.now()`) across `DashboardController.mergeTokenStatus` and `TokenManager.withFallbackQuota` via `sanitizeResetTime`.
- **100% Ready Window State Guaranteed**:
  - In `shared/quota/metric.ts`, 5-hour windows with 100% capacity (`>= 99.95%`) now strictly prioritize `· Ready` and `⚡ Pre-warm` without being overridden by synthetic dummy API timestamps or expired countdown strings.
  - Gemini actively consumed quota (~73%) smoothly counts down live every 10 seconds.
- **Antigravity IDE & Live Provider Integrity**:
  - Verified `AgyQuotaClient` conducts direct, real-time live HTTPS requests against Google Cloud Code API with zero stale disk caching.
  - Cleaned persistent disk cache in `dashboard-state.json`.

## [0.9.15] - 2026-10-11

### Fixed & Enhanced

- **5-Hour Quota Live Countdown & Refresh Fix**:
  - Fixed permanent "4시간 59분" frozen countdown for Antigravity IDE models (Gemini & Claude) by distinguishing idle 100% capacity from active rolling recharge cycles and avoiding Cloud Code API synthetic dummy reset timestamp overrides.
  - Added a 10-second ticker interval (`setInterval(render, 10000)`) in Webview UI so reset timers count down dynamically in real time without requiring full host round-trips.
  - Eliminated high-frequency PowerShell credential helper spawns by introducing an in-memory OAuth token cache in `AgyQuotaClient`, reducing quota telemetry fetch latency from ~2.5s to ~100ms and eliminating polling freezes.
- **ChatGPT Reset Time Synchronization**:
  - Fixed permanent "· Refreshes soon" display for ChatGPT / Codex when quota resets to 100% by properly clearing expired historical reset timestamps (`resetsAt * 1000 <= Date.now()`).
- **Pre-Warm (Click & Once) Execution Fix**:
  - Removed erroneous `resetTime > Date.now()` blocker in `getPrewarmEligibility` that falsely marked 100% Ready windows as already recharging.
  - Immediately trigger auto-prewarm evaluation upon switching modes to `once` or `always` so active 100% windows arm without delay.
- **Configurable Telemetry Polling**:
  - Added `integratedPower.quota.pollInterval` configuration setting (1s–60s, default 5s) with live settings synchronization and race-condition-free background timer execution.



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
- Added granular notification configuration properties (`integratedPower.notifications.*`) in `package.json`.

### Changed

- Aligned publisher and canonical extension identity to `EggR0` / `EggR0.integrated-power` for Open VSX verified publisher requirements.
- Standardized Antigravity model group labels to clean `Gemini` and `Claude` labels.
- Hardened compact UI layout: prevents flex wrapping and text clipping when countdown hours reach 2-3 digits.
- Unified refresh countdown formatting (`formatRefreshCountdown`) stages (`full`, `medium`, `short`).
- Parity tests and full headless test coverage for shared quota core (`shared/quota`).

## [0.7.14] - 2026-08-12

### Added

- Added a separate `Claude Direct` usage panel for Claude API, Claude CLI, and
  Cowork token usage measured from local metadata logs and Integrated Power
  telemetry.
- Added local collectors for Claude-related JSONL/log usage events and
  `token_usage.csv` rows tagged as Claude, Anthropic, or Cowork.

### Changed

- Restored the Antigravity IDE Opus quota label to `Opus 4.6 Thinking` so it is
  not confused with direct Claude API or CLI usage.

## [0.7.13] - 2026-08-12

### Changed

- Kept refresh feedback in one place: the Token Status pill now shows elapsed
  refresh time while previous quota data remains visible and greyed.
- Split Local LLM GPU capacity into its own Local Compute panel so token quota
  rows no longer inherit wide hardware labels.
- Added a compact capacity summary for the strongest and lowest remaining
  quotas across Gemini, Claude, and ChatGPT.
- Renamed the Opus quota group to `Claude Opus 4.6 Thinking`.
- Added hover threshold details to quota and hardware gauges.
- Grouped Errors by dashboard, quota telemetry, run execution, and run-log
  parsing sources.

## [0.7.12] - 2026-08-10

### Changed

- Unified refresh feedback by removing the separate header refresh text and
  floating refresh banner when previous data is visible.
- Greyed capacity progress gauges while refresh is in progress so stale values
  remain visible but are visually distinct from fresh data.

## [0.7.11] - 2026-08-10

### Changed

- Reworked capacity rows so labels, values, and reset times share one compact
  line and progress bars use the full row width, removing the large empty label
  column beside `5Hours`, `Weekly`, GPU utilization, and VRAM usage.
- Restyled the Antigravity IDE, Codex, and Local LLM collapsible section
  headers as visible tab controls with explicit expand/collapse markers.

## [0.7.10] - 2026-08-10

### Changed

- Renamed the Codex capacity group label to `ChatGPT` so the `Codex` platform
  section no longer repeats `Codex` as both platform and model/quota name.

## [0.7.9] - 2026-08-10

### Changed

- Reduced vertical spacing in token capacity rows, labels, progress bars, and
  supporting text so model usage groups take substantially less height.
- Removed parentheses from the `5Hours` and `Weekly` capacity labels.

### Fixed

- Preserved the previous visible token data during refresh when the newly read
  token report is empty or still being refreshed, preventing the panel from
  falling back to a loading-only view.

## [0.7.8] - 2026-08-10

### Changed

- Unified the token capacity layout so each model shows its 5-hour and weekly
  limits together in the same repeated structure.
- Removed the large header Refresh and Open Runs buttons while preserving the
  compact title-bar runs and refresh controls.
- Kept the existing status pill value visible during token refresh instead of
  replacing Idle with Loading.

### Fixed

- Added a refresh-in-progress notice when the dashboard is showing previous
  data while new data is loading.
- Tightened the dashboard responsive layout so the capacity panel no longer
  collapses into a broken narrow blue border state.
- Aligned the main dashboard refresh command and compact title-bar refresh
  command so both request the same data refresh path.
- Normalized `OLLAMA_HOST=0.0.0.0` to a localhost client endpoint and isolated
  local LLM tests from machine-level Ollama environment variables.

## [0.7.7] - 2026-08-01

### Fixed

- Stopped Integrated Orchestrator from encouraging a new Antigravity IDE
  artifact for every local-model prompt, response, or helper command.
- Added direct `-PromptText` and `-ContextFile` inputs so generated prompts no
  longer require a file under `brain/scratch`.
- Coalesced output paths anywhere below one Antigravity brain session into its
  stable `ip-orchestrator.md` by default; explicit `Separate` mode remains
  available when the user asks for distinct deliverables.
- Replaced timestamped default local/Codex result paths with stable
  `reports/tasks/<task-key>.md` paths and kept Codex machine logs outside the
  Antigravity brain.
- Added a regression test proving one local LLM invocation leaves exactly one
  file in a simulated Antigravity brain session.

## [0.7.6] - 2026-08-01

### Changed

- Made the current PC's canonical
  `~/.config/integrated-power/roots.json` the single writable path contract;
  previous `eggr` roots remain read-only migration input.
- Added Configuration Center selectors for the common work root, Knowledge
  root, Knowledge tools root, and Antigravity IDE plugin root.
- Routed extension state, plugin installation, Knowledge setup, and bundled
  tools through shared resolvers with explicit environment-variable overrides.
- Treats OS-derived locations as visible suggestions until the user explicitly
  saves or installs; it does not scan other users, drives, or similarly named
  directories to guess an installation path.
- Added isolated distribution tests using custom roots outside the simulated
  user's home directory.

## [0.7.5] - 2026-08-01

### Fixed

- Unified orchestrator settings discovery across the canonical
  `integrated-power`, previous `eggr`, and legacy Antigravity IDE paths.
- Fixed the Windows PowerShell 5.1 single-history metric failure in local model
  selection.
- Added explicit Ollama cold-load timeouts and `keep_alive` to the real
  generation request instead of treating a short warm-up as a readiness gate.
- Made the bundled Knowledge root resolver prefer canonical Integrated Power
  roots and avoid the PowerShell 7 reserved `$IsWindows` variable collision.

### Added

- Added first-run Ollama inventory synchronization using `/api/tags` with an
  `ollama ls` compatibility fallback.
- Added a user-owned local model registry under
  `~/.config/integrated-power/local_llm_model_registry.csv`; installed unknown
  models receive neutral priors and measured results can refine later routing.
- Added structured install suggestions when no compatible installed model is
  available. Models are never downloaded before the user approves an exact
  suggestion.
- Added Configuration Center controls and diagnostics for installed,
  registered, newly discovered, and registry-only models.

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
