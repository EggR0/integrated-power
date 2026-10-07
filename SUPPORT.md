# Support

## Supported environment

The first public release of Integrated Power targets Antigravity IDE on
Windows 11. The canonical extension identity is `EggR.integrated-power`.

As of 2026-09-19, the repository source manifest is `0.9.1`, while the latest
verified public GitHub VSIX is `v0.7.4`. The visible Open VSX listing is the
legacy `integratedpower.integrated-power` `0.7.1` identity and is not a
canonical installation path until its publisher and extension ID are aligned.

Linux, macOS, Visual Studio Code, Cursor, the separate Antigravity application
and modified third-party IDE builds are outside the initial support scope.

## Before requesting help

1. Confirm that the installed product is **Integrated Power** from Publisher
   **EggR**, with extension ID **`EggR.integrated-power`**.
2. Run `Developer: Reload Window` in Antigravity IDE.
3. Open the Integrated Power Dashboard from the activity bar, then run
   `Integrated Power: Open Configuration Center` and review the three
   independent status sections.
4. Verify that optional tools needed by the selected feature are installed.
5. Reproduce the issue without modifying `GEMINI.md` or moving a Knowledge
   repository.

## Information to provide

- Integrated Power version
- Antigravity IDE version
- Windows edition, version and architecture
- the affected section: Dashboard, Integrated Orchestrator or Private Git
  Knowledge
- exact steps, expected result and actual result
- relevant extension-host errors after redaction

Do not attach credentials, access or refresh tokens, API keys, private keys,
full user prompts, personal Knowledge content, private Git URLs or unredacted
absolute paths.

General bugs and feature requests may use the repository issue templates.
Commercial licensing requests must use the process in
[COMMERCIAL-LICENSING.md](COMMERCIAL-LICENSING.md). Suspected vulnerabilities
must use the private process in [SECURITY.md](SECURITY.md), never a public issue.

## Dependency support

The Dashboard and Configuration Center are supplied by the VSIX itself; the
separate Tauri Control Center is not required to open either view. Integrated
Power diagnoses but does not automatically install Antigravity IDE,
Git, Codex CLI, Agy, Ollama, vLLM, GPU drivers or models. Installation,
authentication and service failures inside those products remain under their
respective support channels.

The separate `integrated-power-control-center` repository has its own package
and support scope. No public GitHub binary release for that Control Center was
verified on 2026-09-19, so it must not be described as part of the VSIX
installation.

Agy users can inspect their own usage through the official TUI `/usage`
command. On Windows, Integrated Power also reads the signed-in user's local Agy
credential through a local process and queries the usage API for the Dashboard.
Actual access-token and refresh-token values are not stored in Integrated Power
settings or logs.

If Agy usage is unavailable, confirm that Agy is installed, the user is signed
in and `/usage` works in the Agy TUI before collecting a redacted Integrated
Power extension-host log.
