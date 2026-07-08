# Agentic Validation Command Gate - 2026-07-05

## Purpose

The agentic loop previously enforced output schema, exact apply, and syntax validation. This update adds a command-level validation gate so Codex/Antigravity can require project-specific checks before accepting a local LLM patch.

This is the next safety layer for using local LLMs as workers: a patch can now be syntactically valid and still be rejected if the configured command fails.

## Changed files

- `scripts/dispatch/Invoke-AgenticLoop.ps1`
  - Added `-ValidatorProfile` with `syntax`, `syntax_and_command`, `command_only`, and `none`.
  - Added `-ValidationCommand`.
  - Added `-ValidationTimeoutSeconds`.
  - Runs the validation command after applying a patch.
  - If the command fails or times out, restores the original target file before retrying.
  - Injects validation failure output into the next retry prompt.

- `scripts/dispatch/Invoke-DelegatedAgentTask.ps1`
  - Passes validator settings into `Invoke-AgenticLoop.ps1`.
  - Records validator settings in the delegation decision log.

- `scripts/dispatch/Invoke-AutonomousAgent.ps1`
  - Exposes validator settings at the autonomous loop boundary.

- `tests/run-agentic-loop-validation-command-e2e.ps1`
  - New E2E test.
  - Mock local LLM returns a bad patch first and a good patch second.
  - Validation command rejects the bad patch.
  - Test verifies the bad patch is restored before retry and the second attempt succeeds.

- `tests/run-agentic-loop-cost-policy-e2e.ps1`
- `tests/run-delegated-agent-task-e2e.ps1`
- `tests/run-agentic-loop-validation-command-e2e.ps1`
  - Added a shared atomic file lock for tests that temporarily mock dispatcher scripts.
  - This prevents parallel E2E runs from corrupting each other's mocked script state.

## Safety behavior

```text
Local LLM output
  -> schema gate
  -> temp apply gate
  -> syntax gate
  -> real apply
  -> validation command gate
  -> accept | restore and retry
```

The validation command gate only runs after real apply because many project tests need the actual file tree. On failure, the harness restores the original target file before giving feedback to the next worker attempt.

## Verification

Commands run:

```powershell
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-AgenticLoop.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-DelegatedAgentTask.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-AutonomousAgent.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\tests\run-agentic-loop-validation-command-e2e.ps1 -Raw -Encoding UTF8))
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-validation-command-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-cost-policy-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
```

Results:

- validation command parser sweep OK.
- validation command E2E passed.
- cost policy E2E passed.
- delegated agent task E2E passed.
- The three mock E2E tests also passed when launched in parallel after adding the atomic lock.

## Note

These tests intentionally mock dispatcher scripts in-place, then restore them in `finally`. They now use a shared file lock and should not corrupt each other during parallel runs.
