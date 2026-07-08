# AGY High Model Wrapper Summary

## Change

Updated `scripts/dispatch/Invoke-AntigravityCliJob.ps1` so AGY calls default to:

- `Gemini 3.1 Pro (High)`

The AGY CLI model list shows available high-tier options including:

- `Gemini 3.1 Pro (High)`
- `Claude Sonnet 4.6 (Thinking)`
- `Claude Opus 4.6 (Thinking)`

## Wrapper Fixes

- Added argument quoting so model names with spaces and parentheses are passed correctly.
- Preserved run event/quota tracking through `.agent-runs/runs.jsonl`.
- Added stdout capture fallback: if AGY completes but does not create the requested output file, the wrapper writes captured stdout to `OutputFile`.

## Verification

Direct CLI smoke:

```powershell
agy.exe --model "Gemini 3.1 Pro (High)" --print "Return exactly: AGY_HIGH_MODEL_OK"
```

Result:

```text
AGY_HIGH_MODEL_OK
```

Wrapper smoke:

```powershell
scripts/dispatch/Invoke-AntigravityCliJob.ps1 `
  -PromptFile reports/agy-high-model-smoke-prompt-2026-07-04.md `
  -OutputFile reports/agy-high-model-smoke-output-2026-07-04.md
```

Verified:

- Output file exists and contains `AGY_WRAPPER_HIGH_MODEL_OK`.
- Parser check for `Invoke-AntigravityCliJob.ps1` passed.
- `.agent-runs/runs.jsonl` recorded model `Gemini 3.1 Pro (High)`.
