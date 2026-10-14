# 데스크톱 ↔ IDE 통합 구현 계획

작성일: 2026-10-13

## 목표와 현재 근거

Integrated Power 데스크톱 앱과 Antigravity/VS Code 확장이 동일한 broker와
canonical state를 통해 실제 작업, 실행 기록, 로컬 LLM 지표를 공유한다.
기능 존재 여부는 HTTP 동작과 상태 연속성으로 검증한다.

착수 시 확인된 근거:

- 확장 `out`의 broker는 tasks/approvals/tokens, external provider, prewarm을
  제공하지만 runs/metrics route는 없다.
- 별도 `D:/Workspace/integrated-power-control-center/broker-out`에는 runs와
  metrics가 있으나 external provider와 prewarm route가 없다.
- 현재 `127.0.0.1:37241`은 health/tasks/approvals/tokens에 200, runs/metrics에
  404를 반환했다. 이 live 인스턴스에는 쓰기 요청을 하지 않는다.
- `RunStore`는 malformed JSONL 보고, run ID 기준 delta 병합, artifact 및
  경로 정규화를 수행한다. `DashboardController`는 CSV 인용/escaped quote를
  처리한다. 둘을 새 broker 구현이 복사하지 않고 pure shared reader로 추출한다.
- standalone broker `runScanner.ts`의 cwd/상위/고정 프로젝트 경로 탐색과
  CSV 단순 split은 state 권위로 사용하지 않는다.

## API 계약

- `GET /v1/workspaces`: canonical state root 아래 기존 workspace ID를 반환한다.
- `GET /v1/runs?workspaceId=<id>`: JSONL 기준 normalized runs, active runs,
  artifacts, parse errors를 반환한다. 기존 데스크톱 계약 `{runs,activeCount}`를
  최상위에 유지하고 `{ok,errors,source,workspaceId}`를 추가한다.
- `GET /v1/metrics/local-llm?workspaceId=<id>`: `reports/local_llm_metrics.csv`의
  quoted CSV 행을 최상위 `metrics`로 반환한다.
- 두 API는 필요하면 명시적 `workspacePath`를 받아 기존 workspace identity
  규칙으로 ID를 확인한다. 경로 추측은 하지 않는다. 기존 top-level payload와
  additive `ok,errors,source,workspaceId`를 함께 내며 missing file, malformed row,
  접근 오류를 빈 결과와 구분한다.
- `GET /v1/tokens/status`는 기존 IDE `token_status.json`의 측정 시간이 5분 이내일
  때만 캐시를 사용한다. 누락/오래된 상태는 기존 `TokenManager`의 동일한 검증된
  provider 수집 흐름을 headless host로 실행한다. 이 headless collector는 VS Code UI를
  열지 않으며 새로운 자격 증명 수집이나 모델 호출을 하지 않는다. 결과 `lastSync`는
  확인된 원본 측정 시각 중 가장 최근 시각이며, 측정 근거가 없으면 빈 값이다.
  각 쿼터 풀의 `measuredAt`을 별도로 보존하고 창별 신선도를 확인한다. 수집 완료가
  오래된 원본 또는 수집 실패를 최신 쿼터로 바꾸지 않는다. `force=1`은 IDE 갱신 훅을
  먼저 요청하고 실패/오래된 파일이면 headless 수집을 실행한다.
- `GET /v1/tasks?workspaceId=<id>` 및 `/v1/approvals?workspaceId=<id>`는 같은
  broker ledger를 workspace 단위로 좁힌다. `GET /v1/tasks/<id>?workspaceId=<id>`는
  해당 workspace에 속한 task와 event만 반환하고 다른 workspace이면 404다.
  승인 요청은 `requestedRevision`을 감사 정보로 보존하고, queue 응답의
  `expectedRevision`은 승인 행동을 제출할 수 있는 현재 task revision이다. 이후
  task 변경은 기존 409 conflict로 남긴다. VSIX의 `BrokerClient`가
  포트/health/transport와 query 생성 책임을 맡는다.
- `GET/POST /v1/settings/quota`는 `{ok,revision,initialized,settings,source,errors}`를
  반환한다. `settings`는 polling, master 알림, 기존 8개 window 알림, 3개 대상의
  prewarm 모드를 보존한다. 부분 쓰기는 canonical snapshot에 merge되고, 최초 seed는
  IDE 기존 설정 또는 desktop 사용자의 명시적 저장에서만 허용한다. stale revision은
  현재 snapshot을 포함한 409다.
- `POST /v1/tokens/prewarm`와 legacy `/prewarm`은 broker의 fresh quota 판단과
  provider/window arbitration을 사용한다. `dispatched`는 child spawn 확인만 뜻하며
  timer 성공이 아니다. broker scheduler가 IDE 종료 중에도 Once/Always를 처리한다.
- Task event에는 현재 안정적인 artifact 참조 계약이 없다. 파일 열기 UI는
  `listRuns(scope)`의 canonical artifact ID를 기존 `openArtifact` 안전 경계에
  넘기며, arbitrary path를 webview에서 받지 않는다.
- `/health`의 기존 `ok` 및 `service` 필드를 유지하고 `schemaVersion`, broker
  version 및 capability 목록을 추가한다. 확장은 service 문자열만으로 attach하지
  않고 필요한 schema/capability를 확인한다. packaged broker manifest는
  `{brokerVersion,schemaVersion,capabilities,entrypoint,assetRoot,sourceDigest}`를 기록하며
  누락되거나 live health와 버전/스키마가 맞지 않으면 신규 launch를 거부한다.
  파일은 `out/broker/broker-manifest.json`, entrypoint는 `index.js`다. digest는
  broker runtime `.js`를 POSIX 상대 경로 순으로 정렬해 각 경로 UTF-8 + NUL +
  파일 원문 바이트를 이어 만든 lowercase SHA-256이다. 기존 shared settings
  normalizer는 standalone `.js` asset으로 빌드되어 runtime 의존성과 digest에 포함된다.
  manifest/map/declaration은 digest에서 제외한다.
