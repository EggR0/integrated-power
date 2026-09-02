# Quota UI Parity 명세서 — IDE 확장 ↔ Control Center(데스크톱)

> 목적: control-center(데스크톱)의 quota 화면에 IDE 확장(webview 대시보드)에서
> 검증된 quota 기능을 이식할 때 구현이 헷갈리지 않도록, 양 프로그램의 기능 목차와
> 데이터 플로우를 고정한다. 이 문서가 없으면 `docs/reuse-map.md`에 항목 없이
> 구현을 시작할 수 없다 (AGENTS.md 계약).

- 작성일: 2026-09-02
- 대상 파일:
  - IDE: `vscode-extension/webview/main.js` (렌더링), `src/TokenManager.ts` (데이터), `src/DashboardController.ts` (상태)
  - 데스크톱: `control-center/index.html`, `control-center/src/main.js`
  - 중계: `vscode-extension/src/broker/server.ts` + `broker/tokenScanner.ts` (`GET /v1/tokens/status`)

---

## 1. 데이터 플로우 (현재 실제 구조)

```
IDE TokenManager ──쓰기──▶ %LOCALAPPDATA%/IntegratedPower/state/token_status.json
                                        │
                    ┌───────────────────┤
                    ▼                   ▼
          IDE webview              broker scanLiveTokenStatus()
          (DashboardController)    → GET /v1/tokens/status (port 37241)
           직접 상태 사용                     │
                                             ▼
                                   control-center main.js
                                   (5초 폴링, state.tokenStatus)
```

- 데스크톱은 quota 원본을 직접 읽지 **않는다**. IDE가 쓴 `token_status.json`을
  broker가 변환해 내보내는 값만 본다. → **필드가 빠지면 데스크톱 UI는 못 만든다.**
- broker 폴백: IDE 상태 파일이 없으면 `scanCodexQuota()` + GPU live scan으로
  독립 운영 (antigravity/opus는 `undefined` 반환).

### 1.1 `GET /v1/tokens/status` 응답 실측 필드 (2026-09-02 확인)

| 필드 | IDE webview가 쓰는 필드 | broker 응답에 포함? |
|---|---|---|
| `*Percentage` (antigravity/opus/codex ± weekly) | ✅ | ✅ |
| `*ResetTime` / `*WeeklyResetTime` | ✅ | ✅ |
| `taskRouting` / `recommendedTaskWeight` | ✅ | ✅ |
| `localComputeStatus.gpus[]` (util/vram/power) | ✅ | ✅ |
| `directUsage` (Claude today/7d) | ✅ | ✅ |
| `activity[]` | ✅ | ✅ |
| `*TokensLeft` / `*Max` (6종) | ✅ (절대량 표시) | ❌ **없음** (json에는 0) |
| `*EstimatedAbsolute` (3종) | ✅ | ❌ 없음 |
| `quotaPools[]` (`source`, `confidence`) | ✅ (출처 구분) | ❌ 압축되어 보너스 필드로 사라짐 |
| `localComputeStatus.endpointHealth` / `loadedModels` / `programName` | ✅ (서버 배지) | ❌ 없음 (status/modelName만 합쳐 보냄) |
| `claudeDirectUsage.status` / `sources` / `errors` | ✅ | ⚠️ 일부 (status·sources 누락) |
| `errors[]` (상위) | ✅ | ❌ 없음 |

**결론**: parity를 위해 broker 응답 스키마를 먼저 확장해야 한다
(`tokenScanner.scanLiveTokenStatus()`가 json의 원본 필드를 그대로透과하도록).
UI만 만들고 데이터가 없으면 모든 항목이 "Waiting" 상태에 묶인다.

---

## 2. 기능 목차 대조표 (quota 관련)

✅ = 있음 · ❌ = 없음 · ⚠️ = 부분/의미가 다름

### 2.1 표시(렌더링)

