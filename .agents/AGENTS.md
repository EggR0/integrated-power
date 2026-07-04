# Workspace AI Workflow Rules

## Structural Relationship: Skills, MCP, and Codex

- **No Repo-Wide Raw MCP Reads**: Antigravity MUST NOT ask MCP to bulk-read the whole codebase, broad directories, or large sets of files for general understanding.
- **Direct MCP Limit (Max 10 Files)**: Antigravity may directly use MCP for targeted reads only when the task is local, concrete, and the selected context is 10 files or fewer.
- **Skill Required for Architectural or Ambiguous Work**: If the task involves architecture, debate, feature design, cross-module behavior, or unclear ownership, Antigravity MUST invoke the relevant Skill, especially `codex-transparent-debate` for Codex review.
- **Codex Context Limit**: Codex receives curated paths, not bulk contents, and NEVER more than 10 files at once. Larger investigations must be decomposed into stages.
- **Artifact Generation**: Every delegation must produce an artifact (discussion file, report, checklist, or direct file change summary) to prevent useful reasoning from existing only inside transient agent context.
- **MCP is a Retrieval Primitive, not an Orchestrator**: MCP answers "get this precise thing". Skills answer "run this workflow". Codex answers "reason over this bounded context or perform this bounded implementation".
- **Invoke Entrypoints**: For Codex CLI jobs use `scripts/dispatch/Invoke-CodexJob.ps1`; for local OpenAI-compatible vLLM jobs use `scripts/dispatch/Invoke-vLLMJob.ps1`.
