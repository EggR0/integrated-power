# Invoke Script Comparison - 2026-07-04

## Scope

Compared the repository invocation paths for Codex CLI jobs and local LLM jobs:

- `scripts/dispatch/Invoke-CodexJob.ps1`
- `scripts/dispatch/Invoke-CodexDebate.ps1`
- `scripts/dispatch/Invoke-AiWorkWindow.ps1`
- `scripts/dispatch/Invoke-LocalLLM.ps1`
- `vscode-extension/assets/codex-orchestrator-plugin/skills/codex-orchestrator/scripts/Invoke-CodexJob.ps1`
- `vscode-extension/assets/codex-orchestrator-plugin/skills/codex-orchestrator/scripts/Invoke-AiWorkWindow.ps1`

## Key Differences

| Area | Codex invocation | Local LLM invocation |
| --- | --- | --- |
| Transport | `codex exec` subprocess | HTTP API through `curl.exe` |
| Backend | OpenAI Codex CLI/account quota | Local service quota/VRAM bounded |
| Working directory | Explicit `--cd` repo root | Prompt file only; no sandbox concept |
| Permissions | Codex sandbox flag controls file access | Local endpoint can only return text; script writes output/metrics |
| Usage data | Codex JSONL when `-JsonLog` is used | API `usage` fields when returned by local endpoint |
| Output contract | `--output-last-message` markdown file | Response content markdown file |

## Problems Found

1. `AGENTS.md` required `ai-orchestrator/scripts/dispatch/Invoke-vLLMJob.ps1`, but that path and script did not exist in this repository.
2. `scripts/dispatch/Invoke-LocalLLM.ps1` was Ollama-specific, while the repository rule said local LLM work should use a vLLM OpenAI-compatible endpoint.
3. Several active scripts still referenced the old `ai-orchestrator\...` layout even though the current repository uses top-level `scripts\...`, `prompts\...`, and `config\...`.
4. `scripts/dispatch/Invoke-CodexJob.ps1` hardcoded one Codex executable path, making it fragile across installs or Codex updates.
5. The plugin copy of `Invoke-CodexJob.ps1` passed `$RequestedExe` to setup, but that variable was not declared.
6. Codex JSONL usage parsing looked under `ai-orchestrator\scripts\metrics`, so usage parsing would silently skip in the current layout.
7. `scripts/scan/Compare-ScanState.ps1` still wrote `last_scan_state.json` under the old `ai-orchestrator\config` path.
8. The vLLM runner needed to accept both bare server URLs such as `http://localhost:8000` and OpenAI base URLs such as `http://localhost:8000/v1`.
9. The root Codex runner did not explicitly fail when `codex exec` returned a non-zero exit code.
10. Local HTTP runners built JSON from hashtables containing file-loaded prompt strings. On Windows PowerShell 5.1 this can hang during `ConvertTo-Json`; using `pscustomobject` plus primitive casts avoids that path.

## Work Completed

- Added `scripts/dispatch/Invoke-vLLMJob.ps1`.
  - Calls an OpenAI-compatible vLLM endpoint at `http://localhost:8000/v1` by default.
  - Supports `VLLM_BASE_URL` and `VLLM_API_KEY`.
  - Normalizes bare endpoint URLs by appending `/v1`.
  - Auto-detects the first model from `/v1/models` when `-Model` is omitted.
  - Uses `curl.exe` plus a UTF-8 no-BOM temp JSON file for PowerShell 5.1 compatibility.
  - Builds request JSON from `pscustomobject` values with explicit primitive casts to avoid `ConvertTo-Json` hangs.
  - Writes output under globalStorage `reports/vllm-<stamp>.md` by default.
  - Records `token_usage.csv` and `local_llm_metrics.csv`.
- Hardened `scripts/dispatch/Invoke-LocalLLM.ps1`.
  - Keeps the existing Ollama-specific path.
  - Builds request JSON from `pscustomobject` values with explicit primitive casts.
