# Public Repository Rules

This repository is the public, sanitized version of Integrated Power.

## Operating Principles

- Treat Antigravity IDE as the primary human-facing control surface.
- Treat Codex, Gemini, local LLMs, and vLLM endpoints as separate backend workers with separate credentials and quotas.
- Prefer the smallest reliable route for the task.
- Keep all generated reports, transcripts, packaged artifacts, credentials, and machine-specific state out of Git.
- Do not hard-code personal Windows paths, account names, GPU UUIDs, private repository names, or API keys.
- For public examples, use placeholders such as `%USERPROFILE%`, `<repo-root>`, `<codex.exe>`, and `<model-name>`.

## Routing

- Main agent direct: small edits, local inspection, simple command checks, and packaging.
- Local LLM/vLLM: summarization, extraction, classification, Korean/text preprocessing, and low-risk draft artifacts.
- Codex debate: architecture decisions, tradeoffs, and read-only critique.
- Codex job: bounded implementation, difficult debugging, tests, and review requiring strong coding judgment.
- Antigravity IDE: final user-visible review and acceptance.

## Verification

- Run relevant tests for code changes.
- For the dashboard extension, run `npm test` from `vscode-extension/`.
- For scripts, run PowerShell parser checks before release.
- Scan for private paths and secret-like strings before publishing.