| # | 기능 | IDE webview | Control Center | 비고 |
|---|---|:---:|:---:|---|
| A1 | Provider별 5h + Weekly 이중 바 | ✅ | ✅ | |
| A2 | 리셋 카운트다운 (3단계 축약: full/medium/short) | ✅ `formatRefreshCountdown` | ⚠️ 단일 `formatCountdown` | IDE는 `d h m` / `Xh` / `·151h` 단계 축약 + 24h 초과 간소화 |
| A3 | 5h↔Weekly **K-capacity 동기화** | ✅ `calculateEffective5HourQuota` | ❌ | weekly가 5h를 상한(cap)으로 삼음. K 비율: antigravity 5.0, opus 4.5, codex 4.0, 기본 4.5. weekly=0 → 5h를 0%로 잠금 + **리셋 시각을 weekly 쪽으로 교체** |
| A4 | 절대 토큰 표시 (`left / max`, EstimatedAbsolute 폴백) | ✅ | ❌ | 현재 json의 `*TokensLeft/*Max`가 0이라 IDE에서도 "Waiting" — 데이터 파이프(A3-1.1)가 먼저 |
| A5 | Best / Lowest 요약 필 (6개 윈도우 정렬) | ✅ `renderCapacitySummary` | ❌ | |
| A6 | 상태 톤(색) 임계: Healthy >35% / Caution 15–35% / Limited ≤15% | ✅ `capacityTone` | ⚠️ codex weekly <20%에만 `warning` 클래스 | 임계값 불일치(20 vs 15) — 통일 필요 |
| A7 | tooltip (남은 %·리셋·건강도 설명, capped/exhausted 문구) | ✅ | ❌ | |
| A8 | 로컬 LLM 서버 배지 (Active·모델 / Ready / Offline) | ✅ (`endpointHealth`+`loadedModels`) | ⚠️ `local-llm-status-tag`만 | broker가 필드를 보낼 때 가능 |
| A9 | 3단계 반응형 축약 (Full/Medium/Short, 290/215px) | ✅ | ❌ (고정 폭 — 불필요) | 데스크톱은 불필요. 이식 제외 |
| A10 | "실측(measured) vs 계산 vs 추정" 출처 구분 | ✅ (`quotaPools[].source/confidence`, Claude `status`) | ⚠️ Claude만 "Measured/No data" 태그 | |

### 2.2 동작(비렌더링)

| # | 기능 | IDE | CC | 비고 |
|---|---|:---:|:---:|---|
| B1 | 자동 폴링 | ✅ 5초 | ✅ 5초 (설정에서 변경 가능) | CC가 오히려 더 좋음 — 유지 |
| B2 | 수동 즉시 새로고침 (force) | ✅ (`forceRefresh` → live probe 우회, 캐시 TTL 5s) | ⚠️ 버튼은 있으나 broker가 force 파라미터를 무시 | `/v1/tokens/status`가 query 무시 — broker에 `?force=1` 처리 추가 필요 |
| B3 | 100% 완충 알림 (chime + desktop notification + toast) | ✅ | ✅ | 양쪽 동일 로직 — parity 유지 |
| B4 | 작업 라우팅 배지 (normal/degraded/critical) | ✅ | ✅ | |
| B5 | View Settings (패널별 표시/숨김, localStorage 영속) | ✅ | ❌ | desktop은 탭 구조라 패널 토글이 아니라 **provider 블록 토글**로 설계 |
| B6 | refreshing 애니메이션/스켈레톤 | ✅ | ❌ | |

### 2.3 데스크톱에 **이미 있어** 가져올 필요가 없는 것

- Tasks/Approvals 위임·승인 UI, Agents 진단, Runs 타임라인, Logs 뷰,
  AutoStart, MCP spec 복사, Claude 자동 등록. (IDE에는 없는 CC 고유의 기능)

---

## 3. 이식 대상 (우선순위)

| 순위 | 항목 | 의존 |
|---|---|---|
| P1 | A3 K-capacity 동기화 + A6 톤 임계 통일 + A2 카운트다운 3단계 | broker 필드 불필요 (기존 percentage만 있으면 동작) |
| P2 | broker 응답 스키마 확장 (§1.1: TokensLeft/Max, quotaPools, endpointHealth/loadedModels, claude status/sources, errors) | — (tokenScanner.ts 수정) |
| P3 | A4 절대 토큰 표시 + A5 Best/Lowest 요약 + A7 tooltip | P2 |
| P4 | A8 로컬 LLM 서버 배지 (IDE의 미커밋 변경과 동일한 로직) | P2 |
| P5 | B2 force refresh (`?force=1` → broker가 IDE 캐시 무시) | — |
| P6 | A10 출처 구분 표시 + B5 provider 블록 토글 | P2 |

