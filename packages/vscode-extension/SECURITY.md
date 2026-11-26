# Security Policy

## Supported versions

| Version | Status |
|---|---|
| 0.7.x | Security support begins when the first public release is published |
| 0.6.x and earlier | Internal stabilization builds; no public security support |

## Report a vulnerability privately

Do **not** disclose a suspected vulnerability, exploit, credential, private
path, private repository URL, log containing personal data or reproduction
secret in a public GitHub issue.

Use GitHub private vulnerability reporting:

1. Open the public repository on GitHub.
2. Select **Security** and then **Advisories**.
3. Select **Report a vulnerability**.
4. Submit the minimum information needed to reproduce and assess the issue.

GitHub documents this private reporting flow in
[Privately reporting a security vulnerability](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability/).

If the private reporting button is unavailable, do not put vulnerability details
in a public issue. Wait for the private channel to be enabled or use a
maintainer-provided private channel.

## What to include

- affected Integrated Power and Antigravity IDE versions
- Windows version and architecture
- affected feature: Dashboard, Integrated Orchestrator installer,
  Configuration Center or Private Git Knowledge integration
- impact and reproducible steps
- whether secrets, arbitrary files or code execution are involved
- a redacted log or minimal proof of concept

Remove access tokens, refresh tokens, passwords, API keys, private keys, user
Knowledge content, full prompts, absolute home paths and unrelated personal data.

## Security boundaries

When a Windows user has signed in to Agy, Integrated Power reads the local Agy
credential from Windows Credential Manager in a local process and uses it to
query the usage API. If an expired credential must be refreshed, the local
process uses the installed Agy client information for that authentication
request.

Actual access-token and refresh-token values are not written to Integrated Power
settings, logs or the public repository. They remain in local process memory for
the usage request and any required authentication refresh. Reports must never
include those values.

Integrated Power does not create or replace `GEMINI.md`, automatically install
third-party CLIs or drivers, or silently commit and push a user Knowledge
repository.

Vulnerabilities in Antigravity IDE, operating-system components and third-party
CLIs should also be reported to the owner of the affected component.
