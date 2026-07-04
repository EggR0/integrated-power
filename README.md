# Integrated POWER

This workspace manages quota-aware AI coding workflows across Antigravity IDE, Codex, MCP servers, and local GPU preprocessing.

Primary interface: **Antigravity IDE**.

Provider quotas are not pooled. Antigravity IDE is the single control surface, while Codex, Gemini, Claude, and local LLMs remain separate backend workers with separate usage tracking.

## Start Here

1. Open `docs/setup/antigravity-ide-setup.md` and finish the Antigravity IDE UI steps.
2. Read `docs/architecture/current-workspace-analysis.md` to understand the current control-plane shape.
3. Read `docs/architecture/integrated-toolchain-plan.md` for the recommended multi-tool workflow.
4. Fill in `ai-work-queue.md` with the current weekly quota, reset time, and ready jobs.
5. Use `prompts/dispatch/antigravity-dispatch.md` inside Antigravity IDE to pick the next job.
6. Use `scripts/dispatch/Invoke-AiWorkWindow.ps1` to prepare a context-rich dispatch prompt.
7. Use `scripts/dispatch/Invoke-CodexJob.ps1` for local Codex CLI jobs.
8. Use `scripts/dispatch/Invoke-vLLMJob.ps1` for local OpenAI-compatible vLLM preprocessing jobs.
9. Use `scripts/schedule/Register-CodexScheduledJob.ps1` only after you know the schedule and prompt file you want to run.
10. Check `docs/setup/google-calendar-setup.md` to link AI jobs with Google Calendar.
11. Check `docs/reference/token-measurement.md` for exact Codex JSONL usage and safer token accounting.

## Files

| Path | Purpose |
| --- | --- |
| `ai-work-queue.md` | Shared quota-aware task queue |
| `docs/architecture/current-workspace-analysis.md` | Analysis of the current workspace and gaps |
| `docs/architecture/integrated-toolchain-plan.md` | Organic workflow connecting 3+ tools and LLMs |
| `docs/setup/user-action-checklist.md` | UI and credential steps the user must complete |
| `docs/reference/token-measurement.md` | Token measurement strategy and commands |
| `docs/operations/weekly-quota-operations.md` | Weekly planning model |
| `docs/setup/antigravity-ide-setup.md` | Antigravity IDE setup checklist |
| `docs/setup/google-calendar-setup.md` | Google Calendar integration setup guide |
| `.agents/skills/ai-workflow-orchestrator/SKILL.md` | Antigravity project skill |
| `.codex/agents/` | Project-scoped Codex subagent definitions |
| `config/toolchain.registry.json` | Tool roles and routing registry |
| `prompts/` | Reusable dispatch and Codex job prompts |
| `scripts/dispatch/Invoke-AiWorkWindow.ps1` | Prepares a context-rich work-window dispatch prompt |
| `scripts/dispatch/Invoke-CodexJob.ps1` | Runs a prompt through Codex non-interactively |
| `scripts/dispatch/Invoke-vLLMJob.ps1` | Runs a prompt through a local OpenAI-compatible vLLM endpoint |
| `scripts/metrics/Parse-CodexUsage.ps1` | Parses exact Codex JSONL usage into CSV |
| `scripts/metrics/Count-OpenAIInputTokens.ps1` | Counts exact API input tokens when `OPENAI_API_KEY` is set |
| `scripts/metrics/Count-GeminiInputTokens.ps1` | Counts exact Gemini API input tokens when `GEMINI_API_KEY` is set |
| `scripts/metrics/Parse-GeminiUsage.ps1` | Parses Gemini `usageMetadata`, Interactions `usage`, or Gemini CLI `stats` |
| `scripts/metrics/Measure-AntigravityTranscript.ps1` | Estimates Antigravity IDE transcript token size from local logs |
| `scripts/metrics/Invoke-AntigravityUsageTool.ps1` | Optional third-party Antigravity quota snapshot wrapper |
| `scripts/metrics/Track-Tokens.ps1` | Logs offline heuristic token estimates |
| `scripts/schedule/Register-CodexScheduledJob.ps1` | Creates a Windows scheduled Codex job |

## Basic Dispatch Command

Prepare a work-window prompt without calling Codex:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dispatch\Invoke-AiWorkWindow.ps1
```

Send the prepared window to Codex in read-only mode:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dispatch\Invoke-AiWorkWindow.ps1 -RunCodex -Sandbox read-only
```

## Current Direct Config Change

The global Antigravity MCP config was updated here:

```text
C:\Users\jsp0\.gemini\config\mcp_config.json
```

A backup was created here:

```text
C:\Users\jsp0\.gemini\config\mcp_config.json.bak-codex-setup
```
<!-- TODO: INTERGRATED POWER 계획 점검하고 유지보수하기, 개선하기. -->
