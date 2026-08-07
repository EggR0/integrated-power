# Local LLM Mode Contract

**Workspace selector**: `scripts/dispatch/Select-LocalLLMModel.ps1`
**Workspace Ollama script**: `scripts/dispatch/Invoke-LocalLLM.ps1`
**Workspace vLLM script**: `scripts/dispatch/Invoke-vLLMJob.ps1`
**Bundled fallback scripts**: this skill's `scripts/` directory (`~/.gemini/config/plugins/ip-orchestrator-plugin/skills/ip-orchestrator/scripts/`) contains the same helper scripts for workspaces that do not vendor them.

## Purpose
Use a measured local model for token-efficient preprocessing, summarization, extraction, and low-risk draft generation.

## Use When

- The task involves large or noisy text that should be compressed before Codex sees it.
- The user explicitly asks for local LLM, vLLM, offline model, or local preprocessing.
- The expected output is a report, summary, checklist, classification, or extracted data that can be verified locally.
- Cloud quota should be conserved.

## Avoid When

- The task requires direct code edits with high correctness risk.
- The local endpoint is offline and the user needs a finished implementation now.
- The task involves sensitive credentials or deployment actions.

## Model Selection Rule

Do not call an arbitrary local model. Before a local LLM call, select a model with:

```powershell
.\scripts\dispatch\Select-LocalLLMModel.ps1 -TaskType extraction -InstalledOnly -AsJson
```

Use the selected model and pass the selector reason into the invocation with `-SelectedBy selector -SelectionReason "<reason>"`. The selector reads:

- `this plugin's references/local_llm_model_registry.csv` for web-seeded prior scores by task type.
- Workspace state `reports/local_llm_metrics.csv` (`%LOCALAPPDATA%\EggR\state\workspaces\<id>\reports\`) for local measured success rate, elapsed time, and tokens/second.
- Ollama `/api/tags` to prefer models that are actually installed when `-InstalledOnly` is used.

It also reads `LocalLlm.HardwarePolicy` from Integrated Power settings and detects NVIDIA
VRAM/compute capability with `nvidia-smi`. `Quantization` describes stored
weights and is only a memory-estimation input. GGUF Q4 and MXFP4 do not by
themselves require native FP4 execution. Compute capability is a hard constraint
only when a registry row explicitly declares `MinimumComputeCapability`, or
declares `RequiredRuntimePrecision` with a supported `PrecisionBackend`.
Built-in FP4/FP8 thresholds are scoped to `tensorrt-rtx`; other runtimes must
declare their own tested minimum.

For reproducible offline diagnosis:

```powershell
.\scripts\dispatch\Select-LocalLLMModel.ps1 `
  -Provider ollama -AvailableVramGB 21 -ComputeCapability 8.6 `
  -DisableHardwareDetection -AsJson
```

An unregistered `user_default` model remains selectable with
`Compatibility=unknown_user_default` unless `-InstalledOnly` is requested or an
explicit hard hardware constraint is violated. Automatic mode stays registry-
and provider-scoped.

Valid `-TaskType` values are `summarization`, `extraction`, `coding`, `reasoning`, `korean`, `long_context`, `routing_review`, and `general`.

## Usage

- For Ollama, use workspace `scripts/dispatch/Invoke-LocalLLM.ps1` when present; otherwise use bundled `scripts/Invoke-LocalLLM.ps1`.
- For OpenAI-compatible vLLM, use workspace `scripts/dispatch/Invoke-vLLMJob.ps1` when present; otherwise use bundled `scripts/Invoke-vLLMJob.ps1`.
- Always provide the instruction via `-PromptFile`.
- Pass `-TaskType`, `-SuccessRegex`, and `-MinOutputChars` when the output has a verifiable shape.
- For vLLM, optionally pass `-Endpoint`; bare URLs are normalized to `/v1`. Use `VLLM_BASE_URL` and `VLLM_API_KEY` when needed.

## Output

- The final local LLM response is written to `-OutputFile` or a timestamped report under Integrated Power workspace state `reports/` (`%LOCALAPPDATA%\EggR\state\workspaces\<id>\reports\`).
- Token metrics are appended to Integrated Power workspace state `reports/token_usage.csv` (`%LOCALAPPDATA%\EggR\state\workspaces\<id>\reports\`) when available.
- Task metrics are appended to Integrated Power workspace state `reports/local_llm_metrics.csv` (`%LOCALAPPDATA%\EggR\state\workspaces\<id>\reports\`).
- The task metrics CSV records `TaskType`, `Success`, `ActualElapsedSeconds`, `OutputChars`, `TokensPerSecond`, `SelectedBy`, `SelectionReason`, and `ErrorMessage`.
- `SuccessRegex` is only an automatic shape check. If semantic review finds the output wrong, relabel the row with `scripts/metrics/Update-LocalLLMMetric.ps1` in this workspace or the bundled `scripts/Update-LocalLLMMetric.ps1` so future routing uses real success data instead of superficial keyword matches.

## Fallback

If the local endpoint is offline, record that in the artifact and choose either Main Agent Direct or Codex depending on the task's risk and complexity.
