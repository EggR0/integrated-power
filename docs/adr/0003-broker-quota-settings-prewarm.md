# ADR 0003: Canonical quota settings and prewarm arbitration

Date: 2026-10-13
Status: Accepted

## Decision

Persist quota settings, their revision, initialization source, idempotency keys,
and prewarm window claims under the canonical Integrated Power state root. The
broker is the only scheduler and dispatch authority for automatic Once/Always
prewarm. Clients submit a user-triggered request or update settings; they do
not claim a window or report process/timer success themselves.

Settings are normalized by the existing `shared/quota/settings.ts`
`mergeQuotaSettings` helper. The broker adds persistence and revision checks,
not a second settings schema. Existing master notification state and all eight
per-target/per-window notification booleans remain distinct. Per-target
prewarm modes are additive while retaining the legacy single `prewarmMode`
field for existing UIs.

## Candidates considered

- Reuse IDE global configuration and desktop localStorage independently:
  rejected because the programs continue to disagree and duplicate automatic
  prewarm for one quota window.
- Treat the desktop localStorage copy as authoritative:
  rejected because Integrated Power can run headless or with the desktop
  closed, and IDE-owned settings are lost.
- Reuse the existing `/prewarm` route without persisted arbitration:
  rejected because each client can dispatch for the same target/window, and
  Once mode can be consumed before a process starts.
- Add a third-party scheduler or settings package:
  rejected because the existing broker owns loopback APIs and durable state,
  while `shared/quota/settings.ts` already defines compatible normalization.

## Compatibility and safety

The implementation uses only existing TypeScript/Node APIs and the project's
existing shared quota module, whose license is covered by the repository's
root license and commercial notice. Existing public response fields and the
legacy `/prewarm` route remain. Missing/unknown settings normalize to click;
only an explicit IDE migration at uninitialized revision zero may seed old
IDE values. The desktop may initialize defaults only after an explicit save.
Revision conflicts return the current state without overwriting it. A
prewarm idempotency key is checked before revision conflict handling. Once is
consumed only after a child `spawn` event; timer completion is not represented
as confirmed.

## Regression evidence

`scripts/run-broker-tests.js` covers first-seed precedence, per-target and
master notification preservation, stale revision/idempotency, concurrent
same-window requests, retry after failed spawn, Once behavior, and a fake
dispatcher that never starts a real model CLI. `scripts/test-quota-core.js`
continues to cover the shared normalization contract.
