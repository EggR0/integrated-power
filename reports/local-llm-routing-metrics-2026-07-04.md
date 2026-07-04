# Local LLM Routing Metrics Update

## What changed

- Added `config/local_llm_model_registry.csv` as the initial benchmark prior table.
- Added `config/ai_routing_policy.json` for a simple local-first policy.
- Added `scripts/dispatch/Select-LocalLLMModel.ps1` so local model calls are selected by task type, installed availability, benchmark prior, historical success rate, elapsed time, and tokens/second.
- Extended `Invoke-LocalLLM.ps1` and `Invoke-vLLMJob.ps1` so `reports/local_llm_metrics.csv` records `TaskType`, `Provider`, `Success`, `OutputChars`, `TokensPerSecond`, `SelectedBy`, `SelectionReason`, and `ErrorMessage`.
- Added `scripts/metrics/Update-LocalLLMMetric.ps1` so semantic review can relabel a row as pass/fail after automatic shape checks.
- Updated the Antigravity plugin skill docs and bundled scripts so reinstalling the extension preserves the same routing contract without duplicate skills.

## Policy

Default stance is local-first. If the computer and local endpoint are healthy, use local LLM for summarization, extraction, Korean/text preprocessing, long-context compression, low-risk planning, and reusable preprocessing artifacts.

Codex and Antigravity are reserved for high-value work: implementation, difficult debugging, architectural judgment, final review, and deciding how work should be delegated. When weekly quota reset is close, the cloud-use threshold can be lowered so useful quota is not wasted.

To keep this from becoming overcomplicated, routing has only two decision layers:

1. Can local LLM do this reliably enough?
2. If not, is cloud quality worth spending now given task risk and reset timing?

## Initial web-seeded priors

- Qwen2.5-32B gets high initial scores for structured extraction, JSON/table handling, multilingual/Korean, and long-context work because its Hugging Face card notes improved coding/math, structured outputs, multilingual support including Korean, and context support up to 131,072 tokens.
- Llama 3.1 gets a broad general-purpose prior because Meta describes 128K context, eight-language support, and strengths in general knowledge, steerability, math, tool use, and multilingual translation.
- gpt-oss:20b gets a coding/reasoning prior because OpenAI/Hugging Face describe it as a lower-latency local model with configurable reasoning and agentic/tool-use capabilities.
- NVIDIA Nemotron Super 49B gets a long-context reasoning prior because NVIDIA describes it as a general-purpose reasoning/chat model for English and coding languages with up to 131,072-token context.

## Smoke test

Command path:

- Selector: `scripts/dispatch/Select-LocalLLMModel.ps1`
- Invocation: `scripts/dispatch/Invoke-LocalLLM.ps1`
- Prompt: `reports/local-llm-metrics-smoke-prompt-2026-07-04.md`
- Output: `reports/local-llm-metrics-smoke-output-2026-07-04.md`

Result:

- Selected model: `llama3.1:8b`
- Elapsed: 21.54 seconds
- Tokens: 209
- Tokens/second: 9.7
- Automatic regex matched, but semantic review failed because the output misidentified Codex/Antigravity.
- The CSV row was corrected to `Success=False`, proving the selector can learn from semantic failure rather than only superficial keyword checks.

## Current caveat

This is not a full benchmark suite yet. It is the measurement spine: initial priors plus per-task local evidence. The next improvement should be a small benchmark harness that runs the same task set across installed models and records pass/fail labels consistently.

## Sources

- Qwen2.5-32B-Instruct model card: https://huggingface.co/Qwen/Qwen2.5-32B-Instruct
- Meta Llama 3.1 announcement: https://ai.meta.com/blog/meta-llama-3-1/
- OpenAI gpt-oss-20b model card on Hugging Face: https://huggingface.co/openai/gpt-oss-20b
- NVIDIA Nemotron Super 49B model card: https://build.nvidia.com/nvidia/llama-3_3-nemotron-super-49b-v1/modelcard
