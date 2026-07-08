# AGY Task: Implement Minimal REQUEST_CONTEXT Support

Workspace: `C:\Users\jsp0\Documents\Intergrated POWER`

Directly modify only this file:

- `scripts/dispatch/Invoke-AgenticLoop.ps1`

Goal:
Add minimal `REQUEST_CONTEXT` support to the local agentic loop.

Requirements:

1. The local LLM output may be either a normal `SEARCH/REPLACE` patch or a context request:

```text
REQUEST_CONTEXT
file: <path>
reason: <optional text>
```

2. Update the parser so it returns typed objects:
   - patch object: `Success=$true`, `Type="Patch"`, `Search`, `Replace`
   - context object: `Success=$true`, `Type="ContextRequest"`, `File`, `Reason`
   - invalid object: current behavior is fine

3. If one or more context request objects are returned:
   - do not apply any patch on that attempt
   - resolve relative requested file paths against the current working directory
   - if `file:` is missing, use `$TargetFile`
   - if the file exists, append it to `$Files` and de-duplicate
   - rebuild `$manifest` via `New-ContextManifest.ps1`
   - append a concise grant message to `$feedback`
   - increment `$attempt` and continue
   - if requested file is missing, append a concise denial message to `$feedback`, increment attempt, continue

4. Update both system prompt branches so local LLMs know valid outputs are:
   - `SEARCH/REPLACE` when enough context is available
   - `REQUEST_CONTEXT` when more file context is required

5. Preserve existing behavior:
   - SEARCH/REPLACE validation
   - model auto-selection
   - KeepArtifacts
   - metrics
   - syntax validators

6. Keep the patch small and conservative.

After editing, create or overwrite:

- `reports/agy-request-context-implementation-summary-2026-07-04.md`

Summarize exactly what changed and any caveats.
