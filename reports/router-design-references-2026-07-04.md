# Router Design References - 2026-07-04

## Goal

Improve the extension so it can decide whether work should stay with the main agent, be delegated to Codex, or be delegated to a local LLM for token-efficient preprocessing.

## External Patterns Checked

- Continue context providers and repo maps reduce context size before model calls.
  - https://docs.continue.dev/customize/deep-dives/custom-providers
- Aider Architect/Editor separates problem solving from edit generation.
  - https://aider.chat/2024/09/26/architect.html
  - https://aider.chat/docs/usage/modes.html
- LangChain/LangGraph routers classify a request and direct it to the appropriate agent.
  - https://docs.langchain.com/oss/python/langchain/multi-agent/router
  - https://reference.langchain.com/python/langgraph-supervisor
- CrewAI hierarchical process uses a manager to delegate tasks and validate results.
  - https://docs.crewai.com/en/learn/hierarchical-process

## Design Takeaways

1. Use one visible router skill instead of multiple overlapping skills.
2. Classify before spending cloud tokens.
3. Use local models for compression, extraction, clustering, and drafts.
4. Use Codex for hard coding judgment, code review, implementation, and tests.
5. Keep main-agent direct work for small local operations and verification.
6. Always produce an artifact so delegated reasoning is inspectable.

## Applied Changes

- Expanded the single `codex-orchestrator` skill into an AI work router.
- Added routing and local LLM reference contracts.
- Added `Invoke-vLLMJob.ps1` to the plugin asset so local LLM delegation survives extension reinstall.
- Kept duplicate skill folders out of the plugin package.