> A9(반응형 축약)는 데스크톱에 불필요 — 제외. B1·B3·B4는 이미 parity — 유지.

---

## 4. 구현 가이드 (재사용 순서 준수) — AS-BUILT (2026-09-02, P1·구조 완료)

### 완료된 구조

```
shared/quota/            (TypeScript, DOM·Node 의존 0 — single source of truth)
  capacity.ts            K_CAPACITY_RATIOS, K_DEFAULT_RATIO, capacityTone,
                         clamp, toFiniteNumber, calculateEffective5HourQuota
  format.ts              formatRefreshCountdown(3단계), formatNumber,
                         formatTokenCount, formatResetTime
  settings.ts            QuotaSettings 스키마 + 기본값 + mergeQuotaSettings,
                         clampPollInterval
  index.ts               재수출

vscode-extension/webview/
  quota-core.js          esbuild IIFE 번들 (globalName: IPQuota → window.IPQuota)
                         — build-extension.js가 매 컴파일 시 자동 재생성
  main.js                원본 함수 8개를 window.IPQuota 위임으로 교체 (호출 사이트 불변)
control-center/
  vite.config.js         alias @shared/quota → shared/quota/index.ts
  src/main.js            renderTokens가 shared K-sync 사용:
                         - 5h 표시값 = calculateEffective5HourQuota(...)의 effectivePct
                         - weekly=0 → 5h 0% 잠금 + 5h 카운트다운이 weekly 리셋 시각 사용
                         - 바 경계색: capacityTone 임계(≤15 critical, 15–35 caution)
                           (구: 하드코딩 <20%)
                         - poll interval/완충 알림: mergeQuotaSettings·clampPollInterval
                         - formatCountdown 제거 → formatRefreshCountdown(full 단계)
```

### 검증 (통과 기준)

- `vscode-extension/scripts/test-quota-core.js` — shared 번들 유닛 테스트 +
  **원본 webview 구현과의 동일성 증명** (2000개 랜덤 K-sync 입력, 카운트다운/
  포맷 샘플, 8개 함수 전부). 원본 함수는 `scripts/quota-golden.js`에
  refactoring 전 스냅샷으로 보존되어 증명이 refactor 이후에도 유지됨.
- `scripts/run-reuse-gate.js` — `shared/quota/index.ts` 존재, webview가
  `window.IPQuota` 위임, K 테이블 중복 금지, HTML이 quota-core.js 로드,
  build가 재생성 확인.
- `pnpm run test`에 `test-quota-core.js` 등록.
- tsc 컴파일 통과, control-center `vite build` 통과 (8 modules transformed).

### 남은 단계 (다음 세션)

- P2: broker `tokenScanner.scanLiveTokenStatus()` 스키마 확장
  (§1.1의 ❌ 필드: `*TokensLeft/*Max`, `quotaPools`(source/confidence),
  `endpointHealth`/`loadedModels`, claude status/sources/errors,
  상위 `errors[]`). `?force=1` 파라미터 처리도 여기에 포함.
- P3: A4 절대 토큰 표시, A5 Best/Lowest 요약, A7 tooltip (P2 의존)
- P4: A8 로컬 LLM 서버 배지 — control-center에 미커밋된 IDE 배지 로직과
  동일한 기준(`endpointHealth`+`loadedModels`)으로 P2 후 적용
- P5: B2 force refresh 클라이언트 배선 (broker가 `?force=1`을 받으면 IDE
  캐시 무시 → live probe)
- P6: A10 출처 구분 표시, B5 provider 블록 토글
- A9(반응형 3단계 축약)는 데스크톱 고정 폭이라 제외 (명세 확정)

## 5. 검증 기준

- P1: codex weekly=71% 상태(현재 실측)에서 5h 바가 `71×4.0=100 → cap 없음`으로
  100% 유지. weekly=20% 시 5h 표시값 = min(5h, 80%). weekly=0 시 5h 0% +
  weekly 리셋 시각 표시.
- P2: `curl localhost:37241/v1/tokens/status` 응답에 §1.1의 ❌ 필드들이
  `token_status.json`과 같은 값으로 존재.
- P3~P6: control-center의 tokens 탭에서 IDE 대시보드와 동일한 숫자/색/문구가
  보이는 스크린샷 비교 (두 앱 병렬 실행).
