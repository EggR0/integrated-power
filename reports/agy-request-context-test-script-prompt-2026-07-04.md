# AGY Task: Create REQUEST_CONTEXT E2E Test Script

Workspace: `C:\Users\jsp0\Documents\Intergrated POWER`

Use `Gemini 3.1 Pro (High)` via the wrapper default.

Create or overwrite this file only:

- `tests/run-request-context-e2e.ps1`

Do not modify production scripts.

The test script should:

1. Set `$ErrorActionPreference = "Stop"`.
2. Resolve the repo root from the script location.
3. Create a temporary test project under `tests/request_context_script_e2e`.
4. Create:
   - `main.ps1` containing `Write-Host "Hello Request Context Script"`
   - `moduleA.ps1` containing a simple helper function.
5. Temporarily back up `scripts/dispatch/Invoke-LocalLLM.ps1`.
6. Replace `Invoke-LocalLLM.ps1` with a mock that:
   - On attempt 1, if the prompt does not contain `Get-ScriptContext`, writes:
     `REQUEST_CONTEXT` plus `file: <absolute path to moduleA.ps1>`
   - On attempt 2, when the prompt includes `Get-ScriptContext`, writes a valid `SEARCH/REPLACE` patch that changes main.ps1 to `Write-Host "Hello Request Context Script with moduleA"`.
7. Run `scripts/dispatch/Invoke-AgenticLoop.ps1` with:
   - target `main.ps1`
   - only `main.ps1` initially in `-Files`
   - `-KeepArtifacts`
   - a deterministic `-ArtifactDir`
   - `-NoHardwareSnapshot`
8. Restore the original `Invoke-LocalLLM.ps1` in a `finally` block even on failure.
9. Assert:
   - final main.ps1 content changed correctly;
   - `attempt-1-output.md` contains `REQUEST_CONTEXT`;
   - `attempt-2-prompt.md` contains `moduleA.ps1` and `Get-ScriptContext`;
   - `attempt-2-output.md` contains `SEARCH:`.
10. Print a compact pass summary and exit non-zero on failure.

Keep the script Windows PowerShell 5.1 compatible.
