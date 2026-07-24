# Integrated Window Dispatch Prompt

You are coordinating an AI coding work window from the Integrated POWER workspace.

Read:

- `ai-work-queue.md`
- `docs/architecture/current-workspace-analysis.md`
- `docs/architecture/integrated-toolchain-plan.md`
- `reports/current_context.md`
- `reports/current_todos.md`

Goal:

Choose one useful job for the current window and route it to the right toolchain.

Decision rules:

- Do not spend tokens just to spend tokens.
- Prefer read-only work unless implementation is clearly valuable.
- Use Antigravity IDE for human-reviewed edits.
- Use Codex MCP for deep implementation or review inside Antigravity IDE.
- Use Codex CLI for scheduled report generation.
- Use Context7 when API freshness matters.
- Use Playwright only for browser/UI verification.
- Use GitHub MCP only when PR, issue, or CI context is needed.
- Use local 3090 LLM preprocessing for broad logs or large-context summaries.

Return:

1. selected job
2. why it fits the current window
3. tools to use
4. sandbox/permission mode
5. exact next command or Antigravity prompt
6. expected artifact path
7. stop conditions

