# Agentic Validator Selector - 2026-07-05

## Purpose

The agentic loop can now run a validation command, but manually supplying that command every time keeps too much orchestration burden on Codex/Antigravity.

This update adds automatic validator selection for delegated worker tasks.

## Changed files

- `scripts/dispatch/Select-AgenticValidator.ps1`
  - New validator selector.
  - Detects PowerShell files and uses built-in syntax validation.
  - Detects nearest in-repo `package.json`.
  - Uses `npm run compile` by default when available.
  - Uses `npm run test` in `-Strict` mode when available.
  - Stops package lookup at the repository root, so parent-directory `package.json` files are ignored.

- `scripts/dispatch/Invoke-DelegatedAgentTask.ps1`
  - `-ValidatorProfile` now accepts `auto`.
  - In auto mode, calls `Select-AgenticValidator.ps1`.
  - Passes the resolved validator profile, command, and timeout to `Invoke-AgenticLoop.ps1`.
  - Includes validator source and reason in the delegation decision log.

- `scripts/dispatch/Invoke-AutonomousAgent.ps1`
  - `-ValidatorProfile` now accepts `auto`.
  - Default remains `syntax` to avoid unexpectedly running heavier validators.

- `tests/run-agentic-validator-selector-e2e.ps1`
  - New E2E test for validator selection and bridge dry-run wiring.

## Current policies

PowerShell script targets:

```text
ValidatorProfile = syntax
ValidationCommand = ""
Source = builtin-powershell
```

VS Code extension/package targets:

```text
ValidatorProfile = syntax_and_command
ValidationCommand = try { Push-Location '<package-dir>'; npm run compile } finally { Pop-Location }
Source = package.json:compile
```

Strict package validation:

```text
ValidationCommand = npm run test
Source = package.json:test
```

## Verification

Commands run:

```powershell
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Select-AgenticValidator.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-DelegatedAgentTask.ps1 -Raw -Encoding UTF8))
[scriptblock]::Create((Get-Content -LiteralPath .\scripts\dispatch\Invoke-AutonomousAgent.ps1 -Raw -Encoding UTF8))
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-validator-selector-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-cost-policy-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-delegated-agent-task-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-agentic-loop-validation-command-e2e.ps1
npm run compile
```

Results:

- validator selector parser sweep OK.
- validator selector E2E passed.
- cost policy E2E passed.
- delegated agent task E2E passed.
- validation command E2E passed.
- `vscode-extension` `npm run compile` passed.

## Remaining work

- Add a small registry file for project-specific validator overrides.
- Let the delegation policy raise `-Strict` automatically for high-risk VS Code extension changes.
- Add rollback support for multi-file patches before allowing local workers to edit multiple files in one task.
