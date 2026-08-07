# Antigravity IDE Global Orchestration Protocol (gemini.md)

이 문서는 안티그래비티 IDE 확장 프로그램에 의해 통제되는 **전역 오케스트레이션 규칙(Rule 0-9)**입니다. 내장 모델의 자의적 판단(짐작)을 배제하고, 수치 기반의 명확한 상태 평가(JSON)와 분할 처리(CSV)를 강제하는 구조화(Algorithmic Structuring) 명세서입니다.

## 데이터 흐름 아키텍처

확장 프로그램(`TokenManager.ts`)이 모든 하드웨어/토큰 모니터링을 백그라운드에서 수행하고, 결과를 `dashboard-state.json`으로 내보냅니다. 파이프라인 스크립트와 에이전트는 이 파일을 **유일한 상태 원본(Source of Truth)**으로 참조하여 라우팅을 결정합니다.

```
[확장 프로그램] ──(nvidia-smi 호출, Codex 세션 폴링, Antigravity API 호출)──▶ dashboard-state.json
[파이프라인 스크립트] ◀──(Read)── dashboard-state.json ──▶ 라우팅 결정 (모델 선택, 작업 분할)
```

상태 파일 위치: `~/.gemini/antigravity-ide/persistent_workspaces/<repoName>` 경로 아래 `reports/dashboard-state.json`

## 1. 자원 및 능력 평가의 구조화 (Pipeline State Detection)

모든 작업 시작 전, 파이프라인 스크립트는 아래 0~8 규칙에 따라 `dashboard-state.json`을 참조하여 현재 상태를 평가해야 합니다.

*   **Rule 0 (능력 점검)**: 각 모델의 코딩 능력은 웹 검색/사용자 평가 기반으로 사전에 정의된 티어를 따르며, 동적 평가 시 짐작하지 않고 이 정량 지표를 참조합니다.
*   **Rule 1 (토큰 관제)**: 확장 프로그램이 `~/.gemini/antigravity-ide/persistent_workspaces/<repoName>` 아래 `reports/dashboard-state.json`의 `tokenStatus` 블록(특히 `quotaPools` 배열 내 각 풀의 `remainingPercentage`, `resetTime`)을 기록하면, 스크립트가 파싱하여 현재 잔여량을 읽어옵니다.
*   **Rule 2~3 (소프트 캡 여부)**: `dashboard-state.json` 내 `tokenStatus.recommendedTaskWeight`가 `restricted`이거나 토큰 잔량이 현저히 낮을 경우 소프트 캡 도달로 판정하여 안티그래비티 단독 코딩을 차단합니다.
*   **Rule 4 (내재 모델 페널티)**: 소프트 캡에 달하지 않았으나, 사용 모델이 OPUS 4.6이나 CODEX가 아닌 Gemini(Pro/Flash)일 경우, 모델 캐파시티를 50%로 깎아 라우팅 비중을 조정합니다.
*   **Rule 5 (로컬 GPU 가용성 검출)**: 확장 프로그램이 `nvidia-smi`를 주기적으로 호출하여 개별 GPU별 VRAM 사용량, 사용률, 전력(power.draw/power.limit)을 측정하고 `dashboard-state.json`의 `tokenStatus.localComputeStatus.gpus[]` 배열에 기록합니다. 파이프라인 스크립트는 이 데이터를 읽어 각 GPU의 잔여 VRAM을 확인하고, 게임 등 백그라운드 점유 시 해당 GPU를 로컬 LLM 라우팅에서 제외합니다.
*   **Rule 6~8 (라우팅 알고리즘)**: `dashboard-state.json`에서 읽은 OPUS/Codex 잔량(`quotaPools`)과 GPU 가용성(`gpus`)을 종합하여, 어떤 클라우드 모델(OPUS, Codex)에 작업을 보내고 어떤 로컬 LLM(Qwen, Deepseek 등)을 혼합할지 스크립트가 결정합니다.

## 2. 작업 순환 루프의 구조화 (State Machine Loop, Rule 9 a~i)

명령 접수 시 파이프라인은 다음의 a~i 상태 전이를 기계적으로 밟아야 합니다.

*   **[a~c] 자동 인지 및 상태 업데이트**: 명령 수령 즉시 `dashboard-state.json`을 참조(Read)하여 최신 토큰 잔여량, GPU 가용성, 소프트 캡 상태를 확인합니다. 필요 시 확장 프로그램의 대시보드 새로고침(Refresh)을 트리거하여 최신 데이터를 받습니다.
*   **[d~e] 의사결정 및 위임 프롬프팅**: 알고리즘으로 산출된 성능표를 기반으로 최적 프로세스를 사용자에게 제안 후, 승인 시 **작업을 분할(Chunking)**하여 로컬 LLM에게 최우선 할당. 쿼터가 충분하다면 Codex에 배분 구조 검증을 의뢰.
*   **[f~g] 계량화 타이머 및 실측 로깅**: 파이프라인은 작업 시작 전 `.csv`에 "예상 소요 시간 / 토큰 비중"을 기재. 로컬/내장 모델 병렬 작업 후, 종료 시 **실제 측정된 시간 및 토큰 변화량**을 짐작 없이 그대로 덮어씁니다.
*   **[h] 교차 검증 파이프라인 강제**: 안티그래비티 내부 판단으로 종료를 선언하지 마십시오. 파이프라인이 추론 1위 로컬 LLM(DeepSeek)이나 Codex를 호출해 Repository를 공격적으로 교차 검증하게 하고 무결할 때만 Done 처리합니다.
*   **[i] 구조적 리포트 반환**: 작업 완료 시 알람 트리거 및 JSON/CSV에서 추출된 워크플로우 통계(성공/실패 내역, 원인 분석)를 보고합니다.
