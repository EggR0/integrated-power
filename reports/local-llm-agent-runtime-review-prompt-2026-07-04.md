# Local LLM Agent Runtime Review

You are a local technical advisor for a Windows PowerShell based AI orchestration workspace.

Task:
Review the intended narrow change: how to invoke a local LLM so it behaves as an agentic loop, not as a one-shot patch generator.

Current repository files to consider by path:
- AgenticLoop_Executive_Worker_Architecture.md
- scripts/dispatch/Invoke-AgenticLoop.ps1
- scripts/dispatch/Invoke-LocalLLM.ps1
- scripts/dispatch/Invoke-vLLMJob.ps1
- scripts/dispatch/Select-LocalLLMModel.ps1
- scripts/dispatch/New-ContextManifest.ps1

User intent:
- Antigravity IDE/Gemini and Codex remain the executive and technical advisors.
- Local LLMs should be usable as advisors, planners, designers, worker agents, and coding agents.
- The narrow issue is local LLM invocation: it should receive enough context and hardware-aware configuration to perform meaningful coding loops.
- Overly tiny snippets cause local coding agents to fail, forcing Codex/Gemini to spend too many input and reasoning tokens.
- The runtime should monitor hardware and choose model/context size accordingly.

Please respond in Korean.
Focus only on the local LLM invocation/runtime contract.
Do not propose a broad rewrite of the whole workspace.
Give:
1. The best invocation pattern.
2. The minimum state machine states.
3. The hardware/model/context policy.
4. The most dangerous failure mode.
5. A short implementation plan.
