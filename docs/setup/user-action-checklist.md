# User Action Checklist

These steps cannot be fully verified by file access from this workspace.

## Antigravity IDE

1. Open this folder:
   `<repo-root>`
2. In project settings, keep permissions conservative:
   - review plans before implementation
   - ask before terminal commands
   - ask before file writes outside the project
3. In MCP settings, refresh configured servers.
4. Enable only the tools needed for the current job:
   - always useful: `codex`
   - usually useful: `context7`
   - UI only: `playwright`
   - PR/issue only: `github`, after token setup
5. Start with this prompt:

```text
Use the project workflow. Read ai-work-queue.md and docs/architecture/integrated-toolchain-plan.md.
Pick one job that fits the current quota window.
Use Codex MCP only when deeper code reasoning is needed.
Use Context7 for current API docs.
Use Playwright only for browser verification.
Do not edit files before showing the plan.
```

## GitHub MCP

Only add GitHub MCP after you decide which repositories and permissions it should have.

Recommended starting mode:

- read-only
- limited toolsets: repos, issues, pull_requests, actions
- no write tools until the workflow is proven

## Local LLM

Choose one local serving path:

- vLLM for an OpenAI-compatible local serving endpoint.
- Ollama for simpler local model management.

Recommended first local-LLM job:

```text
Summarize reports/current_context.md and reports/current_todos.md.
Return only candidate jobs and risk ranking.
Do not write code.
```

