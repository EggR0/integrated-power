# Review: Agentic Loop Selector Integration

You are reviewing a narrow PowerShell implementation change in this workspace.

Goal:
`Invoke-AgenticLoop.ps1` should stop requiring a caller to manually choose the local LLM model and context size. It should consume `Select-LocalLLMModel.ps1` and use the selector's hardware-aware `RecommendedNumCtx` budget while preserving explicit caller choices.

Files to inspect if your environment can read the repository:
- `scripts/dispatch/Invoke-AgenticLoop.ps1`
- `scripts/dispatch/Select-LocalLLMModel.ps1`
- `scripts/dispatch/Invoke-LocalLLM.ps1`

Current intended behavior:
- If `-Model` is omitted, call `Select-LocalLLMModel.ps1 -TaskType <TaskType> -TaskScale <TaskScale> -InstalledOnly -AsJson` and use `SelectedModel`.
- If `-NumCtx` is omitted or `<= 0`, use the selector's recommended context budget.
- If a caller explicitly passes `-Model`, keep that model. If possible, use that candidate's recommended context budget rather than the top selected model's budget.
- Pass `TaskTitle`, `TaskType`, `TaskScale`, `SelectedBy`, and `SelectionReason` through to `Invoke-LocalLLM.ps1` so local metrics remain useful.
- `-NoHardwareSnapshot` should flow through to the selector for fallback/deterministic runs.

Please focus on bugs and edge cases, not broad architecture. In Korean, answer:
1. Any correctness risks in this integration.
2. Any PowerShell-specific invocation or quoting risks.
3. Whether this is a good next step toward local LLM agentic runtime.
4. A short patch recommendation if needed.
