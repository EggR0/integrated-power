# Current Workspace Analysis

Generated for the Integrated POWER workspace.

## Workspace Role

This folder is not an application repository yet. It is a control workspace for AI-assisted development operations:

- quota-aware AI work queue
- Antigravity IDE setup notes
- Codex CLI job runner
- Windows scheduled job templates
- Google Calendar time-block support
- active work and TODO extraction reports

## Current Files Of Interest

| Area | Files | Role |
| --- | --- | --- |
| Work queue | `ai-work-queue.md` | Tracks weekly quota windows and candidate jobs |
| Codex runner | `scripts/dispatch/Invoke-CodexJob.ps1` | Runs non-interactive Codex jobs |
| Scheduler | `scripts/schedule/Register-CodexScheduledJob.ps1` | Registers daily Windows scheduled Codex jobs |
| Calendar | `scripts/schedule/Sync-Calendar.ps1`, `scripts/schedule/Create-TimeBlocks.ps1` | Reads or creates AI work windows through Google Calendar |
| Context scan | `scripts/scan/Detect-ActiveWork.ps1` | Produces `reports/current_context.md` |
| TODO scan | `scripts/scan/Extract-Todos.ps1` | Produces `reports/current_todos.md` |
| Token estimate | `scripts/metrics/Track-Tokens.ps1` | Estimates text size and records `reports/token_usage.csv` |
| Antigravity setup | `docs/setup/antigravity-ide-setup.md` | Manual IDE configuration steps |
| MCP config example | `config/antigravity-mcp_config.example.json` | Codex, Context7, Playwright MCP example |

## Observed State

- The repository has uncommitted local changes and untracked files.
- Some generated report text and comments appear mojibake-encoded. Treat those as current user/workspace state and do not rewrite them unless asked.
- The active design already has a useful pipeline shape:

```text
Calendar window -> active repo scan -> TODO scan -> token estimate -> queued job -> Codex or Antigravity IDE
```

## Main Gap

The current workspace has pieces, but it needs a clear routing rule for when to use each tool:

- Antigravity IDE for interactive edit and approval.
- Codex MCP or Codex CLI for deep reasoning and bounded jobs.
- Codex subagents for parallel read-heavy review.
- Context7 for current API documentation.
- Playwright for browser/UI verification.
- GitHub MCP for issues, PRs, Actions, and review context.
- Local 3090 4-way LLM for broad preprocessing and summarization.

## Recommended Next Shape

Use this workspace as a lightweight control plane. Keep the actual source repositories in `config/projects.txt`, generate context reports from them, and let each quota window select one bounded job from `ai-work-queue.md`.

