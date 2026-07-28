# Agent Execution Modes

This project uses three Codex delegation modes. Pick the smallest mode that matches the work.

## Debate

Use for architecture review, tradeoff discussion, second opinions, and read-only critique.

- Script: `scripts/dispatch/Invoke-CodexDebate.ps1`
- Output: EggR workspace state `discussions/` and `sessions/`
- Does not directly implement code unless a later step explicitly asks for implementation.

## Job

Use for bounded implementation, test generation, focused refactors, or direct file edits.

- Script: `scripts/dispatch/Invoke-CodexJob.ps1`
- Output: EggR workspace state `reports/codex-<stamp>.md` unless `-OutputFile` is provided
- Best when the task has a clear file boundary and success condition.

## Work Window

Use for longer supervised work that aggregates queue, context, calendar, or multiple tasks.

- Script: `scripts/dispatch/Invoke-AiWorkWindow.ps1`
- Output: EggR workspace state `reports/`
- Best when the agent should choose from pending work or coordinate several related steps.

## Naming Rule

`discussion` is the durable transcript produced by Debate mode. It is not a separate execution mode.

`runs.jsonl` is the shared event log for delegated work. The Antigravity IDE dashboard's Open Runs command opens the workspace-specific EggR state `.agent-runs/runs.jsonl`.
