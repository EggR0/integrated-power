# Antigravity IDE Dispatch Prompt

Use this prompt in Antigravity IDE when starting a quota-managed work session.

```text
Use the project skill `ai-workflow-orchestrator`.

Read:
- ai-work-queue.md
- docs/weekly-quota-operations.md

Current quota state:
- weekly remaining: <fill in>
- current 5h window remaining: <fill in>
- reset time: <fill in>
- manual reserve: <fill in>

Choose the highest-value queued job that fits this window.

Rules:
- Use Codex MCP for deep code reasoning or implementation planning.
- Use Context7 MCP when current library/API documentation matters.
- Use Playwright MCP only for UI/browser verification.
- Prefer read-only mode unless the job explicitly allows file edits.
- For write work, use a branch or worktree and produce a diff summary.
- Write all reports under reports/.
```

