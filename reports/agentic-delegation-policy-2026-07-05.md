# Agentic Delegation Policy Update - 2026-07-05

## Why this change exists

The previous framing treated local model work as if it had a token cost. That is the wrong operating model.

For local LLMs, the relevant costs are:

- elapsed time
- electricity
- GPU VRAM occupancy
- context overflow that forces a weaker model, smaller context, or failed run

The token budget to conserve is the cloud/executive budget: Codex, Gemini/Antigravity, and other cloud model quota.

## Changed files

- `scripts/dispatch/Invoke-AgenticLoop.ps1`
  - Default candidate generation is now `CandidateCount=1`.
  - Judge is invoked only when `CandidateCount > 1`.
  - Breaker is now opt-in via `-EnableBreaker`.
  - Schema, apply, and syntax gates remain active by default.
  - Local worker metrics now receive `SelectedBy` and `SelectionReason`.

- `scripts/dispatch/Select-AgenticDelegationMode.ps1`
  - New dispatcher policy script.
  - Chooses between `CodexDirect`, `LocalDirect`, `AgenticLoop`, and `AntigravityHigh`.
  - Explicitly reports `LocalTokenCost = None`.
  - Scores local risk through elapsed-time/electricity/VRAM/context-downshift risk.

- `tests/run-agentic-loop-cost-policy-e2e.ps1`
  - New mock-based E2E test.
  - Temporarily mocks `Invoke-LocalLLM.ps1`, verifies behavior, then restores the original script in `finally`.

## Policy summary

Use direct Codex edits for small, precise patches where orchestration overhead is higher than the work.

Use `Invoke-LocalLLM.ps1` for local candidate generation or artifact drafting when the local model should not write files directly.

Use `Invoke-AgenticLoop.ps1` for file-writing work that needs schema/apply/syntax gates, retry artifacts, or context request handling.

Use `Invoke-AntigravityCliJob.ps1` with `Gemini 3.1 Pro (High)` for independent audit, planning, or larger delegated implementation where spending Antigravity quota is acceptable to conserve Codex/Gemini interaction.

## Verification

Commands run:

```powershell
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-AgenticLoop.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Select-AgenticDelegationMode.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\tests\run-agentic-loop-cost-policy-e2e.ps1 -Raw -Encoding UTF8))
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-cost-policy-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dispatch\Select-AgenticDelegationMode.ps1 -TaskKind coding -Files ".\scripts\dispatch\Invoke-AgenticLoop.ps1,.\scripts\dispatch\Select-LocalLLMModel.ps1" -EstimatedChangedLines 180 -RequiresFileWrite -HighRisk -PreferCloudTokenConservation -AsJson
```

Results:

- `Invoke-AgenticLoop.ps1` parser OK.
- `Select-AgenticDelegationMode.ps1` parser OK.
- policy E2E parser OK.
- policy E2E passed.
- `Invoke-LocalLLM.ps1` was restored and parser OK after the mock test.

## Remaining rough edge

`Invoke-AgenticLoop.ps1` prints `Successfully applied patch.` during both dry-run temp application and final application. This is not a correctness failure, but the log wording should be cleaned later to avoid confusing dry-run with real write.
