Review this planned AI work router update for token efficiency.

Goal:
- A single Antigravity/Gemini skill should decide whether the main agent works directly, delegates to Codex, or delegates preprocessing/summarization to a local LLM.
- Duplicate skills should not be installed.
- Extension reinstall/update should remove stale skills and scripts.
- Token efficiency is the top priority.

Current implementation summary:
- Keep one skill named codex-orchestrator.
- Change its description and contract from Codex-only to AI work router.
- Add routing.md with decision order: Main Agent Direct, Local LLM/vLLM, Codex Debate, Codex Job, Work Window.
- Add local-llm.md describing Invoke-vLLMJob.ps1.
- Include Invoke-vLLMJob.ps1 in plugin assets.
- Installer mirrors the plugin directory and removes stale files not in the source asset.

Please identify any missing routing rule, risk, or simplification that would improve token efficiency without reintroducing duplicate skills.
