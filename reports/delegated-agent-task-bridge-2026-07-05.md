# Delegated Agent Task Bridge - 2026-07-05

## Purpose

The delegation policy now has an execution bridge. This keeps Codex/Antigravity in the executive role while routing worker tasks through a recorded policy decision before any local model is allowed to affect files.

## Changed files

- `scripts/dispatch/Invoke-DelegatedAgentTask.ps1`
  - New bridge script.
  - Calls `Select-AgenticDelegationMode.ps1`.
  - Records every routing decision to `reports/delegation-decisions.csv`.
  - Adapts file-writing tasks to `Invoke-AgenticLoop.ps1` even when the policy recommends `LocalDirect` or `CodexDirect`.
  - Preserves the rule that local direct generation must not write files directly.

- `scripts/dispatch/Invoke-AutonomousAgent.ps1`
  - Execution loop now calls `Invoke-DelegatedAgentTask.ps1` instead of calling `Invoke-AgenticLoop.ps1` directly.
  - Added `-EstimatedChangedLinesPerTask`, `-PreferCloudTokenConservation`, `-HighRisk`, and `-KeepArtifacts` parameters.

- `tests/run-delegated-agent-task-e2e.ps1`
  - New mock E2E test for the bridge.
  - Verifies that small cloud-token-conserving file writes are recommended as `LocalDirect` but executed as `AgenticLoop`.
  - Verifies that high-risk large file writes pass `CandidateCount=2` and `EnableBreaker=True` to the safe editor.

## Safety invariant

Local LLMs can generate candidates, but file writes go through the harness:

```text
Select-AgenticDelegationMode
  -> Invoke-DelegatedAgentTask
  -> Invoke-AgenticLoop
  -> schema/apply/syntax gates
```

This protects against the previous failure mode where "save cloud tokens" could accidentally mean "let a local model edit files without the gate."

## Verification

Commands run:

```powershell
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-DelegatedAgentTask.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-AutonomousAgent.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\tests\run-delegated-agent-task-e2e.ps1 -Raw -Encoding UTF8))
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-cost-policy-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dispatch\Invoke-DelegatedAgentTask.ps1 -Prompt "Dry run decision" -TargetFile .\scripts\dispatch\Invoke-AgenticLoop.ps1 -Files .\scripts\dispatch\Invoke-AgenticLoop.ps1 -EstimatedChangedLines 20 -PreferCloudTokenConservation -DryRun
```

Results:

- delegation bridge parser sweep OK.
- delegated agent task E2E passed.
- `Invoke-AgenticLoop.ps1` restored and parser OK after mock test.
- cost-policy E2E still passed after bridge integration.
- dry-run wrote `reports/delegation-decisions.csv`.

## Remaining work

- Run one real low-risk delegated task through `Invoke-DelegatedAgentTask.ps1` with the local model after the user confirms the current untracked worktree state is acceptable.
- Add project-specific validator profiles so the bridge can request tests, not only syntax gates.
- Clean `Invoke-AgenticLoop.ps1` logging so dry-run temp application is not described as a real patch application.
