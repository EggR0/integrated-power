# Implementation Summary: Minimal REQUEST_CONTEXT Support

This document details the changes made on **July 4, 2026**, to support minimal `REQUEST_CONTEXT` functionality within the local agentic loop system.

## Changes Overview

Directly modified file:
- [Invoke-AgenticLoop.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Invoke-AgenticLoop.ps1)

### 1. Updated LLM Output Parser (`Test-SearchReplacePatch`)
The local LLM parser in [Invoke-AgenticLoop.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Invoke-AgenticLoop.ps1#L109-L149) was updated to parse either `SEARCH/REPLACE` blocks or `REQUEST_CONTEXT` blocks.
- **Patches**: Returns objects with `Success=$true`, `Type="Patch"`, `Search`, and `Replace`.
- **Context Requests**: Returns objects with `Success=$true`, `Type="ContextRequest"`, `File`, and `Reason`.
- **Invalid Formats**: Returns the current error object if neither could be extracted.

A robust block-based regular expression is used to extract `REQUEST_CONTEXT` blocks and isolate files/reasons regardless of line order:
```regex
(?mi)^REQUEST_CONTEXT[ \t]*(?:\r?\n(?!\s*(?:REQUEST_CONTEXT|SEARCH:))[^\r\n]*)*
```
This parses lines matching:
```text
REQUEST_CONTEXT
file: <path>
reason: <optional text>
```

### 2. Implemented Main Loop Routing for Context Requests
When one or more `ContextRequest` objects are identified in the LLM output:
- **Skip Patches**: Patch validation and application are entirely skipped for that attempt.
- **Path Resolution**: Relative paths are resolved against the current working directory (`$PWD.ProviderPath`). If the `file:` key is missing or blank, `$TargetFile` is used as the fallback.
- **De-duplication**: If the file exists, it is appended to `$Files` and de-duplicated using `Select-Object -Unique`.
- **Manifest Rebuilding**: The manifest is rebuilt using [New-ContextManifest.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/New-ContextManifest.ps1).
- **Feedback Logging**: A concise grant message (`Granted context for file: '...'`) is appended to `$feedback`.
- **Denial Logging**: If the file is missing/not found, a concise denial message is appended to `$feedback`.
- **Retry Increments**: `$attempt` is incremented by 1, and `continue` transitions execution to the next attempt loop.

### 3. Updated Success Verification Regex
Modified the `-SuccessRegex` parameter passed to [Invoke-LocalLLM.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Invoke-LocalLLM.ps1):
- **Old Regex**: `"SEARCH:\s*[\s\S]+?REPLACE:"`
- **New Regex**: `"(SEARCH:\s*[\s\S]+?REPLACE:|REQUEST_CONTEXT)"`
This ensures `Invoke-LocalLLM.ps1` classifies context request outputs as successful inferences in the metrics logging database.

### 4. Updated System Prompts
Both system prompt branches (when `$Files` is defined and when it is empty) in [Invoke-AgenticLoop.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Invoke-AgenticLoop.ps1#L256-L322) were updated. Local LLMs are now informed of the two valid output formats (`SEARCH/REPLACE` and `REQUEST_CONTEXT`) and the formatting rules for both.

---

## Caveats and Limitations

1. **Retry Count Consumption**: Each context request counts towards `$MaxRetries` (default: 3). If a task requires multiple context requests sequentially, the loop might exhaust its retry attempts.
2. **Missing Files**: Missing files do not halt the loop immediately; they record a denial message in the feedback and increment the attempt counter, allowing the model to try referencing a different file.
3. **Regex Constraints**: The block parsing regular expression depends on horizontal whitespaces (`[ \t]*`) to handle trailing line spaces cleanly without eating up the next line's newline characters.
