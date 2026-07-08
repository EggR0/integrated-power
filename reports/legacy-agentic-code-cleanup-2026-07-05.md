# Legacy Agentic Code Cleanup - 2026-07-05

## Removed

- `scripts/dispatch/Invoke-AutonomousAgent.ps1`
- `scripts/dispatch/Invoke-AntigravityCliJob.ps1`
- `run_task.ps1`
- `local_llm_debate_prompt.txt`

## Why

`Invoke-AutonomousAgent.ps1` was an older planner/executor loop. Its useful execution boundary has been replaced by:

```text
Invoke-DelegatedAgentTask.ps1
  -> WorkerBackend Auto
  -> AiderWorker or AgenticLoop
  -> validation / rollback / artifacts
```

`Invoke-AntigravityCliJob.ps1` existed only for the `AntigravityHigh` fallback branch. That branch duplicated the role now assigned to Codex-orchestrator policy and created another cloud-model execution path with weaker integration into the local worker bridge.

`run_task.ps1` and `local_llm_debate_prompt.txt` were one-off artifacts from the failed `/ai-router` experiment and were not reusable code.

## Code Changes

- Removed `AntigravityHigh` selection from `scripts/dispatch/Select-AgenticDelegationMode.ps1`.
- Removed `AntigravityHigh` execution from `scripts/dispatch/Invoke-DelegatedAgentTask.ps1`.
- Removed `AgyQuotaRemainingPercent` from selector output because the selector no longer routes to AGY-specific execution.

## Kept

- `Invoke-LocalLLM.ps1`: still needed for non-file-writing preprocessing, summaries, extraction, and LocalDirect artifacts.
- `Invoke-vLLMJob.ps1`: still needed for OpenAI-compatible local endpoint preprocessing.
- `Invoke-AgenticLoop.ps1`: still needed as fallback safe editor backend and for schema/apply/syntax-gated patch attempts.
- `Invoke-AiderWorker.ps1`: primary imported mature coding-agent backend.
- `Invoke-DelegatedAgentTask.ps1`: primary bridge for Antigravity `/ai-router` file-writing local worker tasks.

## Verification

Search over active execution paths found no remaining references to:

```text
Invoke-AutonomousAgent
Invoke-AntigravityCliJob
AntigravityHigh
AgyQuotaRemainingPercent
Local Autonomous Loop
```

Commands run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-aider-worker-adapter-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-validator-selector-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-cost-policy-e2e.ps1
npm run compile
```

Observed results:

```text
PASS: aider worker adapter E2E
PASS: delegated agent task E2E
PASS: agentic validator selector E2E
PASS: agentic loop cost policy E2E
VSIX TypeScript compile succeeded
```
