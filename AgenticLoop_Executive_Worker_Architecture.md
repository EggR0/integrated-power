# Agentic Loop: Local LLM Agent Runtime 계획

## 1. 목표

이 문서의 범위는 전체 Antigravity/Codex 운영 구조가 아니라, **로컬 LLM을 어떻게 호출해야 agentic loop처럼 작동하는가**에 한정한다.

원하는 구조는 다음과 같다.

- Antigravity IDE/Gemini는 사용자 작업 흐름과 IDE 연계를 담당한다.
- Codex는 기술 고문, 최종 판단자, 필요 시 직접 구현자로 남는다.
- 로컬 LLM은 단순 패치 타자기가 아니라 기술 고문, 기획자, 디자이너, 실무자, 코딩 에이전트로 호출될 수 있어야 한다.
- 상위 모델이 매번 국소 라인 지시를 만들지 않도록, 로컬 LLM은 충분한 컨텍스트와 검증 피드백을 가진 내부 루프를 직접 돈다.
- 하드웨어 상태를 감시해 가능한 한 큰 컨텍스트와 적절한 모델을 선택한다.

핵심은 "로컬 LLM에게 적게 주고 실수하지 않게 하자"가 아니다. 핵심은 **크게 줄 수 있을 때 크게 주고, 실패하지 않도록 런타임이 상태와 검증을 강제하는 것**이다.

---

## 2. 호출 원칙

### A. Task Capsule은 짧게, Context Pack은 넉넉하게

상위 모델이 로컬 LLM에게 넘기는 지시는 짧아야 한다.

```text
Goal: 무엇을 달성해야 하는가
Role: advisor | planner | designer | worker | coding_agent
Scope: 관련 프로젝트/파일/디렉터리
Success: 어떤 검증이 통과해야 완료인가
Budget: 최대 턴, 최대 컨텍스트, 최대 실행 시간
```

하지만 실제 작업 컨텍스트는 지나치게 좁히지 않는다. 로컬 LLM이 코딩 에이전트 역할을 맡을 때는 다음을 포함한 **Context Pack**을 제공한다.

- 관련 파일 전문 또는 큰 범위
- 주변 파일 목록과 역할 요약
- 이전 실패 ledger
- 현재 validator/test 명령
- 사용 가능한 출력 action schema
- 컨텍스트가 부족할 때 요청할 수 있는 `REQUEST_CONTEXT` 계약

즉, 절약 대상은 상위 모델의 반복 추론과 프롬프트 작성이지, 로컬 LLM의 필수 작업 문맥이 아니다.

### B. 전체 파일 주입은 금지가 아니라 정책 대상이다

전체 파일 주입을 무조건 삭제하면 로컬 LLM의 코딩 품질이 떨어질 수 있다. 대신 런타임이 파일 크기와 하드웨어 상태를 보고 결정한다.

- 작은 파일: 전문 제공 허용
- 중간 파일: 관련 파일 전문 + 주변 구조 요약 제공
- 큰 파일: 목차/심볼/검색 결과 + 큰 라인 범위 제공
- 초대형 작업: 첫 턴은 설계/탐색 전용, 이후 `REQUEST_CONTEXT`로 확장

`New-ContextManifest.ps1`의 기본 역할도 "작게 자르는 도구"가 아니라 **컨텍스트 예산 안에서 가장 유용한 작업 팩을 조립하는 도구**로 바뀌어야 한다.

### C. 로컬 LLM은 한 번 호출하고 끝내지 않는다

현재 `Invoke-LocalLLM.ps1`와 `Invoke-vLLMJob.ps1`는 단발 inference에 가깝다. agentic loop가 되려면 `Invoke-AgenticLoop.ps1` 또는 후속 런타임이 같은 작업에 대해 상태를 유지해야 한다.

필수 루프는 다음이다.

```text
PrepareRun
  -> HardwareSnapshot
  -> SelectModelAndBudget
  -> BuildContextPack
  -> WorkerTurn
  -> ParseAction
  -> ApplyOrExpandContext
  -> Validate
  -> RetryWithLedger | Escalate | Done
```

로컬 LLM의 출력은 자유 서술이 아니라 action이어야 한다. 다만 advisor/planner 역할에서는 Markdown 보고서를 허용하고, coding_agent 역할에서는 엄격한 schema를 강제한다.

---

## 3. Local LLM Agent Runtime 계약

### 입력

로컬 agent runtime은 다음 입력을 받는다.

