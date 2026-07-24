# Integrated Power

Integrated Power is an Antigravity IDE centered workflow for coordinating AI-assisted software work across IDE review, Codex delegation, local LLM preprocessing, and lightweight usage reporting.

The core idea is simple: keep **Antigravity IDE as the main human-facing control surface**, then route each job to the smallest reliable backend.

## Main Workflow

1. Open this repository in Antigravity IDE.
2. Read `docs/setup/antigravity-ide-setup.md`.
3. Install or enable the optional dashboard extension from `vscode-extension/`.
4. Configure MCP servers from `config/antigravity-mcp_config.example.json`.
5. Use `prompts/dispatch/antigravity-dispatch.md` to classify the next job.
6. Route the job:
   - Main agent direct for small edits and simple checks.
   - Local LLM or vLLM for summarization, extraction, and low-risk preprocessing.
   - Codex debate for architecture review and tradeoffs.
   - Codex job for bounded implementation or difficult review.
7. Review reports and diffs inside Antigravity IDE before accepting changes.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `config/` | Public-safe routing policy and example tool registry |
| `docs/` | Setup and operating docs for Antigravity IDE first usage |
| `prompts/` | Reusable dispatch prompts |
| `scripts/dispatch/` | Work-window, Codex, local LLM, and vLLM wrappers |
| `scripts/metrics/` | Optional usage and token accounting helpers |
| `vscode-extension/` | Antigravity IDE dashboard extension source |
| `vscode-extension/assets/codex-orchestrator-plugin/` | Optional Antigravity plugin bundle source |

## What Is Intentionally Not Included

This public version excludes private operational logs, transcripts, packaged extension binaries, plugin backup archives, credentials, API keys, OAuth files, and machine-specific state.

Keep these files out of Git:

- `.env`
- `client_secret*.json`
- `token*.json`
- `credentials*.json`
- `reports/`
- `discussions/`
- `operational-data/`
- `*.vsix`
- `*.zip`

## Requirements

- Windows 11 or a compatible PowerShell environment
- Antigravity IDE
- Git
- Optional: Codex CLI
- Optional: Node.js/pnpm for Gemini CLI and the VS Code extension
- Optional: Ollama or an OpenAI-compatible local vLLM endpoint

## Safety Model

Integrated Power does not pool provider quotas or credentials. Each backend keeps its own authentication and quota. Scripts that use API keys read them from environment variables at runtime. Do not commit secrets, local transcripts, or generated reports.

## Build Dashboard Extension

```powershell
Set-Location .\vscode-extension
pnpm install
pnpm test
```

Package artifacts such as `.vsix` files should be published through releases, not committed to the repository.