- 기존 연결을 쓰는 앱은 `GET /v1/workspaces` 후 선택한 ID를 모든 읽기 요청에
  전달한다. 사용자가 고른 workspace ID/path가 canonical state 선택 기준이다.

## 재사용과 보존 순서

1. `RunStore`의 normalize/merge/artifact 로직과 DashboardController의 CSV 파서를
   순수 shared 코드로 추출하고 기존 VS Code adapter는 I/O만 담당한다.
2. state 경로는 `resolveIntegratedPowerStateRoot`, `resolveEggRWorkspaceDescriptor`,
   `workspaceStoragePathForFolder`를 재사용한다.
3. broker ledger 경로는 `getCanonicalBrokerLedgerPath()` 하나가 정한다. IDE의
   `context.globalStorage/broker`와 데스크톱 state-root 직하의 기존 ledger 모두를
   후보로 검사하고, 각 ciphertext를 반드시 그 원본 위치에 묶인 key로 복호화한 뒤
   canonical 키로 재암호화한다. 기존 `.key`의 DPAPI/Credential Manager 경계를 무시해
   원시 ciphertext를 복사하지 않는다. JSONL과 SQLCipher 원장을 읽기 전용으로
   확인하고 모든 원장/키를 사전 검증한다. 충돌, 손상 또는 키 누락 시 어느 쪽도
   덮지 않고 시작을 fail-safe 한다. 검증된 canonical readback 전 원본을 삭제하지 않는다.
4. `/health`가 legacy contract이면 안전하게 표시 가능한 read-only 연결을 유지할 수
   있지만, 필수 capability가 빠진 core에 새 기능을 지원한다고 조용히 연결하지 않는다.
5. 쿼터 설정과 prewarm arbitration도 같은 canonical broker authority에 둔다.
   기존 세 target의 Click/Once/Always와 `integratedPower.notifications.*` 8개
   per-target/per-window 설정을 각각 보존한다. 처음 보는 설정은 Click으로 시작하고,
   기존 IDE 설정은 한 번만 seed 하며 이후 revision 충돌은 409와 현재값으로 보인다.
   Once/Always의 자동 trigger와 두 UI의 claim/cooldown을 broker가 소유한다.
   기존 PowerShell selector → Invoke-LocalLLM/Invoke-vLLMJob, qwen3.8:27b 선호,
   VRAM/UUID/privacy/consent 정책은 그대로 유지한다. `dispatched`는 주입 dispatcher가
   child spawn을 확인할 때만 기록하고 실제 remote timer 성공을 의미하지 않는다.

## TDD 및 회귀 근거

- pure parser의 JSONL delta merge/malformed line, multiline quoted CSV와 route의
  workspace 선택/missing file assertions는 기능 누락 단계에서 RED를 확인한 뒤
  구현해 GREEN으로 만들었다. ledger migration/readback 및 manifest tests도 격리
  key와 temp tree를 사용한다.
- isolated temporary loopback broker에서 HTTP route와 실제 ledger 복원 후 상태
  연속성을 검증한다. Live `37241`에는 쓰지 않는다.
- migration 검증은 임시 폴더와 임시 key만 사용한다. 기존 사용자 state와 live
  37241에는 migration/write 요청을 하지 않는다.
- broker route와 shared parser가 고정되면 desktop/IDE UI owner가 그 계약을
  연결하고 각 프로그램의 UI 회귀 검증을 수행한다. 이 backend 작업은 UI 파일을
  소유하지 않으며 API contract를 UI 구현보다 먼저 제공한다.
- 새 custom parsing module은 `shared/telemetry`에 두며 JSON/CSV 형식과 기존
  TypeScript/Node toolchain 외의 dependency를 추가하지 않는다. 후보로 considered:
  standalone `runScanner.ts` (cwd/project 추측, CSV 단순 split으로 부적합),
  duplicate broker parser (기존 VSIX authority 복제), 외부 CSV package (기존
  quoting behavior보다 호환성 이점이 확인되지 않음). 순수 shared extraction과
  regression tests가 상위 재사용 순서를 만족하므로 새 parser를 별도 발명하지 않는다.

## 진행 체크포인트

- [x] 문서, dependency/test harness, 관련 dirty diff 확인
- [x] reuse-map에 구현 전 재사용/검증 항목 추가
- [x] shared parser와 HTTP route에 대한 RED→GREEN 테스트
- [x] pure shared parser + VS Code thin adapter
- [x] canonical workspace API 및 schema-aware broker attach
- [x] ledger 키 경계, 충돌 fail-safe, corrupt ledger 보존 검증
- [x] isolated loopback HTTP + ledger 복원 연속성
- [x] packaged broker manifest 및 source digest 생성/검증
- [x] shared settings/prewarm arbitration API, headless TokenManager collection
- [x] desktop packaging에서 canonical ledger + assetRoot 일치 격리 검증
- [x] desktop/IDE telemetry/settings/prewarm UI 격리 runtime 회귀 증거
- [x] isolated UI/runtime regression evidence from both UI owners
- [x] `PROJECT_STATE.md`에 결과/잔여 계약 기록
- [x] 실제 Antigravity IDE 기본 기록 경로를 desktop-first migration 후보에 포함하고 재패키징
- [ ] 사용자 승인 후 설치·브로커 재시작 및 실제 설치 환경 검증