```powershell
Invoke-AgenticLoop.ps1 `
  -Goal "<user-visible goal>" `
  -Role "coding_agent" `
  -Files @("path1", "path2") `
  -ProjectRoot "<repo>" `
  -ValidatorProfile "powershell" `
  -TaskType "coding" `
  -TaskScale "Large" `
  -MaxTurns 3 `
  -HardwareAware `
  -AllowLargeContext
```

현재 스크립트에는 이 계약이 완전히 구현되어 있지 않다. 현 상태에서는 `-Prompt`, `-TargetFile`, `-Files`, `-LineRanges`, `-Model`, `-NumCtx`, `-MaxRetries`가 중심이므로, 위 계약은 단계적으로 얹는다.

### 출력 action

coding_agent 역할의 로컬 LLM 출력은 아래 중 하나여야 한다.

```text
REQUEST_CONTEXT
file: <path>
reason: <why>
preferred_scope: full_file | symbol | line_range | grep
query: <symbol/regex/description>
```

```text
SEARCH_REPLACE_PATCH
file: <path>
SEARCH:
<exact original text>
REPLACE:
<replacement text>
```

```text
BLOCKED_REPORT
summary: <3-5 line reason>
attempts: <count>
needed_from_codex: <hint | direct_patch | broader_context | design_decision>
```

advisor/planner/designer 역할은 strict patch schema 대신 Markdown 산출물을 허용하되, 산출물은 `reports/` 또는 `discussions/`에 저장한다.

---

## 4. 하드웨어 기반 모델/컨텍스트 정책

로컬 LLM을 제대로 쓰려면 모델 선택이 정적이면 안 된다. 매 run 시작 시 다음을 기록한다.

- `nvidia-smi`: GPU별 VRAM total/used/free/utilization
- Ollama/vLLM 서버 상태
- 설치 모델 목록
- 최근 `local_llm_metrics.csv`의 성공률, 속도, 실패 원인

현재 확인된 하드웨어 예시는 RTX 3090 24GB 2장이다. 이 정도면 단순 스니펫 모드만 고집할 이유가 없다.

권장 정책:

| 상황 | 모델 선택 | 컨텍스트 |
| --- | --- | --- |
| 빠른 advisor/review | `gpt-oss:20b` 또는 빠른 32B급 | `NumCtx 16384-32768` |
| 큰 coding_agent 작업 | 32B/49B/70B 후보 중 metrics 상위 | `NumCtx 32768` 이상 시도 |
| VRAM 여유 부족 | 작은 모델 또는 낮은 quant | `NumCtx 8192-16384` |
| 반복 실패/OOM | 모델 한 단계 축소, 컨텍스트 재압축 | ledger 유지 |
| 최종 요약/escalation | 빠른 요약 모델 | 짧은 실패 로그만 |

`Select-LocalLLMModel.ps1`는 이미 registry와 metrics를 사용한다. 다음 개선은 여기에 **실시간 하드웨어 snapshot을 점수에 반영**하는 것이다.

---

## 5. 상태 머신

최소 상태는 단순 `Running/Error`가 아니라 agentic loop의 행동을 표현해야 한다.

| State | 책임 | 다음 전이 |
| --- | --- | --- |
| `PrepareRun` | goal/role/success/budget 정규화 | `HardwareSnapshot` |
| `HardwareSnapshot` | GPU/RAM/server/model 상태 수집 | `SelectModelAndBudget` |
| `SelectModelAndBudget` | 모델, provider, NumCtx, max tokens 선택 | `BuildContextPack` |
| `BuildContextPack` | 작업에 충분한 Context Pack 생성 | `WorkerTurn` |
| `WorkerTurn` | 로컬 LLM 호출 및 metrics 기록 | `ParseAction` |
| `ParseAction` | action schema 검증 | `RequestContext`, `ApplyPatch`, `Blocked`, `Retry` |
| `RequestContext` | context 확장 후 재호출 | `BuildContextPack` |
| `ApplyPatch` | 패치 적용 또는 dry-run | `Validate` |
| `Validate` | AST/test/lint 실행 | `Done`, `Retry`, `Blocked` |
| `Retry` | 실패 ledger를 붙여 재시도 | `WorkerTurn` |
| `Blocked` | 요약 보고 및 상위 모델 개입 요청 | 종료 |
| `Done` | artifact, metrics, 변경 요약 저장 | 종료 |

이 상태 머신은 LLM이 지키는 약속이 아니라 PowerShell 하네스가 강제하는 규칙이어야 한다.

---

## 6. 검증 정책

완료 조건은 "로컬 LLM이 끝났다고 말함"이 아니다.

