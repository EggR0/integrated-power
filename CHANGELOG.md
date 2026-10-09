# Changelog

## [0.9.6] - 2026-10-09

### Fixed & Hardened

- **Strict Pre-warm Quota Qualification Guard**: Pre-warm execution is strictly blocked and prevented from spawning CLI processes when a model's 5-hour quota is not genuinely 100% Ready (>=99.95%), when weekly quota is exhausted (0%), when the provider is offline, or when a recharge countdown is already active.
- **Zero Token Waste on Ineligible Triggers**: Clicking pre-warm buttons or selecting automation modes when quota is not 100% Ready will never consume tokens or invoke LLM generation; user is alerted with a clear warning explaining why the window is ineligible.
- **Fast Abort Ping (250ms)**: When eligible, the minimal ping aborts immediately within 250ms to activate the recharge timestamp without streaming completions.
- **Fixed Mode Persistence (`Always` reverting to `Click`)**: `DashboardController` maintains `currentPrewarmMode` as authoritative local state, preventing periodic background polling from overwriting `Always` mode back to default `Click`.
- **Target Provider Resolution**: Fixed Webview `data-prewarm` and Control Center auto-prewarm loop to pass exact provider model keys (`antigravity`, `opus`, `codex`) and incorporate weekly quota validation.
- **Broker HTTP Pre-warm Endpoint**: Added loopback `/prewarm` endpoint with quota telemetry verification.

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
