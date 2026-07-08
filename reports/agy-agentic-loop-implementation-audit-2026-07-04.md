# Local LLM Agentic Loop Implementation Audit (2026-07-04)

This report audits the current local LLM agentic loop implementation in [Intergrated POWER](file:///C:/Users/jsp0/Documents/Intergrated%20POWER). It verifies the functionality of the model selector, artifact preservation mode, and outlines remaining risks and next steps.

---

## 1. Hardware-Aware Model & Context Budgeting

The script [Select-LocalLLMModel.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Select-LocalLLMModel.ps1) successfully implements hardware-aware budgeting:

* **VRAM Monitoring**: Queries `nvidia-smi` to get available VRAM and maps it to a hardware context limit (up to 32,768 tokens).
* **Context Budgeting**: Computes the optimal context (`RecommendedNumCtx`) by taking the minimum of the model's registry limit, the task-scale desired tokens, and the free VRAM limit.
* **OOM Penalties**: Tracks recent OOM/VRAM failures in [local_llm_metrics.csv](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/reports/local_llm_metrics.csv) and applies penalties to unstable candidates.
* **Fallback Support**: Includes a `-NoHardwareSnapshot` flag to bypass GPU checks, defaulting to a conservative 8,192 token limit.

---

## 2. Selector Consumption and Artifact Preservation

The script [Invoke-AgenticLoop.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Invoke-AgenticLoop.ps1) consumes selector output and manages run artifacts:

* **Dynamic Model/Context Selection**: Automatically invokes the selector if `-Model` or `-NumCtx` is omitted, resolving the optimal budget.
* **Override Preservation**: Retains explicit caller model selections while still applying that candidate's recommended VRAM-aware context limits.
* **Artifact Preservation (`-KeepArtifacts`)**:
  * Saves attempt files directly to `reports/agentic-loop-runs/<timestamp>/` (or a custom `-ArtifactDir`).
  * Names prompt/output pairs systematically (e.g., `attempt-1-prompt.md`, `attempt-1-output.md`).
  * Skips temporary file deletion in the `finally` block to preserve logs for auditing.

---

## 3. Remaining Implementation Risks

Audit of the scripts revealed the following correctness and reliability risks:

* **PowerShell 5.1 encoding default (High Risk)**: `Get-Content` reads files without specifying `-Encoding UTF8`. In Windows PowerShell 5.1, this defaults to ANSI, causing silent character corruption (mojibake) of multi-byte characters (e.g., Korean text or special symbols) during patch application.
* **PowerShell-only Syntax Validation (Medium Risk)**: `Test-SearchReplaceSyntax` uses `[scriptblock]::Create($updatedContent)` to parse files. This assumes all target files are PowerShell code. If the target file is JSON, Python, or JavaScript, the parser will fail and reject valid patches.
* **Relative Directory Resolution (Low Risk)**: Resolving relative `$ArtifactDir` paths against `$PWD.ProviderPath` can write artifacts to project subdirectories (e.g., `tests/mock_project/reports/...`) instead of the repository root.
* **Registry Misses for Custom Models (Low Risk)**: Specifying a custom model name not present in the CSV registry causes the budget to fall back to the top-ranked registry model's budget, which may lead to VRAM exhaustion.

---

## 4. Next Two Highest-Value Implementation Steps

To harden the local LLM agentic loop, implement the following two steps next:

### Step 1: Language-Aware Syntax Validation
Modify `Test-SearchReplaceSyntax` in [Invoke-AgenticLoop.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Invoke-AgenticLoop.ps1) to only execute PowerShell AST checks (`[scriptblock]::Create`) when editing `.ps1` or `.psm1` files. For other extensions, implement format-specific checks (e.g., `ConvertFrom-Json` for `.json`) or bypass syntax checks safely.

### Step 2: Fix Windows PowerShell UTF-8 Compatibility
Update all `Get-Content` calls in [Invoke-AgenticLoop.ps1](file:///C:/Users/jsp0/Documents/Intergrated%20POWER/scripts/dispatch/Invoke-AgenticLoop.ps1) to explicitly enforce `-Encoding UTF8` (or use .NET's `[System.IO.File]::ReadAllText` with UTF8 encoding) to prevent multi-byte encoding corruption on older PowerShell environments.
