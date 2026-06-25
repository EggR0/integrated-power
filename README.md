# Integrated POWER

This workspace manages quota-aware AI coding workflows across Antigravity IDE, Codex, MCP servers, and local GPU preprocessing.

## Start Here

1. Open `docs/antigravity-ide-setup.md` and finish the Antigravity IDE UI steps.
2. Fill in `ai-work-queue.md` with the current weekly quota, reset time, and ready jobs.
3. Use `prompts/antigravity-dispatch.md` inside Antigravity IDE to pick the next job.
4. Use `scripts/Invoke-CodexJob.ps1` for local Codex CLI jobs.
5. Use `scripts/Register-CodexScheduledJob.ps1` only after you know the schedule and prompt file you want to run.
6. Check `docs/google-calendar-setup.md` to link AI jobs with Google Calendar.

## Files

| Path | Purpose |
| --- | --- |
| `ai-work-queue.md` | Shared quota-aware task queue |
| `docs/weekly-quota-operations.md` | Weekly planning model |
| `docs/antigravity-ide-setup.md` | Antigravity IDE setup checklist |
| `docs/google-calendar-setup.md` | Google Calendar integration setup guide |
| `.agents/skills/ai-workflow-orchestrator/SKILL.md` | Antigravity project skill |
| `prompts/` | Reusable dispatch and Codex job prompts |
| `scripts/Invoke-CodexJob.ps1` | Runs a prompt through Codex non-interactively |
| `scripts/Register-CodexScheduledJob.ps1` | Creates a Windows scheduled Codex job |

## Current Direct Config Change

The global Antigravity MCP config was updated here:

```text
C:\Users\jsp0\.gemini\config\mcp_config.json
```

A backup was created here:

```text
C:\Users\jsp0\.gemini\config\mcp_config.json.bak-codex-setup
```

