---
session_id: 20260727-eggr-configuration-center-dependencies
author: Codex GPT-5.6
host_os: windows-11-25h2
repo_root: Intergrated-POWER
base_commit: b82b425d335547e112ff16855353c2905fc373e2
branch: agent/codex/first-run-wizards
ownership:
  - ".ai/**"
  - "docs/**"
  - "vscode-extension/**"
  - "README.md"
  - "C:/Users/test/Documents/Codex/Knowledge/00 Inbox/Agent Worklog.md"
forbidden:
  - ".env"
  - ".env.*"
  - "secrets/**"
  - "operational-data/**"
  - "discussions/**"
  - "reports/**"
  - "C:/Users/test/.gemini/antigravity-ide/brain/**"
  - "C:/Users/test/AppData/Roaming/Antigravity IDE/User/globalStorage/**"
  - "C:/Users/test/.gemini/GEMINI.md"
  - "C:/Users/test/.gemini/config/GEMINI.md"
  - "../Intergrated-POWER-public/**"
state: dashboard_0_6_0_distribution_migration_verified
next_action: Reload Antigravity IDE and inspect the Configuration Center migration plan; the current managed plugin should report no-op.
---

# Handoff Log
- **2026-07-27 Dashboard 0.6.0 distribution-grade migration**: Replaced
  machine-specific recovery logic with a versioned installer that checks only
  the exact Antigravity global plugin root destinations. It validates plugin,
  skill, and EggR ownership, stages the bundled plugin, backs up recognized
  current and legacy directories, records managed SHA-256 values and a local
  install journal, rolls back moved directories on failure, and becomes a
  no-op when the installed version and checksums match. Unrecognized same-name
  directories block installation instead of being moved.
- **2026-07-27 temporary-profile distribution tests**: Clean install, 0.4.2
  legacy migration, same-path ownership conflict, injected interruption with
  rollback, and idempotent reinstall passed without touching decoy paths or
  GEMINI.md. Extension-host tests remained 8/8. The packaged VSIX contains no
  developer absolute path, email, or GEMINI template.
- **2026-07-27 managed live state**: Antigravity IDE Dashboard 0.6.0 and EggR
  Orchestrator plugin 2.1.0 are installed. The previous manually installed 2.0.0
  directory was backed up, the active plugin has `.eggr-install-state.json`,
  and the next plan reports `managed-current` and `no-op`.
- **2026-07-27 Dashboard 0.5.0 GEMINI boundary**: Removed the bundled
  `assets/gemini.md`, the extension-side initializer, and the PowerShell global
  rule installation option. The installed 0.5.0 package contains no GEMINI
  template. The user file SHA-256 remained
  `975B39433C22F47CFDD8D6146487D143D21EC86A613BA3C436328E2EB76D235D`
  before and after installation. In 0.4.2, existing files were preserved
  without an extension-created backup; the optional legacy append script used
  `~/.gemini/GEMINI.md.backup-YYYYMMDD-HHMMSS`.
- **2026-07-27 EggR Configuration Center**: Dashboard, Orchestrator, and
  user-owned Private Git Knowledge now share one settings page while retaining
  separate configuration and installation lifecycles. Public plugin and skill
  identities are `eggr-orchestrator-plugin` and `eggr-orchestrator`; explicit
  installation backs up the legacy plugin before transition.
- **2026-07-27 Dashboard 0.4.2 README replacement**: The packaged extension
  README now states that the product is an Antigravity IDE extension, not an
  extension for the separate Antigravity application or for Codex. It documents
  the only valid CLI wrapper, three independent setup tracks, dependencies,
  state paths, privacy boundaries, and troubleshooting. Source, VSIX, installed
  folder, and catalog version were verified.
- **2026-07-27 Dashboard 0.4.1 activation fix**: The target is the Antigravity
  IDE extension, not the separate Antigravity application or a Codex extension.
  Dashboard 0.4.0 failed during activation because Windows PowerShell wrote a
  UTF-8 BOM in `roots.json`. The extension now tolerates BOM-prefixed JSON and
  the Windows setter writes UTF-8 without BOM. Dashboard 0.4.1 is installed;
  the already-running IDE window still requires reload.
- **2026-07-27 Windows deployment**: Dashboard 0.4.0 was installed into
  Antigravity IDE and its extension catalog was verified. Orchestrator 1.2.0
  remains an explicit first-run installation because provider, endpoint, local
  model policy, and default route are user choices; opening the dashboard never
  overwrites the global plugin.
