# Aider Real Local Smoke - 2026-07-05

## Result

The Aider worker path now passes a real local-model smoke test.

Verified command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-aider-worker-real-local-smoke.ps1 -Model qwen2.5-coder:32b -TimeoutSeconds 600
```

Observed result:

```text
PASS: aider worker real local smoke
```

## What Was Tested

- Aider executable resolution through `uvx --from aider-chat aider`.
- Aider version `0.86.2`.
- Ollama model `qwen2.5-coder:32b`.
- `Invoke-AiderWorker.ps1` prompt artifact generation.
- Aider one-shot edit through `--message-file`.
- Local file modification of a disposable PowerShell target.
- Post-edit validation command.
- Wrapper-level output artifact capture.

## Fixes Confirmed

- Windows console encoding hardening is active in `Invoke-AiderWorker.ps1`:
  - `PYTHONIOENCODING=utf-8`
  - `PYTHONUTF8=1`
  - `NO_COLOR=1`
  - `TERM=dumb`
- Aider edit-format failure detection remains guarded:
  - non-conforming edit format output
  - failed search/replace block output
  - reflection-limit stop output
- Failed Aider or validation runs restore backed-up files.

## Regression Checks

Commands run after the real smoke:

```powershell
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

VS Code extension compile gate:

```powershell
npm run compile
```

Observed result:

```text
tsc -p ./
```

The command exited successfully.

## Current Architectural Meaning

This confirms the preferred direction:

```text
Antigravity / Codex executive layer
  -> Invoke-DelegatedAgentTask.ps1
  -> WorkerBackend=Auto
  -> Aider worker when available and recommended
  -> local Ollama coding model
  -> wrapper validation and rollback
```

The hand-rolled `Invoke-AgenticLoop.ps1` remains useful as a fallback and controlled harness, but Aider is now the better default candidate for real repo-aware coding edits.

## Remaining Risks

- `WorkerBackend` still defaults to `AgenticLoop` for compatibility; callers must opt into `Auto` before Aider becomes active automatically.
- The smoke target is intentionally tiny. Multi-file real-repo edits through Aider still need broader validation.
- Model quality remains model-dependent. `qwen2.5-coder:32b` passed the smoke, but larger or messier edits should still use validation commands and rollback boundaries.
- Aider is invoked as an external CLI, so environment issues such as Python packaging, console encoding, and Ollama availability must stay visible in reports.
