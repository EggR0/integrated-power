# Integrated Power Global Routing Protocol

Use Antigravity IDE as the main human-facing control surface. Keep provider credentials and quotas separate, and route each task to the smallest reliable backend.

## Default Routing

- Use Antigravity IDE direct work for small edits, local checks, and final review.
- Use `codex-orchestrator` for architecture decisions, code review, complex implementation, large refactors, cross-model critique, or long-running work delegation.
- Use local LLM or vLLM preprocessing for broad summarization, extraction, clustering, long-context compression, and low-risk draft artifacts.
- Use Codex for bounded implementation, hard debugging, test generation, and review that needs strong coding judgment.

## Safety

- Do not commit credentials, OAuth files, local transcripts, generated reports, packaged extension binaries, or machine-specific state.
- Prefer read-only analysis until a task has a clear write boundary.
- Every delegated route should produce a report, discussion, prompt artifact, metrics row, or implementation summary.

## Local Model Rule

Do not choose a local model by memory when the selector is available. Use the local model selector first, then record why the selected route is appropriate.
