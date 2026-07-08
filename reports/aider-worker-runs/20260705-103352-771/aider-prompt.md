Create a PowerShell script at `scripts/dispatch/Test-SerenaCapability.ps1` according to the Phase 1 design in `reports/serena-background-local-llm-design-2026-07-05.md`.

The script should:
1. Detect if the `serena` CLI is available.
2. Run a basic health check (e.g. `serena project health-check`).
3. Write a JSON capability report to `reports/serena-background/capability.json` indicating whether Serena is available, if the CLI was found, and the health check result.
4. Ensure the output directory exists before writing using PowerShell.


Operational constraints:
- Edit only the files explicitly provided to aider for this run.
- Do not commit changes.
- Keep the patch minimal and directly related to the request.
