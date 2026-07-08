# Agentic Multi-File Transaction - 2026-07-05

## Purpose

Local workers can now propose patches for more than one file, but file writes still pass through the harness. This adds the transaction safety layer needed before giving local LLMs broader implementation tasks.

## Changed

- `scripts/dispatch/Invoke-AgenticLoop.ps1`
  - Patch output now supports an optional `FILE: path/to/file` line before a `SEARCH/REPLACE` block.
  - Existing single-file `SEARCH/REPLACE` output remains valid and defaults to `-TargetFile`.
  - Each patch target is resolved under the current workspace root.
  - Patch targets outside the workspace root are rejected.
  - All patch targets are copied to temp files first.
  - The full patch set is applied to temp copies before touching real files.
  - Syntax validation runs across all changed temp files.
  - Real apply stores original contents for every changed file.
  - If apply or validation command fails, all changed files are restored.

## Output contract

Single-file patch remains unchanged:

```text
SEARCH:
<exact old text>
REPLACE:
<new text>
```

Multi-file patch:

```text
FILE: path/to/fileA.ps1
SEARCH:
<exact old text in file A>
REPLACE:
<new text for file A>

FILE: path/to/fileB.ps1
SEARCH:
<exact old text in file B>
REPLACE:
<new text for file B>
```

## Verification

Commands run:

```powershell
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-AgenticLoop.ps1 -Raw -Encoding UTF8))
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-multifile-transaction-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-cost-policy-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-validation-command-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-validator-selector-e2e.ps1
npm run compile
```

Results:

- multi-file transaction parser sweep OK.
- multi-file transaction E2E passed.
- cost policy E2E passed.
- delegated agent task E2E passed.
- validation command E2E passed.
- validator selector E2E passed.
- `vscode-extension` `npm run compile` passed.

## Remaining rough edge

The harness still prints `Successfully applied patch.` during temp dry-run application as well as real application. The behavior is correct, but the log wording should be split into "dry-run apply succeeded" and "real apply succeeded."