- PowerShell: `[scriptblock]::Create()` + 관련 Pester/실행 테스트
- TypeScript/VS Code extension: `npm test`, `npm run compile`, 또는 package script
- 문서/기획: 산출물 존재, 요구 항목 포함, 상위 모델 리뷰
- advisor 보고서: `MinOutputChars`, 필수 섹션 regex, metrics 기록

원시 stderr/stdout은 버리지 않는다. 상위 모델에게는 짧은 `BLOCKED_REPORT`만 보여주되, 원본 로그는 `reports/` 또는 globalStorage session에 보존한다.

---

## 7. 구현 로드맵

### Phase 1: 호출 계약 정리

- `Invoke-AgenticLoop.ps1`의 현재 `-Prompt/-TargetFile` 중심 계약 위에 `Role`, `Goal`, `TaskType`, `TaskScale`, `MaxTurns`, `AllowLargeContext`, `HardwareAware` 개념을 추가한다.
- 기존 동작은 깨지지 않게 유지한다.
- 로컬 advisor/planner 호출은 `Invoke-LocalLLM.ps1` 또는 `Invoke-vLLMJob.ps1`를 그대로 사용하되, TaskTitle/TaskType/metrics를 반드시 남긴다.

### Phase 2: Hardware-aware budget

- `nvidia-smi` snapshot을 수집하는 helper를 추가한다.
- `Select-LocalLLMModel.ps1`의 점수 계산에 free VRAM, utilization, 최근 OOM/실패 이력을 반영한다.
- 선택 결과에 `RecommendedNumCtx`, `RecommendedMaxTokens`, `Provider`, `Reason`을 포함한다.

### Phase 3: Context Pack Builder

- `New-ContextManifest.ps1`를 단순 표 생성기에서 context pack 생성기로 확장한다.
- 기본은 넉넉한 컨텍스트다. 단, 예산 초과 시 구조 요약, grep 결과, 라인 범위로 압축한다.
- 로컬 LLM의 `REQUEST_CONTEXT` action을 받아 컨텍스트를 확장하는 루프를 추가한다.

### Phase 4: Action parser와 validator matrix

- `SEARCH/REPLACE`만이 아니라 `REQUEST_CONTEXT`, `BLOCKED_REPORT`를 parser gate에 추가한다.
- validator profile을 파일 타입/프로젝트별로 분리한다.
- 실패 ledger에는 "무엇을 시도했고 왜 실패했는지"를 짧게 축적한다.

### Phase 5: Escalation

- 3회 실패, 같은 오류 반복, OOM, validator 불일치가 발생하면 로컬 루프를 멈춘다.
- 빠른 로컬 요약 모델이 실패를 3-5줄로 요약한다.
- Codex/Gemini는 그 요약과 원본 로그 경로를 보고 힌트를 줄지 직접 개입할지 판단한다.

---

## 8. 폐기하지 말고 단계적으로 대체할 것

기존 스크립트는 즉시 삭제하지 않는다.

- `Invoke-LocalLLM.ps1`: 단발 inference와 metrics 기록 계층으로 유지
- `Invoke-vLLMJob.ps1`: OpenAI-compatible vLLM provider 계층으로 유지
- `Select-LocalLLMModel.ps1`: 모델 선택 정책 엔진으로 확장
- `New-ContextManifest.ps1`: Context Pack Builder로 확장
- `Invoke-AgenticLoop.ps1`: 상태 머신 runtime으로 확장
- `Invoke-AutonomousAgent.ps1`: 새 runtime이 검증된 뒤 legacy/archive 결정

삭제보다 중요한 것은 호출 경계의 명확화다. 로컬 LLM은 충분한 문맥과 큰 컨텍스트를 받아야 하지만, 완료 판정과 파일 적용 권한은 하네스가 통제해야 한다.

---

## 9. 최종 판단

이 계획은 진행해도 좋다. 단, 원래 문서처럼 "전체 파일 주입 삭제"와 "작은 Task Capsule만 전달"을 핵심으로 삼으면 사용자의 실제 목표와 어긋난다.

올바른 목표는 다음이다.

> 상위 모델은 짧게 위임하고, 로컬 LLM은 하드웨어가 허용하는 만큼 충분한 컨텍스트를 받아 내부 agentic loop를 돈다. PowerShell runtime은 모델 선택, 컨텍스트 예산, action schema, validator, retry ledger, metrics, escalation을 강제한다.

이 방향이면 Codex/Gemini의 입력/추론 토큰을 아끼면서도 로컬 LLM의 코딩 품질을 포기하지 않을 수 있다.
