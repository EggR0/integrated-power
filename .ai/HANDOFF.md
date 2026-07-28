---
session_id: 20260728-eggr-publisher-and-repository-identity
author: Codex GPT-5.6
host_os: windows-11-25h2
repo_root: Intergrated-POWER
base_commit: 5c6ff172eb2357b40a07ae8200d34234dfd6896f
branch: agent/codex/first-run-wizards
ownership:
  - ".ai/**"
  - ".github/**"
  - "docs/**"
  - "scripts/release/**"
  - "vscode-extension/**"
  - "README.md"
  - "../integrated-power-antigravity-public/**"
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
state: eggr_openvsx_cli_installed_auth_pending
next_action: Complete the secure Open VSX PAT prompt, verify the EggR namespace, and publish the already-built EggR.integrated-power 0.7.2 VSIX without rebuilding it.
---

# Handoff Log
- **2026-07-27 Win11 direct distribution**: Added a self-contained release
  builder and double-click install, verify-only, and extension-only uninstall
  entry points. The package pins the Dashboard VSIX plus the user-owned
  Private Knowledge Windows tools from environment-bootstrap commit
  `eea1adf1050e1a13a93272c06aabf92ea4979db8`. Antigravity IDE and optional
  third-party dependencies remain explicit user installations.
- **2026-07-27 distribution hardening**: The builder verifies the VSIX internal
  identity/version and clean Git provenance, converts PowerShell payloads to
  UTF-8 BOM for Windows PowerShell 5.1, and records every required payload
  hash. The installer rejects missing/duplicate mappings, reparse points,
  unknown same-name Knowledge commands, externally modified managed commands,
  the separate Antigravity application, and non-Antigravity IDE CLIs.
- **2026-07-27 live direct-install verification**: The installed Dashboard
  remained 0.6.0, eight Knowledge command files match the release, schema 2
  state records their hashes, and the second run changed neither files nor
  state. Extracted-ZIP verify-only, tampered-VSIX rejection, wrong-CLI rejection,
  uninstall verify-only, private-string scan, and sidecar hash verification
  passed. `GEMINI.md` and `roots.json` hashes remained unchanged. Final ZIP
  SHA-256: `FF84156C82C5C3F07BA2ACBAE0432B506679F1ECC2C6E1AB91F5E44E6976704F`.
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
- **2026-07-28 Integrated Power 0.7.0 release preparation**: Preserved the
  existing Agy quota implementation byte-for-byte, changed only public
  branding/metadata/documentation and the readable legacy-author identifier,
  added the 256 px Integrated Power icon and PolyForm Strict licensing, and
  packaged a 39-entry VSIX. Headless tests and extension-host tests passed;
  the final VSIX privacy scan found no personal identifier, personal email,
  developer home path, `GEMINI.md`, or nested VSIX. VSIX SHA-256:
  `3B20CFC5DA5A06AB456FBA56A47D6F8DEC6BE66CF26204D8D0440F48653654FE`.
- **Fresh public snapshot prepared**: The strict allowlist exporter created
  `integrated-power-antigravity-public` with 83 files and no private Git
  history. Its root commit on `agent/codex/public-release-0.7.0` is
  `a819f41f5d500571590cf4cf114d1ecddbed511a`.
- **2026-07-28 public GitHub release published**: Installed and authenticated
  GitHub CLI 2.96.0, created the public repository
  `R-Github04/integrated-power-antigravity`, pushed the agent release branch,
  and merged PR #1 through `main` at
  `3f018f46a473c7eb2facc467793efc35392cf73e`. CI was corrected to use Node
  24 for pnpm 11.9 and `pwsh` for UTF-8 source parsing; the PR and post-merge
  `main` runs passed dependency installation, compile, headless tests, and all
  public PowerShell parser checks. GitHub Release `v0.7.0` is public and its
  VSIX asset digest matches
  `3B20CFC5DA5A06AB456FBA56A47D6F8DEC6BE66CF26204D8D0440F48653654FE`.
- **2026-07-28 canonical Integrated Power identity**: Before the first
  marketplace publication, changed the extension identity to
  `integratedpower.integrated-power`, the artifact name to
  `integrated-power-0.7.1.vsix`, and added only correctly spelled discovery
  keywords. Runtime behavior was preserved. Headless 14/14, extension-host
  8/8, the 83-file public privacy scan, and 39-entry cross-build equality
  passed. Public VSIX SHA-256:
  `FC9255FEE24D0BAC45A9F29FD35A7AF2CAB24F5046C08BA502CAF63D3D470339`.
  Public commit `69af20a` was merged through PR #2 at
  `f9ab76943258c70cc4e5593ea827d35d6497bce5`; post-merge CI passed.
  GitHub Release `v0.7.1` contains the verified
  `integrated-power-0.7.1.vsix`, and GitHub's asset digest matches the local
  SHA-256. The required
  `save-agent-worklog` command is not installed on this Windows host; the
  central worklog line was appended but automatic sync could not run.
- **2026-07-28 Open VSX CLI separated from VSIX builds**: Installed official
  Node.js LTS 24.18.0, npm 11.16.0, and global `ovsx` 1.0.2. Confirmed the
  command resolves from `%APPDATA%\npm` in a fresh registry-derived PATH.
  Removed the mistakenly added project-local `ovsx` dependency and unpublished
  GitHub Actions draft so the extension build and marketplace publication
  remain separate processes. The existing public candidate is
  `EggR.integrated-power` 0.7.2 with SHA-256
  `052F392F6EB50F6265CC88B96F62727A18E492D14C1F10024EF875FDF43879D6`.
  Open VSX still returned 404 for the `EggR` namespace and no stored PAT was
  available before opening a secure interactive token prompt.
