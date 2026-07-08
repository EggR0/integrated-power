# Agentic Loop Fallback Policy - 2026-07-05

## Decision

The hand-rolled `Invoke-AgenticLoop.ps1` is no longer treated as the primary local coding loop.

Primary local file-writing path:

```text
Invoke-DelegatedAgentTask.ps1
  -> WorkerBackend Auto
  -> AiderWorker when available and appropriate
  -> validation / rollback / artifacts
```

`Invoke-AgenticLoop.ps1` remains only as a constrained fallback safe editor for small, explicit, validation-bounded tasks.

## Why

The hand-rolled loop is useful as a controlled harness, but it is too brittle to be the main agentic coding engine:

- local models can emit malformed patch/search-replace formats
- large or multi-file tasks can exceed reliable context/edit boundaries
- destructive tasks need human or higher-level review
- Aider already provides a mature repo-aware coding loop

## New Guardrail

When `WorkerBackend Auto` recommends Aider but Aider/uvx is unavailable:

- small safe tasks may fall back to `AgenticLoop`
- medium, multi-file, high-risk, or local-resource-risky file edits return:

```text
ExecutionMode=ManualReviewRequired
```

To force the old fallback intentionally, the caller must pass:

```powershell
-AllowAgenticLoopFallback
```

This prevents `/ai-router` from silently routing difficult local coding work into the weaker hand-rolled loop.

## Verification

Commands run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-aider-worker-adapter-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-validator-selector-e2e.ps1
npm run compile
```

Observed:

```text
PASS: aider worker adapter E2E
PASS: delegated agent task E2E
PASS: agentic validator selector E2E
VSIX TypeScript compile succeeded
```
