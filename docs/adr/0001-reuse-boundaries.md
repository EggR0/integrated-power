# ADR 0001: Reuse-first broker boundaries

## Decision

The legacy VSIX selector, runner, telemetry, storage and migration code remain
the authority. The broker owns only task/revision/idempotency/approval/
worktree coordination and delegates provider-specific execution through thin
adapters.

## Rejected alternatives

- A TypeScript hardcoded model ranking cannot reproduce VRAM, compute
  capability, CPU offload, consent, installation size and measured metrics.
- Direct broker `/api/generate` bypasses cold-load, keep-alive, artifact and
  token accounting.
- A second control-center state root splits the event ledger and approvals.
- Hand-written MCP/A2A/AG-UI transport is not accepted where an installed and
  compatible official SDK exists.

## Compatibility and licence

The existing scripts and installed SDKs remain in their current licence
boundaries. Any SDK upgrade must be recorded in the package lock and pass the
protocol tests before replacing an edge implementation.

## Required regression evidence

Selector parity, fake two-GPU routing, physical GPU UUID verification,
canonical state migration, telemetry parity, MCP/A2A/AG-UI compatibility,
approval gates, and VSIX baseline/post-change tests.
