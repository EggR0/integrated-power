# Local Agentic Worker Contract

## Purpose

Use the workspace delegation bridge for local coding edits so Antigravity/Gemini does not spend broad output tokens generating code directly.

This mode is for repository file writes. Raw `Invoke-LocalLLM.ps1` remains for preprocessing, summaries, extraction, and review artifacts that do not edit files.

## Workspace Entrypoint

Preferred script:

```text
scripts/dispatch/Invoke-DelegatedAgentTask.ps1
```

Default backend:

```text
WorkerBackend Auto
```

`Auto` lets the bridge choose Aider/local Ollama worker when appropriate and fall back to the safer existing backend when Aider is unavailable.

For medium, multi-file, high-risk, or local-resource-risky file edits, Aider-unavailable fallback is not automatic. The bridge returns `ManualReviewRequired` unless the caller explicitly passes `-AllowAgenticLoopFallback`.

## Preferred Antigravity Invocation

When calling from Antigravity or another wrapper, avoid inline PowerShell arrays. Write the prompt and file list to UTF-8 files, then call:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File ".\scripts\dispatch\Invoke-DelegatedAgentTask.ps1" `
  -PromptFile ".\reports\ai-router-runs\<run-id>\prompt.md" `
  -FilesListFile ".\reports\ai-router-runs\<run-id>\files.txt" `
  -TargetFile ".\path\to\primary-file.ext" `
  -RequiresFileWrite `
  -WorkerBackend Auto `
  -PreferCloudTokenConservation `
  -ValidatorProfile auto `
  -KeepArtifacts
```

`files.txt` should contain one target file path per line. Use paths relative to the workspace root when possible.

## Minimal Inline Invocation

For a small single-file task, inline arguments are acceptable:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File ".\scripts\dispatch\Invoke-DelegatedAgentTask.ps1" `
  -Prompt "Change the target file exactly as requested." `
  -TargetFile ".\tests\fixture.ps1" `
  -Files ".\tests\fixture.ps1" `
  -RequiresFileWrite `
  -WorkerBackend Auto `
  -PreferCloudTokenConservation `
  -ValidatorProfile auto
```

## Safety Rules

- Always pass an explicit file list.
- Start with one small file for first-run checks.
- Do not pass broad repo roots as editable files.
- Do not use raw `Invoke-LocalLLM.ps1` for file edits.
- Do not silently retry a failed Aider edit by asking the same model to produce a huge diff again.
- Do not silently fall back from unavailable Aider to the hand-rolled AgenticLoop for medium, multi-file, high-risk, or local-resource-risky edits.
- If validation fails, report the artifact paths and do not claim success.

## Destructive Operations

Delete, move, rename, and broad overwrite tasks are destructive.

Default behavior:

```text
ManualReviewRequired
```

Do not force these tasks through Aider/local LLM by default. Narrow the file set, confirm the user actually wants destructive edits, and only then rerun with:

```powershell
-AllowDestructive
```

Prefer direct IDE edits or Codex review for destructive structural cleanup, then use the local worker for follow-up mechanical edits.

## Expected Report

After execution, read the JSON/stdout, decision CSV, and artifact logs. Report:

```text
backend=<Aider|AgenticLoop|ManualReviewRequired>
model=<model if available>
files=<changed files>
validation=<passed|failed|skipped>
artifacts=<paths>
next=<recommended next action>
```

Relevant artifacts:

- `reports/delegation-decisions.csv`
- `reports/aider-worker-runs/.../aider-output.log`
- `reports/aider-worker-runs/.../aider-prompt.md`
- validation output log when present
