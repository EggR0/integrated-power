# ADR 0002: Shared workspace telemetry reader

- Status: Accepted for desktop/IDE integration
- Date: 2026-10-13

## Decision

Extract the existing VSIX JSONL run normalization/merge and quoted-CSV reader into
`shared/telemetry/runState.js`. `RunStore` remains a thin VS Code filesystem
adapter; the broker and desktop can consume the same pure functions against the
canonical workspace files.

## Candidates considered

- Reuse standalone `broker/runScanner.ts`: rejected because it guesses CWD,
  parent, and hard-coded project roots and uses naive CSV splitting.
- Copy the VSIX parsers into the broker: rejected because separate parser
  implementations would drift and produce inconsistent run/artifact state.
- Add an external CSV parser dependency: rejected because the current project
  parser already has the required quoting behavior and no compatibility gap was
  demonstrated. This extraction adds no package or transitive dependency.

## Compatibility and licensing

The module stays inside this repository and uses the existing TypeScript/Node
toolchain and project-owned parsing behavior; there is no newly imported code or
third-party license to reconcile. It exposes data-only functions without VS Code,
Node filesystem, selector, transport, or executable-discovery dependencies.

## Regression evidence

`scripts/run-broker-tests.js` covers run delta merge, malformed JSONL preservation,
quoted commas, escaped quotes, multiline CSV, workspace scoping, missing metrics,
and isolated loopback HTTP reads. `RunStore.ts` delegates to these same functions.