- Hardened `scripts/dispatch/Invoke-CodexJob.ps1`.
  - Added `-CodexExe`.
  - Resolves Codex from `-CodexExe`, `CODEX_EXE`, PATH, or the newest `%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe`.
  - Fixed usage parser path to `scripts\metrics\Parse-CodexUsage.ps1`.
  - Fails the script when `codex exec` returns a non-zero exit code.
- Fixed current-layout path references in:
  - `scripts/dispatch/Invoke-AiWorkWindow.ps1`
  - `scripts/schedule/Register-CodexScheduledJob.ps1`
  - `scripts/scan/Detect-ActiveWork.ps1`
  - `scripts/scan/Extract-Todos.ps1`
  - `scripts/scan/Compare-ScanState.ps1`
  - `scripts/metrics/Track-Tokens.ps1`
- Fixed plugin asset copies:
  - `vscode-extension/assets/codex-orchestrator-plugin/skills/codex-orchestrator/scripts/Invoke-CodexJob.ps1`
  - `vscode-extension/assets/codex-orchestrator-plugin/skills/codex-orchestrator/scripts/Invoke-AiWorkWindow.ps1`
- Updated operator-facing docs:
  - `AGENTS.md`
  - `README.md`
  - `docs/setup/antigravity-ide-setup.md`
  - `docs/reference/token-measurement.md`

## Verification

Commands run:

```powershell
rg --files -g '*Invoke-*.ps1' -g '*.ps1'
rg -n "Invoke-(Codex|vLLM|LLM|.*Job)|codex|vllm|OpenAI|chat/completions|responses" -S .
rg -n "ai-orchestrator\\scripts|ai-orchestrator/scripts|Invoke-vLLMJob|Invoke-LocalLLM|RequestedExe" -S AGENTS.md README.md docs scripts vscode-extension\assets\codex-orchestrator-plugin\skills\codex-orchestrator\scripts
```

PowerShell AST parser check passed for:

- `scripts/dispatch/Invoke-CodexJob.ps1`
- `scripts/dispatch/Invoke-AiWorkWindow.ps1`
- `scripts/dispatch/Invoke-LocalLLM.ps1`
- `scripts/dispatch/Invoke-vLLMJob.ps1`
- `scripts/schedule/Register-CodexScheduledJob.ps1`
- `scripts/scan/Detect-ActiveWork.ps1`
- `scripts/scan/Extract-Todos.ps1`
- `scripts/scan/Compare-ScanState.ps1`
- `scripts/metrics/Track-Tokens.ps1`
- plugin `Invoke-CodexJob.ps1`
- plugin `Invoke-AiWorkWindow.ps1`

Endpoint checks:

- `curl.exe -sS --max-time 3 http://localhost:8000/v1/models` failed because vLLM was not listening on port 8000.
- `curl.exe -sS --max-time 3 http://localhost:11434/api/version` succeeded with Ollama `0.15.5`.

Failure-path checks:

- A fake `codex` executable returning exit code 42 was passed through `Invoke-CodexJob.ps1`; the runner threw `Codex failed with exit code 42`.
- `Invoke-vLLMJob.ps1` was called with `-Endpoint http://127.0.0.1:9`; it normalized the target to `http://127.0.0.1:9/v1/chat/completions` and failed quickly through curl timeout instead of hanging during JSON body creation.
- A local JSON-body smoke check for `Invoke-LocalLLM.ps1`'s request shape completed successfully after switching to `pscustomobject` request bodies.

Dispatch flow check:

- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dispatch\Invoke-AiWorkWindow.ps1` succeeded.
- It generated current context, extracted TODOs, logged token estimates, and prepared a dispatch prompt in Antigravity globalStorage.
- After fixing `Compare-ScanState.ps1`, the dispatch flow no longer recreated the stale `ai-orchestrator\config` path.

## Confidence

High confidence for script path fixes and PowerShell parse validity.

Medium confidence for vLLM runtime behavior until a vLLM server is started and a real generation smoke test is run.
