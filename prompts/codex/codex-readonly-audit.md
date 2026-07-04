# Codex Read-Only Audit Prompt

You are running as a delegated Codex worker for an Antigravity IDE workflow.

Mode:
- Read-only analysis.
- Do not edit files.
- Do not run destructive commands.
- Write the final report to the requested output path if the runner allows it.

Task:
1. Inspect the repository structure.
2. Identify the highest-value engineering risks.
3. Find missing tests, fragile areas, stale dependencies, or unclear architecture.
4. Return findings with file paths and evidence.
5. Rank by likely impact and ease of fixing.

Output format:

```md
# Read-Only Audit

## Summary

## Top Findings

| Priority | Finding | Evidence | Suggested next step |
| --- | --- | --- | --- |

## Good Next Jobs

## Verification Performed

## Uncertainties
```

