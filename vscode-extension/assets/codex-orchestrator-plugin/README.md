# EggR Codex Orchestrator Plugin

This Antigravity plugin installs a single **AI work router** skill.
It decides whether work should stay with the main agent, be delegated to OpenAI Codex, or be preprocessed by a local OpenAI-compatible vLLM endpoint.

## Installation
1. Recommended: run **EggR: Install or Update Antigravity Orchestrator** from the Antigravity command palette. Installation is explicit; opening the dashboard never overwrites the orchestrator.
2. Manual fallback: drop this folder (`codex-orchestrator-plugin`) into `~/.gemini/config/plugins/`.
3. Ensure you have the `codex.exe` CLI installed either globally on your `PATH`, or set `$env:CODEX_EXE`. The plugin will also attempt to auto-detect installations inside `%LOCALAPPDATA%\OpenAI\Codex\bin`.

## Global Routing Rules (Optional)
The dashboard command creates `~/.gemini/GEMINI.md` from the bundled template only when the file does not exist. If it already exists, EggR preserves it and offers to open the new template for manual review.

## Features
- **Single Skill, No Duplicates**: Installs only `codex-orchestrator`; stale skills from older releases are removed by the extension installer.
- **Framework-Neutral State**: Runtime state lives under the EggR state root, not inside a Codex- or IDE-specific directory.
- **Recoverable Updates**: Explicit installation stages the full bundle and keeps the prior plugin under `.eggr-backups` before switching versions.
- **Token-Efficient Routing**: Chooses main-agent direct work, Codex delegation, or local vLLM preprocessing based on task shape.
- **Measured Local Model Selection**: Uses `config/local_llm_model_registry.csv` plus `reports/local_llm_metrics.csv` so local models are selected by task type, success rate, elapsed time, and installed availability.
- **Local-First Policy**: Treats local LLM execution as the default delegated route when the computer is healthy, with Codex/Antigravity reserved for high-value judgment and implementation. Weekly reset proximity can lower the cloud-use threshold.
- **Watchdog Protection**: Codex jobs run with strict UTF-8 stream handling and a hang-protection watchdog.
- **Local LLM Mode**: Uses `Select-LocalLLMModel.ps1` before `Invoke-LocalLLM.ps1` or `Invoke-vLLMJob.ps1` for local summarization, extraction, and preprocessing.
- **Portability**: Auto-resolves Codex binary locations.
- **Debate Mode**: Transparent reasoning with persistent Markdown transcripts.
