# AI Workflow Project Rules

This repository is the control workspace for managing AI-assisted coding work across Antigravity IDE, Codex, MCP servers, and local GPU preprocessing.

## Operating Principles

- Treat Antigravity IDE as the hands-on coding surface where the user reviews diffs and accepts changes.
- Treat Codex as a delegated worker for bounded implementation, review, debugging, and test-generation tasks.
- Prefer worktrees, branches, or read-only analysis for automated or scheduled jobs.
- Do not modify external repositories, global configuration, credentials, or deployment targets unless the user explicitly asks for that exact action.
- Keep token use intentional: pick queued work that matches the current remaining quota window instead of trying to consume quota for its own sake.
- Always produce an artifact for delegated work: a report, patch summary, test result, or checklist with file paths.

## Verification Expectations

- For code changes, run the relevant tests or explain exactly why they could not be run.
- For UI work, capture or request a browser verification step.
- For read-only audits, include evidence: file paths, commands inspected, and confidence level.
- For automated jobs, write outputs under `reports/` unless the user asks for another destination.

