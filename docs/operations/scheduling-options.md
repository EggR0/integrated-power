# Scheduling Options

Antigravity IDE is best as a hands-on coding surface. It does not need to be the only management tool.

## Option A: Antigravity IDE Only

Use this when you want to manually pick the next job and inspect every diff.

Flow:

```text
Antigravity IDE -> ai-work-queue.md -> Codex MCP -> report/diff -> user review
```

Best for:

- implementation
- debugging
- reviewing diffs
- deciding what to run next

## Option B: Codex CLI With Windows Task Scheduler

Use this when the task is repeatable and bounded.

Flow:

```text
Windows Task Scheduler -> scripts/dispatch/Invoke-CodexJob.ps1 -> reports/
```

Best for:

- read-only audits
- test gap reports
- dependency review
- architecture notes

## Option C: Codex App Automations

Use this when you want Codex-native background jobs, especially against Git repos.

Best for:

- recurring repo checks
- queued maintenance work
- isolated branch/worktree jobs

## Option D: Antigravity 2.0 Desktop

Use this only if you want Antigravity's standalone multi-agent command center and native scheduled tasks.

Best for:

- multiple projects
- multiple asynchronous agents
- schedule-first workflows

## Recommended Default

```text
Antigravity IDE for interactive coding.
Codex CLI/App for scheduled or batch jobs.
Local GPU for preprocessing.
Git worktrees for isolation.
```

