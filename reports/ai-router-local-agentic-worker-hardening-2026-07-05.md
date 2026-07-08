# AI Router Local Agentic Worker Hardening - 2026-07-05

## Trigger

An Antigravity `/ai-router` run still chose raw `Invoke-LocalLLM.ps1` for a local LLM request, and a later delegated worker attempt failed when a destructive multi-file task was sent directly to Aider.

Observed artifacts:

- `reports/aider-worker-runs/20260705-085002-516/aider-prompt.md`
- `reports/aider-worker-runs/20260705-085002-516/aider-output.log`

## Root Causes

1. The active `codex-orchestrator` skill still described raw Local LLM Mode as the default local route.
2. The skill did not distinguish local preprocessing from repository file-writing work.
3. `Invoke-DelegatedAgentTask.ps1` only accepted inline `-Prompt` and `-Files`, which is fragile across Antigravity/PowerShell boundaries.
4. Destructive tasks such as delete/move/rename could be routed directly to Aider, where local model edit-format failures are likely.

## Changes

- Added Local Agentic Worker Mode to the codex-orchestrator skill.
- Added `references/local-agentic-worker.md`.
- Updated routing docs so repository file writes use:

```powershell
scripts/dispatch/Invoke-DelegatedAgentTask.ps1 -WorkerBackend Auto
```

- Kept raw `Invoke-LocalLLM.ps1` for preprocessing, summaries, extraction, and non-file-writing reports only.
- Added `-PromptFile` and `-FilesListFile` to `Invoke-DelegatedAgentTask.ps1`.
- Added a conservative destructive-operation safety gate:

```text
ExecutionMode=ManualReviewRequired
```

- Added `-AllowDestructive` for explicitly approved narrowed destructive runs.
- Updated global `C:\Users\jsp0\.gemini\GEMINI.md` to prefer `PromptFile` and `FilesListFile`.
- Synchronized the active plugin copy under:

```text
C:\Users\jsp0\.gemini\config\plugins\codex-orchestrator-plugin
```

## Verification

Commands run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dispatch\Invoke-DelegatedAgentTask.ps1 -Prompt "Dry run parser check" -TargetFile .\tests\aider_worker_adapter_e2e\target.ps1 -Files .\tests\aider_worker_adapter_e2e\target.ps1 -RequiresFileWrite -WorkerBackend Auto -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-aider-worker-adapter-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-validator-selector-e2e.ps1
```

Observed results:

```text
PASS: aider worker adapter E2E
PASS: delegated agent task E2E
PASS: agentic validator selector E2E
```

VSIX compile gate:

```powershell
npm run compile
```

Observed result: command exited successfully.

## Next Recommended `/ai-router` Smoke

Use a small non-destructive one-file task and require `/ai-router` to call:

```powershell
Invoke-DelegatedAgentTask.ps1 -PromptFile <prompt.md> -FilesListFile <files.txt> -RequiresFileWrite -WorkerBackend Auto -ValidatorProfile auto -KeepArtifacts
```

Expected report fields:

```text
backend=<Aider|AgenticLoop|ManualReviewRequired>
model=<model if available>
files=<changed files>
validation=<passed|failed|skipped>
artifacts=<paths>
```
