# Integrated Power reuse map

This is the required pre-edit inventory. Every implementation change must
update the row and link its proof test.

| Requirement | Existing authority | Connection/decision | Proof |
|---|---|---|---|
| Local model selection | `vscode-extension/assets/ip-orchestrator-plugin/skills/ip-orchestrator/scripts/Select-LocalLLMModel.ps1` | Broker calls selector; no hardcoded ranking | PowerShell selector tests + broker delegation |
| Local inference | `Invoke-LocalLLM.ps1`, `Invoke-vLLMJob.ps1` | Local adapter invokes the existing runner and reads its coalesced artifact | invocation/metrics test |
| GPU placement | selector hardware inventory and `Invoke-LocalLLM.ps1` startup path | preserve free VRAM policy; carry index/UUID; mismatch is approval-gated | fake 2-GPU + physical UUID test |
| Agy executable | `configurationModel` executable resolution and Agy CLI bridge | shared resolver, thin `AgyCliAdapter` | discovery/delegation test |
| Codex | `codexAppServer.ts` and App Server stdio | retain official stdio adapter | stdio integration test |
| Usage/quota | `TokenManager`, `DashboardController`, `AgyQuotaClient`, `RunStore` | shared telemetry service; same canonical state root | VSIX/Tauri parity test |
| Quota calculation/formatting | `vscode-extension/webview/main.js` quota pure functions (`calculateEffective5HourQuota`, `K_CAPACITY_RATIOS`, `capacityTone`, `formatRefreshCountdown`, `clamp`, `toFiniteNumber`) | moved to `shared/quota/` (TS, DOM/Node-free); webview consumes via IIFE bundle `webview/quota-core.js` (`window.IPQuota`), control-center via vite alias `@shared/quota`; renderers remain per-program (innerHTML vs DOM API) | `vscode-extension/scripts/test-quota-core.js` + reuse gate |
| Paths/migration | `storagePath.ts`, `Ensure-IpOrchestratorSetup.ps1` | broker and Tauri use canonical IntegratedPower state | migration test |
| MCP | official `@modelcontextprotocol/sdk` when compatible | SDK boundary; custom method switch is temporary legacy only | protocol compatibility test |
| A2A | installed `@a2a-js/sdk` 1.0.1 | use SDK client/server edge | A2A card/send/stream test |
| AG-UI | official `@ag-ui/core` when compatible | core event schema at stream boundary | event validation test |
| Secrets | VSIX `ExtensionContext.secrets`; Tauri Stronghold/OS keyring | inject platform store; no duplicate credential code | secret isolation test |
| Worktrees/approval | new broker functionality | retain revision/idempotency, isolated worktree, approval queue | concurrency/approval tests |

No row may be marked complete by a stub, capability display, or static type
alone. If an authority cannot be reused, record the reason in an ADR before
introducing custom code.
