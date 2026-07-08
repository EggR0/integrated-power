# Local LLM Hardware-Aware Selection Implementation

## Scope

Implemented the first concrete step from `AgenticLoop_Executive_Worker_Architecture.md`: make local model selection return a hardware-aware execution budget, not only a model name.

Changed file:

- `scripts/dispatch/Select-LocalLLMModel.ps1`

## What Changed

- Added GPU snapshot collection through `nvidia-smi`.
- Added `RecommendedNumCtx` and `RecommendedMaxTokens` to the selected result and each candidate.
- Added context budgeting based on task type, task scale, registry `ContextHintTokens`, and available VRAM.
- Added recent OOM/VRAM failure penalty from `local_llm_metrics.csv`.
- Added `-NoHardwareSnapshot` fallback for systems without `nvidia-smi` or for deterministic testing.
- Preserved the existing output contract by adding fields rather than removing or renaming existing fields.

## Verification

Commands run:

```powershell
$path = 'C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Select-LocalLLMModel.ps1'
$tokens=$null; $errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
```

Result: parser succeeded with no syntax errors.

```powershell
.\scripts\dispatch\Select-LocalLLMModel.ps1 -TaskType coding -TaskScale Large -InstalledOnly -AsJson
```

Observed result:

- selected model: `gpt-oss:20b`
- recommended context: `32768`
- recommended max tokens: `4096`
- hardware snapshot included RTX 3090 GPUs and free VRAM.

```powershell
.\scripts\dispatch\Select-LocalLLMModel.ps1 -TaskType coding -TaskScale Large -InstalledOnly -NoHardwareSnapshot -AsJson
```

Observed fallback:

- selected model: `gpt-oss:20b`
- recommended context: `8192`
- recommended max tokens: `2048`
- reason included `gpuSnapshot=unavailable`.

## Next Step

Wire `Invoke-AgenticLoop.ps1` to consume `RecommendedNumCtx` and `RecommendedMaxTokens` from this selector instead of requiring the caller to hand-pick `-Model` and `-NumCtx`.
