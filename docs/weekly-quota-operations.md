# Weekly Quota Operations

The goal is not to burn tokens. The goal is to keep valuable work ready so each quota window is used deliberately.

## Mental Model

If weekly remaining is `100` and one 5h window can safely use `30`, plan at least four execution windows. In practice, target `24-27` per window and reserve the rest for urgent manual work.

```text
required_windows = ceiling((weekly_remaining - manual_reserve) / per_window_target)
```

Example:

```text
weekly_remaining = 100
manual_reserve = 10
per_window_target = 24
required_windows = ceiling(90 / 24) = 4
```

## Work Classes

| Class | Examples | Best runner |
| --- | --- | --- |
| A | real feature, bug fix, hard debugging | Antigravity IDE + Codex MCP |
| B | test gaps, security review, refactor plan | Codex CLI/App/Automation |
| C | docs, onboarding, issue triage, dependency notes | Codex or local GPU |
| Local prep | log compression, repo summaries, candidate generation | 3090 4-way |

## Daily Loop

1. Check remaining quota and reset time.
2. Update `ai-work-queue.md`.
3. Let local GPU preprocess broad or noisy inputs.
4. Run one bounded Codex job per quota window.
5. Review artifacts in Antigravity IDE.
6. Promote only verified outputs into real implementation work.

## Safe Window Policy

- Use read-only jobs when you are away.
- Use write-capable jobs only in separate worktrees or branches.
- Avoid starting a large implementation in the last 20% of a 5h window.
- Keep a manual reserve for surprise bugs and interactive debugging.

## Good Queued Jobs

- Generate tests for modules that recently changed.
- Review open TODOs and propose priority order.
- Find dependency usages that likely changed in latest docs.
- Produce a migration plan with file-by-file risk.
- Read CI failures and cluster them by root cause.
- Produce architecture notes for a repo you have not touched recently.

