# Changelog

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
