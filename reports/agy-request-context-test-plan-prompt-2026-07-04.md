# AGY Task: REQUEST_CONTEXT Test Plan

Workspace: `C:\Users\jsp0\Documents\Intergrated POWER`

Create or overwrite:

- `reports/agy-request-context-test-plan-2026-07-04.md`

Do not modify code files.

Read the current local agentic loop files:

- `scripts/dispatch/Invoke-AgenticLoop.ps1`
- `scripts/dispatch/New-ContextManifest.ps1`

Produce a concise test plan for a minimal `REQUEST_CONTEXT` implementation where:

- local LLM output may be either `SEARCH/REPLACE` or `REQUEST_CONTEXT`;
- a `REQUEST_CONTEXT` output asks for a file path, preferably with a `file:` line;
- the loop adds that file to context and retries rather than failing schema validation;
- no patch should be applied on a context request turn;
- artifacts should preserve both the request turn and the later patch turn.

Include exact PowerShell commands and expected evidence.
