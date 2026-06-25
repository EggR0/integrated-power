---
name: ai-workflow-orchestrator
description: Manage quota-aware AI coding work across Antigravity IDE, Codex MCP, Context7, Playwright, and local GPU preprocessing. Use when selecting queued jobs, planning Codex delegation, or deciding whether work should be read-only, worktree-based, or interactive.
---

# AI Workflow Orchestrator

Use this skill to coordinate AI-assisted development in this project.

## Read First

1. `ai-work-queue.md`
2. `docs/weekly-quota-operations.md`
3. Relevant prompt template under `prompts/`

## Selection Policy

- Pick the highest-value queued job that fits the current quota window.
- Keep a manual reserve for urgent debugging.
- Prefer read-only analysis for unattended or scheduled work.
- Prefer write-capable Codex work only when the task has clear acceptance criteria.
- Never run multiple write-capable agents on the same worktree at the same time.

## Tool Policy

- Use Codex MCP for hard reasoning, implementation, reviews, and test generation.
- Use Context7 MCP only when current library documentation matters.
- Use Playwright MCP only when browser or UI verification matters.
- Use local GPU preprocessing for broad, noisy, or repetitive summarization before asking Codex to reason deeply.

## Delegation Prompt Shape

When delegating to Codex MCP, include:

- repo path
- selected job ID
- mode: read-only or worktree
- expected output artifact
- allowed tools
- explicit stop conditions
- verification requirements

## Output Requirements

Every completed job should produce:

- a report under `reports/`
- changed file list, if any
- verification performed
- risks and uncertainties
- next recommended job

