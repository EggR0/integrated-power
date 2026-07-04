# AI Workflow Project Rules

This repository is the control workspace for managing AI-assisted coding work across Antigravity IDE, Codex, MCP servers, and local GPU preprocessing.

## Operating Principles

- Treat Antigravity IDE as the hands-on coding surface where the user reviews diffs and accepts changes.
- Treat Codex as a delegated worker for bounded implementation, review, debugging, and test-generation tasks.
- Prefer worktrees, branches, or read-only analysis for automated or scheduled jobs.
- Do not modify external repositories, global configuration, credentials, or deployment targets unless the user explicitly asks for that exact action.
- Keep token use intentional: pick queued work that matches the current remaining quota window instead of trying to consume quota for its own sake.
- Always produce an artifact for delegated work: a report, patch summary, test result, or checklist with file paths.

## Verification Expectations

- For code changes, run the relevant tests or explain exactly why they could not be run.
- For UI work, capture or request a browser verification step.
- For read-only audits, include evidence: file paths, commands inspected, and confidence level.
- For automated jobs, write outputs under `reports/` unless the user asks for another destination.

## AI Communication & Skill Priority

- **Startup Awareness**: At the start of any conversation, recognize that you have active access to the Codex model and a local vLLM server. You can freely initiate debates, code reviews, or architectural planning with them.
- **Skill over MCP**: When the user asks to brainstorm, debate, or review code with Codex, **DO NOT** use the raw `codex` MCP tool by default. You MUST use the `codex-transparent-debate` skill (which runs `Invoke-CodexDebate.ps1`). This leaves a visible Markdown trace in `discussions/` so the user can follow along transparently.
- **vLLM Integration**: For offline preprocessing, summarization, or local model execution, use `scripts/dispatch/Invoke-vLLMJob.ps1` to invoke the OpenAI-compatible local endpoint.
- **Feature Implementation Rule (CCW v3)**: For new features or ambiguous structural changes, initiate the `codex-transparent-debate` workflow (`scripts/dispatch/Invoke-CodexDebate.ps1`). Pass relevant repository paths via `-ContextFile` (do NOT embed file contents). In the initial debate turn, instruct Codex to focus on architectural review without generating full code. Once consensus is reached, implement the feature.
- **Codex Delegation & Code Generation Judgment**: Do not permanently restrict Codex from writing code. Antigravity MUST use its own judgment to determine when Codex should generate full code:
  1. **Post-Debate Implementation**: After consensus, Antigravity can delegate heavy coding tasks to Codex.
  2. **Direct Delegation (Heavy)**: If a task requires writing large boilerplate, massive refactoring, or extensive test generation, Antigravity may bypass the "No Code" debate and instruct Codex to write the full code immediately.
  3. **FastTrack (Trivial)**: For obvious bug fixes or single-file edits, bypass CCW and implement directly or ask Codex for the patch.
  Always balance token economy with the necessity of Codex's raw coding power.
- **Main Agent Token Conservation (50/50 Balance)**: Antigravity MUST aggressively conserve its own output tokens. Do not write lengthy conversational replies or summaries to the user. Shift the heavy generation burden to Codex.
- **Zero-Token Direct Edit Protocol (Codex Implementation)**: To achieve absolute zero output token consumption during heavy implementation, instruct Codex to **directly overwrite target files using its own write permissions** (e.g., via `Invoke-CodexJob.ps1`). You must ensure strict file-level boundaries (e.g., "Antigravity edits backend files, Codex edits frontend files") to prevent overlapping write conflicts. Do NOT ask Codex to output code blocks into the discussion file if the goal is final implementation; tell it to modify the files directly. Use `scripts/util/Extract-CodeBlock.ps1` ONLY as a safe fallback if Codex accidentally prints code instead of writing it.
