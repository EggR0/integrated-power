# Agentic Loop Validator Hardening Summary

## Scope

Continued implementation of the local LLM agentic runtime by delegating code generation to local LLM runs and validation artifact generation to AGY.

Changed areas:

- `scripts/dispatch/Invoke-AgenticLoop.ps1`
- `tests/agentic_loop_validation/sample.json`
- `tests/agentic_loop_validation/korean.txt`

## Delegated Work

### Local LLM coding agent

Used `Invoke-AgenticLoop.ps1` with auto-selected `gpt-oss:20b` for implementation patches.

Implemented:

- Language-aware syntax validation:
  - `.ps1`, `.psm1`, `.psd1`: PowerShell parser via `[scriptblock]::Create`.
  - `.json`: `ConvertFrom-Json`.
  - Other extensions: syntax validation bypass, while SEARCH matching still applies.
- UTF-8 file reads in validation and patch application.
- `-LiteralPath` usage for target reads/writes.
- Temp validation file extension preservation based on the original `TargetFile`.
- Collision-resistant default artifact run directories using `yyyyMMdd-HHmmss-fff-<short-guid>`.

### AGY

Used `Invoke-AntigravityCliJob.ps1` to generate:

- `reports/agy-validator-test-artifact-2026-07-04.md`

AGY identified the temp validation extension bug, which was then fixed by a local LLM coding run.

## Verification

Parser checks:

- `Invoke-AgenticLoop.ps1`: passed PowerShell parser.
- `Select-LocalLLMModel.ps1`: passed PowerShell parser.

E2E local LLM runs:

- JSON target: `tests/agentic_loop_validation/sample.json`
  - Final value: `"status": "parallel-json"`
  - Verified with `ConvertFrom-Json`.
- UTF-8 Korean text target: `tests/agentic_loop_validation/korean.txt`
  - Final line: `상태: 병렬 이후`
  - Verified with `Get-Content -Encoding UTF8`.

Artifact collision test:

- Two parallel `-KeepArtifacts` runs started in the same millisecond.
- They produced distinct artifact directories:
  - `reports/agentic-loop-runs/20260704-231520-866-46c4f62c`
  - `reports/agentic-loop-runs/20260704-231520-866-7834894b`

## Operational Notes

- Local LLM metrics show successful delegated coding runs with exact token counts.
- AGY run events were recorded under globalStorage `.agent-runs/runs.jsonl`, with quota delta recorded by the wrapper.
- The local loop is now closer to the intended workflow: local LLM generates patches, gates catch bad patches, artifacts remain available, and Codex performs final validation/merge judgment.
