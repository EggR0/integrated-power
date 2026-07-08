# Serena Background Local LLM Design - 2026-07-05

## Decision

As this repository grows, Antigravity and Codex should not repeatedly rediscover the same structure from raw files. The missing layer is a local background semantic memory:

```text
Serena = symbol-level eyes
Local LLM = background summarizer / routing-hint writer
PowerShell = scheduler, boundaries, artifacts, validation
/ai-router = consumer of the prepared memory
```

Serena should not replace Aider, Codex, or Antigravity. Serena should prepare repo structure so later coding workers receive narrower file lists and better local context.

References:

- https://github.com/oraios/serena
- https://oraios.github.io/serena/01-about/000_intro.html

## What Serena Does Here

Serena is treated as a local semantic code toolkit, not as the agent brain. The background job uses Serena for read-only operations:

- project activation
- symbol overview
- symbol lookup
- reference lookup
- file structure discovery
- read-only diagnostics

Serena output is then summarized by a local LLM into durable artifacts.

## What The Local LLM Does

The local LLM is the worker responsible for turning Serena's raw symbol/file observations into compact memory:

- module summaries
- symbol cards
- ownership and dependency notes
- routing hints for `/ai-router`
- changed-area impact summaries
- stale-memory warnings

It must not edit repository code. It writes only to `reports/serena-background/`.

## Artifact Contract

Primary files:

```text
reports/serena-background/latest-manifest.json
reports/serena-background/repo-map.md
reports/serena-background/routing-hints.json
reports/serena-background/symbol-cards/
reports/serena-background/runs/<run-id>/
reports/serena-background/ledger.csv
```

`latest-manifest.json` should identify:

- run id
- git HEAD
- dirty file count
- included files
- generated symbol cards
- local model used
- elapsed time
- success/failure
- staleness markers

`routing-hints.json` should be consumable by `/ai-router`:

```json
{
  "version": 1,
  "generatedAt": "2026-07-05T00:00:00+09:00",
  "workspaceRoot": "C:\\Users\\jsp0\\Documents\\Intergrated POWER",
  "hints": [
    {
      "area": "local-agentic-worker",
      "summary": "Delegated edit bridge and Aider worker policy.",
      "primaryFiles": [
        "scripts/dispatch/Invoke-DelegatedAgentTask.ps1",
        "scripts/dispatch/Invoke-AiderWorker.ps1"
      ],
      "relatedFiles": [
        "vscode-extension/assets/codex-orchestrator-plugin/skills/codex-orchestrator/references/local-agentic-worker.md"
      ],
      "risk": "medium",
      "validator": "powershell-parser-and-adapter-e2e"
    }
  ]
}
```

These hints are recommendations, not authority. The actual edit still goes through `Invoke-DelegatedAgentTask.ps1`, validation, and rollback.

## Background Loop

The future script should be:

```text
scripts/dispatch/Invoke-SerenaBackgroundJob.ps1
```

Proposed flow:

```text
1. Acquire reports/serena-background/serena-background.lock
2. Read config/serena_background_policy.json
3. Compare current git state with latest manifest
4. Select changed/high-value files within include/exclude scope
5. Query Serena for symbol/file structure
6. Write raw observations to reports/serena-background/runs/<run-id>/serena-observations.json
7. Ask local LLM to summarize observations into symbol cards and routing hints
8. Validate JSON/Markdown artifact shape
9. Promote artifacts to latest-manifest/repo-map/routing-hints
10. Append ledger.csv
11. Release lock
```

## Trigger Policy

Initial triggers should be conservative:

- manual run
- pre-`/ai-router` run when hints are stale
- git diff changed since last manifest

Do not start with a daemon that constantly runs. First build a one-shot job, then add scheduling.

## How `/ai-router` Uses It

Before a local file-writing task:

```text
/ai-router
  -> read reports/serena-background/routing-hints.json if fresh
  -> pick candidate files
  -> write reports/ai-router-runs/<run-id>/files.txt
  -> call Invoke-DelegatedAgentTask.ps1 -FilesListFile ...
```

This reduces the chance that Antigravity/Gemini spends broad input tokens scanning the repo and reduces the chance that local LLM workers receive too little context.

## Safety Rules

- The Serena background job is read-only against source code.
- The local LLM must not generate patches in this mode.
- No cloud model escalation happens inside background indexing.
- No artifact becomes authoritative without validation.
- If Serena is unavailable, the job should write a failed capability report and stop.
- If the local LLM fails JSON shape validation, keep raw observations but do not promote stale hints.

## Development Phases

### Phase 0 - Contract

Done in this design:

- `config/serena_background_policy.json`
- `reports/serena-background-local-llm-design-2026-07-05.md`

### Phase 1 - Capability Probe

Add `scripts/dispatch/Test-SerenaCapability.ps1`:

- detects Serena MCP/CLI availability
- confirms workspace activation
- writes `reports/serena-background/capability.json`

### Phase 2 - One-Shot Snapshot

Add `Invoke-SerenaBackgroundJob.ps1 -Once`:

- collects changed files
- calls Serena read-only tools
- writes raw observations
- does not call local LLM yet

### Phase 3 - Local LLM Summarization

Extend the job:

- use `Select-LocalLLMModel.ps1 -TaskType long_context`
- call `Invoke-LocalLLM.ps1`
- produce symbol cards and routing hints
- validate JSON and markdown artifacts

### Phase 4 - `/ai-router` Integration

Update ai-router skill:

- use fresh `routing-hints.json` before delegated edits
- fall back to direct file selection when hints are stale or missing
- never use hints as final authority

### Phase 5 - Scheduler

Only after one-shot is stable:

- run every 15-60 minutes while the machine is idle
- stop under GPU/VRAM pressure
- stop after 3 consecutive failures

## Open Questions

- Whether Serena is best accessed through MCP only or whether a thin CLI adapter should be written.
- Whether symbol cards should live under `reports/` only, or later move to a cache directory ignored by git.
- Whether local embeddings should be added after the first symbol-card version works.
