# Support

## Supported environment

The first public release of Integrated Power targets Antigravity IDE on
Windows 11. Open VSX is the distribution channel, not a declaration of support
for every editor that can install an Open VSX package.

Linux, macOS, Visual Studio Code, Cursor, the separate Antigravity application
and modified third-party IDE builds are outside the initial support scope.

## Before requesting help

1. Confirm that the installed product is **Integrated Power** from Publisher
   **Integrated Power**.
2. Run `Developer: Reload Window` in Antigravity IDE.
3. Open `Integrated Power: Open Configuration Center` and review the three
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

Integrated Power diagnoses but does not automatically install Antigravity IDE,
Git, Codex CLI, Agy, Ollama, vLLM, GPU drivers or models. Installation,
authentication and service failures inside those products remain under their
respective support channels.

Agy users can inspect their own usage through the official TUI `/usage`
command. On Windows, Integrated Power also reads the signed-in user's local Agy
credential through a local process and queries the usage API for the Dashboard.
Actual access-token and refresh-token values are not stored in Integrated Power
settings or logs.

If Agy usage is unavailable, confirm that Agy is installed, the user is signed
in and `/usage` works in the Agy TUI before collecting a redacted Integrated
Power extension-host log.
