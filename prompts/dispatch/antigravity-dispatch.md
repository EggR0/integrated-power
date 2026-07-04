# Antigravity IDE Dispatch Prompt

Use this prompt in Antigravity IDE when starting a quota-managed work session.

```text
Use the project skill `ai-workflow-orchestrator`.

Read:
- ai-work-queue.md
- docs/operations/weekly-quota-operations.md

Current quota state:
- weekly remaining: <fill in>
- current 5h window remaining: <fill in>
- reset time: <fill in>
- manual reserve: <fill in>

Choose the highest-value queued job that fits this window.

Before using tools, classify the job:
- goal type: implementation, debugging, review, tests, docs/API check, UI verification, triage, or preprocessing
- backend route: Antigravity IDE, Codex MCP, Codex CLI `exec --json`, Context7, Playwright, GitHub MCP, local LLM, or future 4-way server
- write boundary: read-only, branch, or worktree
- context boundary: which files/reports are enough, and whether local preprocessing should run first
- expected artifact: report, diff summary, verification result, or next-action checklist

Rules:
- Use Codex MCP for deep code reasoning or implementation planning.
- Use Codex CLI `exec --json` when exact Codex usage logging matters.
- Use Context7 MCP when current library/API documentation matters.
- Use Playwright MCP only for UI/browser verification.
- Use local 3090 or future 4-way preprocessing for broad logs, large repo scans, or noisy context before asking cloud models to reason.
- Prefer read-only mode unless the job explicitly allows file edits.
- For write work, use a branch or worktree and produce a diff summary.
- Write all reports under reports/.
```