- **2026-07-27 three first-run wizards verified**: Dashboard, Orchestrator, and
  user-owned Private Knowledge now have separate command-palette entry points
  under one coordinator. The Dashboard stores only view/state-root choices;
  Orchestrator stores route and local-model policy without secrets; Private
  Knowledge launches the independently installed environment-bootstrap wizard.
- **Hardware-aware local selection verified**: `auto` detects current free VRAM
  and compute capability, estimates model memory from Ollama size or registry
  evidence, and uses task/history scores. `user_default` preserves an explicit
  model and records unknown compatibility when the registry lacks it. Q4/MXFP4
  weight formats are not treated as native FP4 runtime requirements.
- **Verification**: TypeScript compile, seven headless tests, seven VS Code
  extension-host tests, 41 PowerShell parser checks, offline selector cases,
  live RTX 3090 detection, isolated installer settings tests, VSIX content scan,
  and `git diff --check` passed. VSIX 0.4.0 SHA-256:
  `EC4D1D25074A75669D3AEB94B8CE67FA2B5DEF666152F3E5FC675C781A0453A9`.
- **2026-07-27 first-run wizard scope**: The three user-facing branches are Dashboard, Orchestrator, and user-owned private-Git knowledge accumulation. Never distribute the developer's personal Knowledge repository as product data.
- **2026-07-27 EggR Win11 stabilization started**: User confirmed that `Intergrated-POWER` is the private canonical source and `Intergrated-POWER-public` will become a sanitized release mirror. Current uncommitted v0.2.4 work must be preserved before cleanup.
- **Framework-neutral identity**: Use `EggR`, not a Codex-scoped root name. Windows 11 is the first stabilization and distribution target.
- **Telemetry direction**: Keep provider-reported usage, calculated counts, and model estimates separate. Adopt an EggR-owned versioned event schema with an OpenTelemetry GenAI compatibility mapping.
- **Orchestrator separation**: Extract the Codex orchestrator from the dashboard activation lifecycle. The dashboard may distribute or manage it explicitly, but must not silently overwrite the global orchestrator on every view activation.
- **Safety boundary**: Preserve pre-existing Gemini/Antigravity changes and runtime evidence. Do not delete or migrate Antigravity brain/globalStorage data during this phase.
- **User-Configured Power Limit Display (v0.2.4)**: Updated `TokenManager.ts` (`fetchGpuMetrics`) to query both `power.limit` and `enforced.power.limit` from `nvidia-smi`. This ensures that the dashboard dynamically reflects any custom power target currently configured/enforced by the user (e.g., via MSI Afterburner or `nvidia-smi -pl`), rather than displaying the unalterable physical hardware maximum (`power.max_limit`).
- Verified all headless tests pass cleanly, compiled and packaged `antigravity-ide-dashboard-0.2.4.vsix`, and installed directly into Antigravity IDE.
- **2026-07-27 v0.2.4 preserved**: Created local checkpoint `4966882e2a9566fa1044f4ecd36afaeb0c566911` before cleanup.
- **EggR resolver implemented**: PowerShell and TypeScript resolve the same Git-origin-derived workspace ID and use `%LOCALAPPDATA%\EggR\state` on Win11.
- **Lifecycle separation implemented**: Extension activation no longer installs the plugin or changes `GEMINI.md`. An explicit command stages, backs up, replaces, and migrates missing legacy state.
- **Telemetry foundation implemented**: Added schema 1.0, Korean methodology, and a metadata-only JSONL writer with evidence classes and calibration validation.
- **Verification complete locally**: Headless tests, VS Code extension-host tests, bundled Debate SelfTest, PowerShell parsing, resolver parity, telemetry round-trip, and VSIX content scan passed. Package SHA-256 is `54C6F422DF5559E9290D3EBF04216571B969D5ABD305998E314B840031D63BA4`.
- **Remote backup pending**: Push was not performed because the execution policy requires explicit confirmation that the GitHub remote is trusted/private. Public mirror remains untouched.
- **Central audit appended, sync unavailable on Win11**: Added the one-line Knowledge worklog entry. `save-agent-worklog` is not installed on this host; the repository copy is a Linux `$HOME/Knowledge` script that pushes `main`, so it was not substituted with a risky manual command.
- **VSIX installed without an implicit orchestrator overwrite**: Antigravity now selects dashboard 0.3.0 and the installed bundle hash matches the verified build. The global plugin remains 1.0.4 until the user explicitly runs the EggR orchestrator update command, as designed.
