# Aider Auto Capability Fallback - 2026-07-05

## Purpose

`WorkerBackend=Auto` can now recommend Aider, but recommendations must account for the actual machine. This update makes Auto routing fall back to the existing AgenticLoop backend when Aider cannot be executed.

## Changed

- `scripts/dispatch/Invoke-DelegatedAgentTask.ps1`
  - Adds `Test-AiderWorkerAvailable`.
  - Checks explicit `-AiderExecutable` when supplied.
  - Otherwise checks `aider`, then `uvx`.
  - If `-WorkerBackend Auto` resolves to Aider but Aider/uvx is unavailable, execution falls back to `AgenticLoop`.
  - Explicit `-WorkerBackend Aider` still surfaces failures instead of silently falling back.
  - Decision log now records `AiderAvailable`.

- `tests/run-aider-worker-adapter-e2e.ps1`
  - Adds an Auto fallback dry-run case with a missing fake Aider executable.
  - Verifies `Auto -> AgenticLoop` fallback.
  - Verifies decision log records `AiderAvailable=False`.

## Policy

```text
WorkerBackend Aider
  -> force Aider; fail loudly if unavailable

WorkerBackend Auto
  -> use selector recommendation
  -> if recommendation is Aider and capability check fails, fall back to AgenticLoop

WorkerBackend AgenticLoop
  -> preserve existing safe editor behavior
```

## Verification

Commands run:

```powershell
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-DelegatedAgentTask.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\tests\run-aider-worker-adapter-e2e.ps1 -Raw -Encoding UTF8))
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-aider-worker-adapter-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-validator-selector-e2e.ps1
npm run compile
uvx --from aider-chat aider --version
```

Results:

- Aider fallback parser sweep OK.
- Aider adapter E2E passed.
- Auto fallback dry-run passed.
- Existing delegated AgenticLoop E2E passed.
- Validator selector E2E passed.
- VS Code extension compile passed.
- Aider version: `0.86.2`.

## Remaining work

- Run a real Aider local-model edit against a disposable fixture.
- Capture Aider capability details in a dedicated environment report, not only per-run decision logs.
