# Agentic Validator Registry - 2026-07-05

## Purpose

Automatic validator inference is useful, but safe worker delegation needs explicit project policy. This update adds a registry so Codex/Antigravity can define validation rules once and have local worker tasks inherit them.

## Added

- `config/agentic_validator_registry.csv`
  - `vscode-extension/*` -> `syntax_and_command` with `npm run compile`.
  - strict `vscode-extension/*` -> `npm run test`.
  - `scripts/**/*.ps1` -> built-in syntax validation.
  - `tests/**/*.ps1` -> built-in syntax validation.

## Changed

- `scripts/dispatch/Select-AgenticValidator.ps1`
  - Reads `config/agentic_validator_registry.csv` by default.
  - Registry match wins before heuristic package detection.
  - Supports `{{RepoRoot}}` command templates.
  - Stops package detection at repo root, avoiding accidental parent-directory package policies.
  - Adds `RegistryFile` to selector output.

- `tests/run-agentic-validator-selector-e2e.ps1`
  - Updated expectations to verify registry-backed selections.

## Current registry behavior

PowerShell dispatch target:

```text
Target: scripts/dispatch/Invoke-AgenticLoop.ps1
Source: registry:scripts/**/*.ps1
ValidatorProfile: syntax
ValidationCommand: ""
```

VS Code extension target:

```text
Target: vscode-extension/package.json
Source: registry:vscode-extension/*
ValidatorProfile: syntax_and_command
ValidationCommand: try { Push-Location '{{RepoRoot}}\vscode-extension'; npm run compile } finally { Pop-Location }
```

Strict VS Code extension target:

```text
Source: registry:vscode-extension/*
ValidationCommand: npm run test
```

## Verification

Commands run:

```powershell
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Select-AgenticValidator.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\tests\run-agentic-validator-selector-e2e.ps1 -Raw -Encoding UTF8))
Import-Csv -LiteralPath .\config\agentic_validator_registry.csv
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-validator-selector-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-cost-policy-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-validation-command-e2e.ps1
npm run compile
```

Results:

- selector parser OK.
- registry CSV import OK.
- validator selector E2E passed.
- cost policy E2E passed.
- delegated agent task E2E passed.
- validation command E2E passed.
- `vscode-extension` `npm run compile` passed.

## Remaining work

- Add a multi-file transaction model before local workers are allowed to patch multiple files in one run.
- Add registry fields for required artifacts or post-run report paths.
- Add a small CLI command to list the effective validator policy for a file without running a task.
