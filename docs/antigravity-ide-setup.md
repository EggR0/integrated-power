# Antigravity IDE Setup Checklist

This file lists what has been configured by file access and what still needs to be confirmed inside Antigravity IDE.

## Already Prepared By File Access

- Global Antigravity MCP config path: `C:\Users\jsp0\.gemini\config\mcp_config.json`
- Added MCP servers:
  - `codex`: runs the local Codex MCP server using the real Codex executable path.
  - `context7`: fetches current library documentation through MCP.
  - `playwright`: browser automation and UI verification through MCP.
- Project-local Antigravity skill path: `.agents/skills/ai-workflow-orchestrator/SKILL.md`
- Shared queue: `ai-work-queue.md`
- Codex non-interactive runner: `scripts/Invoke-CodexJob.ps1`

## User Action Required In Antigravity IDE

1. Open Antigravity IDE.
2. Add or open this folder as a project:
   `C:\Users\jsp0\Documents\Intergrated POWER`
3. Open Settings -> Customizations -> MCP Servers.
4. Click Refresh if the servers do not appear.
5. Enable only the MCP servers needed for this project:
   - Start with `codex` and `context7`.
   - Enable `playwright` only for UI/browser verification tasks.
6. Set the project permission mode conservatively:
   - Read/review mode for scheduled or queued analysis.
   - Manual review before file edits.
   - Avoid always-proceed for agents that can write files, run terminals, or call external systems.
7. In the Agent panel, ask Antigravity IDE:

```text
Use the project skill `ai-workflow-orchestrator`.
Read ai-work-queue.md and choose the highest-value job for the current 5h quota window.
Use Codex MCP only if the job benefits from deeper code reasoning.
Do not modify files unless the selected job explicitly allows write mode.
```

## Recommended MCP Usage

| MCP | Keep enabled? | Use for |
| --- | --- | --- |
| `codex` | Yes | Hard reasoning, implementation, review, test generation |
| `context7` | Usually | Current docs for libraries/frameworks |
| `playwright` | Task-specific | UI smoke tests, screenshots, browser flows |

## Notes

- Antigravity 2.0 desktop is better for multi-project orchestration and scheduled tasks.
- Antigravity IDE is better as the hands-on code surface where you see and approve changes.
- You do not need to make the standalone Antigravity manager your main tool unless you want native scheduled tasks there.

