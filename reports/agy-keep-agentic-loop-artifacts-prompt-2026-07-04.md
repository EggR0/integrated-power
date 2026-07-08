# AGY Task: Implement Agentic Loop Artifact Preservation

You are working in `C:\Users\jsp0\Documents\Intergrated POWER`.

Directly implement a small, bounded code change. Do not rewrite the whole script.

Target file:
- `scripts/dispatch/Invoke-AgenticLoop.ps1`

Goal:
Add an optional artifact preservation mode so Agentic Loop runs can keep the exact prompt and local LLM output files used for each attempt. This supports auditability and reduces the need for the top-level agent to restate local LLM outputs.

Requirements:
1. Add parameters:
   - `[switch]$KeepArtifacts`
   - `[string]$ArtifactDir = ""`
2. Preserve current default behavior when `-KeepArtifacts` is not passed:
   - use `New-TemporaryFile`
   - delete temp prompt/output files in `finally`
3. When `-KeepArtifacts` is passed:
   - if `-ArtifactDir` is blank, create a run directory under `reports\agentic-loop-runs\<yyyyMMdd-HHmmss>`
   - if `-ArtifactDir` is relative, resolve it under the repo root/current working directory
   - create one prompt and one output file per attempt, e.g. `attempt-1-prompt.md`, `attempt-1-output.md`
   - do not delete those files in `finally`
   - print the artifact directory path once near the start of the run
4. Keep existing behavior for model auto-selection, validation, patch application, and metrics.
5. Do not modify any other file.

After editing, briefly summarize what changed and any command you ran.
