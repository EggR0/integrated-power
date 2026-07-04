# ADR Topic: Antigravity CLI and Local LLM Integration into Extension

We want to integrate the Antigravity CLI and Local LLMs into our VS Code extension and AI orchestrator skill.

Currently, the extension tracks token usage and run state for Codex, Opus, and Antigravity IDE. The `types.ts` has `TokenStatus` with `antigravityTokensLeft`, etc.

**Questions for Debate:**
1. Are Antigravity CLI tokens measured/billed separately from the Antigravity IDE tokens, or do they share the same overarching Antigravity quota and token pool? If separate, how should we retrieve the CLI token usage?
2. How should we extend the extension's data models (`TokenStatus`, `RunSummary` in `types.ts`) and polling mechanisms to accommodate tracking runs and tokens for the Antigravity CLI?
3. How should we accommodate Local LLMs in this architecture? What lifecycle states and token tracking properties are relevant for Local LLMs (which might not have cloud quotas but consume local compute/VRAM)?
4. Please propose a concrete implementation plan for these integrations.
