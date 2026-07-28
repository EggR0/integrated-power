# Job Mode Contract

**Script**: `scripts/Invoke-CodexJob.ps1`

## Purpose
Execute a bounded implementation, heavy automated refactoring, or a single intensive task directly without conversational overhead. Used for "Zero-Token Direct Edit Protocol".

## Usage
- Provide the instruction via `-PromptFile`.
- Provide the output destination via `-OutputFile`.
- Select the appropriate `-Sandbox` (`workspace-write` is usually needed if Codex is meant to directly edit the codebase).

## Output
- The final Codex response is written to `-OutputFile` (or automatically to Integrated Power workspace state `reports/codex-<stamp>.md`).
- Optionally logs usage metrics if `-JsonLog` is provided and the parser script is available.
