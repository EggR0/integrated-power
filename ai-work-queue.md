# AI Work Queue

Use this file as the shared backlog for Antigravity IDE, Codex, scheduled jobs, and local GPU preprocessing.

## Current Quota Plan

| Field | Value | Notes |
| --- | --- | --- |
| Weekly remaining | TBD | Update from Codex dashboard or `/status`. |
| Per 5h target | TBD | Use about 70-85% of the safe maximum, not 100%. |
| Manual reserve | TBD | Keep reserve for urgent debugging. |
| Reset time | TBD | Record the exact reset time when known. |

## Window Plan

| Window | Target use | Work type | Status |
| --- | ---: | --- | --- |
| Window 1 | TBD | A-grade implementation/debugging | pending |
| Window 2 | TBD | B-grade test/review work | pending |
| Window 3 | TBD | B/C-grade audits and docs | pending |
| Window 4 | TBD | Remaining highest-value queue items | pending |

## Ready Jobs

| ID | Priority | Estimate | Runner | Mode | Task | Output |
| --- | --- | ---: | --- | --- | --- | --- |
| JOB-001 | A | TBD | Antigravity IDE + Codex MCP | worktree | Pick one real feature or bug and create an implementation plan before editing. | `reports/JOB-001-plan.md` |
| JOB-002 | B | TBD | Codex | read-only | Find high-value missing tests in the active codebase. | `reports/JOB-002-test-gaps.md` |
| JOB-003 | B | TBD | Codex + Context7 | read-only | Check dependency/API usage against current docs. | `reports/JOB-003-dependency-review.md` |
| JOB-004 | C | TBD | Local 3090 4-way | read-only | Summarize large logs, issues, or repo notes into candidate tasks. | `reports/JOB-004-local-gpu-prep.md` |
| JOB-005 | C | TBD | Codex | read-only | Produce onboarding and architecture notes from selected source folders. | `reports/JOB-005-architecture-notes.md` |

## Selection Rules

- If weekly remaining is high and reset is far away, choose A or B tasks with clear verification.
- If weekly remaining is high and reset is near, batch B and C tasks that create reusable reports.
- If the 5h window is almost exhausted, stop starting implementation tasks and run read-only analysis only.
- If a task requires broad context, let local GPU produce a short pre-digest first, then hand the focused prompt to Codex.
- Do not run multiple write-capable agents against the same worktree at the same time.

## Done Criteria

- Each job writes an output artifact under `reports/`.
- Each write-capable job uses a separate branch or worktree.
- Each completed job records what was verified and what remains uncertain.

