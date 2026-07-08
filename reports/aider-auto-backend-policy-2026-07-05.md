# Aider Auto Backend Policy - 2026-07-05

## Purpose

Aider was imported as an optional worker backend. This update lets the delegation policy recommend Aider automatically while preserving the previous AgenticLoop backend as the default unless callers opt into `-WorkerBackend Auto`.

## Changed

- `scripts/dispatch/Select-AgenticDelegationMode.ps1`
  - Adds `WorkerBackend.Recommended`.
  - Adds `WorkerBackend.Reason`.
  - Recommends `Aider` for coding file-write tasks when:
    - more than one file is involved,
    - estimated change size is medium or large,
    - the task is high risk,
    - or cloud token conservation is requested for a coding edit.
  - Keeps `AgenticLoop` as the fallback safe editor backend.

- `scripts/dispatch/Invoke-DelegatedAgentTask.ps1`
  - `-WorkerBackend` now accepts `Auto`.
  - In Auto mode, uses `Select-AgenticDelegationMode.ps1`'s backend recommendation.
  - Records both `RequestedWorkerBackend` and resolved `WorkerBackend` in the decision log.
  - Keeps the default `-WorkerBackend AgenticLoop` to avoid surprising existing callers.

- `tests/run-aider-worker-adapter-e2e.ps1`
  - Verifies explicit `-WorkerBackend Aider`.
  - Verifies `-WorkerBackend Auto` resolves to Aider for a medium coding edit.
  - Verifies decision log records `Auto -> AiderWorker`.

## Policy shape

Default legacy-safe behavior:

```powershell
Invoke-DelegatedAgentTask.ps1 ... -WorkerBackend AgenticLoop
```

Use selector-guided backend routing:

```powershell
Invoke-DelegatedAgentTask.ps1 ... -WorkerBackend Auto
```

Force mature repo-aware coding backend:

```powershell
Invoke-DelegatedAgentTask.ps1 ... -WorkerBackend Aider
```

## Verification

Commands run:

```powershell
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Select-AgenticDelegationMode.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-DelegatedAgentTask.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\tests\run-aider-worker-adapter-e2e.ps1 -Raw -Encoding UTF8))
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-aider-worker-adapter-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-validator-selector-e2e.ps1
npm run compile
uvx --from aider-chat aider --version
```

Results:

- parser sweep OK.
- Aider adapter E2E passed.
- Existing delegated AgenticLoop E2E passed.
- Validator selector E2E passed.
- VS Code extension compile passed.
- Aider version: `0.86.2`.

## Remaining work

- Run one real low-risk Aider local-model task against a disposable test file.
- Add a capability check so Auto can fall back to AgenticLoop if Aider/uvx is unavailable.
- Consider making Auto the default only after several real local-model runs pass.
