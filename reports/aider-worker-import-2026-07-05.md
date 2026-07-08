# Aider Worker Import - 2026-07-05

## Purpose

The local worker runtime should not be a from-scratch coding agent if a mature coding-agent project can do the editing work better.

This update imports Aider as an optional worker backend while preserving the current Antigravity/Codex executive boundary:

```text
Codex / Antigravity
  -> delegation policy
  -> Aider worker backend
  -> wrapper backup + validation
  -> reports / decision log
```

## Why Aider

Relevant upstream behavior from official Aider docs:

- Aider is an AI pair-programming tool for editing code in a terminal/git repo.
- Aider supports one-shot scripted execution through `--message-file`.
- Aider supports local Ollama models with `--model ollama_chat/<model>`, and Aider recommends `ollama_chat/` over `ollama/`.
- Aider has first-class git settings including disabling auto commits.
- Aider has dry-run, lint, and test command options.

Sources:

- https://github.com/Aider-AI/aider
- https://aider.chat/docs/llms/ollama.html
- https://aider.chat/docs/config/options.html

## Added

- `scripts/dispatch/Invoke-AiderWorker.ps1`
  - Runs `aider` if installed, otherwise falls back to `uvx --from aider-chat aider`.
  - Defaults local models to `ollama_chat/<model>`.
  - Writes the task prompt to an artifact file and invokes Aider with `--message-file`.
  - Disables Aider auto commits.
  - Adds explicit operational constraints to edit only passed files.
  - Backs up all allowed files before Aider runs.
  - Runs optional validation command after Aider edits.
  - Restores backed-up files if Aider fails or validation fails.
  - Emits JSON with model, files, logs, prompt path, and artifact directory.

- `scripts/dispatch/Invoke-DelegatedAgentTask.ps1`
  - Added `-WorkerBackend AgenticLoop|Aider`.
  - Added `-AiderModel`.
  - Added `-AiderExecutable` for testing or custom installations.
  - Records `WorkerBackend` in the delegation decision log.
  - Routes file-writing work to `AiderWorker` when requested.

- `tests/run-aider-worker-adapter-e2e.ps1`
  - Uses a fake Aider executable.
  - Verifies direct wrapper execution.
  - Verifies bridge execution through `Invoke-DelegatedAgentTask.ps1`.
  - Verifies decision log records `ExecutionMode=AiderWorker` and `WorkerBackend=Aider`.

## Verified commands

```powershell
uvx --from aider-chat aider --help
uvx --from aider-chat aider --version
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-aider-worker-adapter-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-validator-selector-e2e.ps1
npm run compile
```

Results:

- Aider resolved through `uvx`.
- Aider version: `0.86.2`.
- Aider adapter E2E passed.
- Delegated agent task E2E passed.
- Validator selector E2E passed.
- VS Code extension compile passed.

## Current limitation

This is an adapter import, not a full replacement of the PowerShell runtime.

That is deliberate:

- Aider is better suited for coding edits and repo-aware patching.
- The local PowerShell layer still owns policy, validation, logging, artifact routing, rollback, and Antigravity/Codex integration.

The next step is to decide when `Select-AgenticDelegationMode.ps1` should recommend `WorkerBackend=Aider` by default instead of requiring the caller to opt in.
