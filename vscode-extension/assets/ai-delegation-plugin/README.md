# Codex Orchestrator Plugin
# AI Delegation Plugin

This Antigravity Plugin globally installs a single **AI work router** skill.
It decides whether work should stay with the main agent, be delegated to OpenAI Codex, be delegated to the local agentic coding worker, or be preprocessed by a local OpenAI-compatible vLLM endpoint.

## Installation

1. Drop this folder (`ai-delegation-plugin`) into `~/.gemini/config/plugins/`.
2. Ensure you have the powershell scripts located at `~/.gemini/config/plugins/ai-delegation-plugin/skills/ai-delegation/scripts/`.

### Manual Install
If you need to install the global agents config manually without restarting the IDE, run:
```powershell
& "~/.gemini/config/plugins/ai-delegation-plugin/install/Add-GlobalRules.ps1"
```

## Features
- **Single Skill, No Duplicates**: Installs only `ai-delegation`; stale skills from older releases are removed by the extension installer.
- **Token-Efficient Routing**: Chooses main-agent direct work, Codex delegation, or local vLLM preprocessing based on task shape.
- **Measured Local Model Selection**: Uses `config/local_llm_model_registry.csv` plus `reports/local_llm_metrics.csv` so local models are selected by task type, success rate, elapsed time, and installed availability.
- **Local-First Policy**: Treats the local agentic worker as the default delegated route for file-writing coding work when the computer is healthy, with Codex/Antigravity reserved for high-value judgment and implementation. Weekly reset proximity can lower the cloud-use threshold.
- **Local Agentic Worker Mode**: Uses `scripts/dispatch/Invoke-DelegatedAgentTask.ps1 -WorkerBackend Auto` for repository edits so Aider/local Ollama, validation, rollback, and artifacts are managed by the workspace bridge.
- **Watchdog Protection**: Codex jobs run with strict UTF-8 stream handling and a hang-protection watchdog.
- **Local LLM Mode**: Uses `Select-LocalLLMModel.ps1` before `Invoke-LocalLLM.ps1` or `Invoke-vLLMJob.ps1` for local summarization, extraction, and preprocessing only.
- **Portability**: Auto-resolves Codex binary locations.
- **Debate Mode**: Transparent reasoning with persistent Markdown transcripts.
