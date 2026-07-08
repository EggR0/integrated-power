# Agentic Loop Implementation: Next Session Handoff Guide

이 문서는 이전 세션에서 확립된 기획을 바탕으로, **새로운 에이전트가 투입되었을 때 즉각적으로 코딩 및 구현에 돌입하기 위한 인수인계서**입니다. 컨텍스트 비대화를 막고 핵심만 명료하게 전달합니다.

---

## 1. 지상 과제 (Mission Objective)
현재 수동으로 작동하는 PowerShell 기반 모델 호출 스크립트(`Invoke-LocalLLM.ps1`, `Invoke-vLLMJob.ps1`, `Invoke-CodexJob.ps1`)에 **"7대 필수 안전장치(Guardrails)"**를 하드코딩하여, 무한 루프와 토큰 낭비를 원천 차단하는 자율 파이프라인(Context Broker 기반)으로 업그레이드하라.

## 2. 작업 원칙 (Rules of Engagement)
새로운 세션을 시작하는 Antigravity(Gemini) 에이전트는 다음 규칙을 맹목적으로 준수하라:

1. **역할 분리 강제**: 너(Antigravity)는 전체 파이프라인의 **설계자이자 오케스트레이터**다. 파일 내용을 파악하고 "무엇을 수정할지" 기획하라.
2. **실제 코딩은 Worker에게 위임**: 코드를 생성하거나 패치 파일을 작성하는 행위 자체는 **반드시 로컬 LLM(또는 Codex)에게 위임**하라. 네가 직접 코드를 작성하지 마라.
3. **토큰 효율적 위임 (Token-Efficient Delegation)**: Worker에게 일을 넘길 때 대상 파일 전문을 절대 넘기지 마라. `view_file` 도구와 `grep_search` 도구를 사용해 수정이 필요한 함수의 라인 범위만 추출하고, `Context Manifest`(문맥 명세서)를 만들어 필요한 조각만 프롬프트에 담아 전달하라.
4. **환경 확인 및 Fallback**: 작업 시작 시 로컬 모델(Ollama/vLLM) 서버 상태를 확인하라. 서버가 다운되어 있다면 수동으로 해결하려 들거나 멈추지 말고, **글로벌 규칙(Rule 202)**에 따라 Codex를 워커로 폴백(Fallback)하거나 사용자에게 서버 기동을 요청한 뒤 사용 가능한 자원으로 작업을 강행하라.

---

## 3. 구현해야 할 대상: 7대 안전장치 (우선순위 순)

다음 장치들을 기존 `scripts/dispatch/` 폴더 내의 스크립트(주로 `Invoke-vLLMJob.ps1` 또는 작업 관리 스크립트)에 순차적으로 이식해야 한다. Worker(로컬 LLM/Codex)에게 각 모듈의 구현을 지시하라.

### [Phase 1: Death Loop 차단]
*   **1. Circuit Breaker (물리적 차단기)**
    *   **구현 목표**: 루프 제어 스크립트가 "동일한 에러 시그니처 2회 발생", "총 모델 호출 3회 초과" 조건을 감지하면 즉각 루프를 멈추고 `BLOCKED_REPORT`를 반환하도록 로직 추가.
*   **2. Anti-Amnesia Ledger (실패 장부 주입)**
    *   **구현 목표**: 실패 시마다 `Attempt 1: Failed due to X`라는 기록을 메모리에 배열로 저장. 다음 모델 호출 프롬프트 생성 시 이 장부(Ledger) 내용을 하단에 무조건 붙여넣도록 프롬프트 템플릿 수정.

### [Phase 2: 환각 및 토큰 낭비 차단]
*   **3. Output Schema Gate (출력 타입 강제)**
    *   **구현 목표**: Worker 모델의 출력이 `SEARCH_REPLACE_PATCH` 또는 지정된 포맷이 아니면, 스크립트의 Parser 단에서 정규식/JSON 파싱 실패로 간주하고 즉시 Reject(거부) 처리. 자유로운 잡담을 섞지 못하게 강제.
*   **4. Validator Gate (기계적 완료 검증)**
    *   **구현 목표**: Worker가 코드 생성을 마친 후, 스스로 "다 고쳤습니다"라고 말하는 것을 무시. 반드시 `Syntax Check` 또는 관련 `Exit Code`가 0으로 떨어져야만 `Done` 상태로 전이되도록 파이프라인 스테이트 강제.

### [Phase 3: 효율적 문맥 제어 (Context Broker Lite)]
*   **5. Context Budget Gate (컨텍스트 명세서)**
    *   **구현 목표**: 프롬프트를 조립하는 스크립트에 `[Context Manifest]` 표 생성 로직 추가. 파일의 어느 부분이 몇 줄 포함되었는지 명시하고, 모델에게 "표에 없는 파일 내용은 상상하지 말고 `CONTEXT_REQUEST`를 반환하라"는 시스템 프롬프트 강제 주입.
*   **6. Run Envelope (실행 예산 봉투)**
    *   **구현 목표**: 모든 Invoke 래퍼 스크립트에 `$MaxTurns`, `$SandboxMode` 등의 파라미터를 추가하여 런타임 제약 조건을 봉투 형태로 전달.
*   **7. Privilege Separation (권한 계층화)**
    *   **구현 목표**: 상태 머신이 "Architecture Review" 상태일 때는 `Read-Only` 모드로만 작동하도록 파일 쓰기 명령어 차단.

---

## 4. Next Agent Action Item (다음 세션 첫 번째 지시)

1. 이 문서를 읽고 목표를 숙지한다.
2. `scripts/dispatch/` 경로의 파일 상태를 살피고, `Invoke-vLLMJob.ps1`과 루프 제어용 스크립트 중 어디에 **Circuit Breaker**를 이식할지 결정한다.
3. 수정할 함수만 추출하여, 로컬 LLM 또는 Codex를 워커로 지정하여 `SEARCH_REPLACE_PATCH` 형식의 코드 패치를 만들어오도록 지시한다.
4. 패치가 생성되면, 이를 적용하고 다음 단계로 넘어간다.
