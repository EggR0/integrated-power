# Security

Do not report private credentials in public issues. If you find a credential exposure, revoke the credential first, then open a minimal issue that describes the affected file type without pasting the secret.

This repository should not contain:

- API keys
- OAuth client secrets
- refresh tokens
- local Antigravity, Codex, Gemini, or browser session databases
- private transcripts
- local quota snapshots
- generated reports with private code or paths

Credential-consuming scripts must read secrets from environment variables, the user's local credential store, or explicit local files that are ignored by Git.
