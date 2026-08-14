# Integrated Power 멀티-AI 브로커

> 구현 규약(최우선): [AGENTS.md](../../AGENTS.md)와 [reuse-map](../reuse-map.md)을
> 먼저 읽고, 기존 VSIX 권위 구현을 재사용하거나 공용 추출한다. 신규 구현은
> ADR과 회귀 테스트가 있을 때만 허용한다. 이 규약은 단계 0~3과 모든 인수
> 기준보다 먼저 적용되며, 스텁·capability 표시·CI 설정만으로 완료 처리하지
> 않는다. 실제 Agy 위임, 실제 로컬 모델 실행, GPU binding, 패키지 실행 증거가
> 필요하다.

Integrated Power는 Antigravity IDE 확장에만 종속되지 않는 loopback 작업 브로커를 제공합니다.

## 현재 연결

- Agy: `agy -p <prompt> --mode accept-edits`로 명시된 작업만 위임합니다.
- 로컬 LLM: D의 `127.0.0.1:11435`를 우선 탐색하고 `qwen3.6:27b`를 기본 선택합니다.
- Codex: 공식 Codex App Server stdio JSON-RPC의 `initialize → thread/start → turn/start` 흐름을 사용합니다.
- Claude/ChatGPT: 공식 MCP 연결 경계를 제공합니다. GUI 자격증명이나 연결되지 않은 대화를 읽지 않습니다.
- Grok: 공식 연결 규격이 확인될 때까지 capability만 표시하고 비활성화합니다.

## 표준 경계

- MCP stdio와 loopback Streamable HTTP `/mcp`
- A2A Agent Card `/.well-known/agent-card.json` 및 `/a2a/tasks`
- AG-UI 작업별 SSE `/v1/tasks/<task-id>/stream`

## 안전한 코드 반영

코드 작성 capability가 있는 위임은 Git worktree에서 수행합니다. 병합은 `merge` 승인 요청이 승인된 뒤에만 실행됩니다. 모든 명령은 revision과 idempotency key를 사용하며, 충돌 시 최신 상태를 덮어쓰지 않습니다.

## 실행 예

```powershell
Invoke-IntegratedPowerBroker.ps1 -Action capabilities
Invoke-IntegratedPowerBroker.ps1 -Action create -Title "작업" -Goal "검증할 목표"
Invoke-IntegratedPowerBroker.ps1 -Action delegate -TaskId "task_..." -Provider "local.openai-compatible" -Prompt "결과를 요약" -ExpectedRevision 1
```
