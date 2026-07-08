# Agentic Loop End-to-End (E2E) Test Plan

이 문서는 이전 세션에서 구축 완료된 **Agentic Loop (7대 안전장치 통합)** 구조를 새로운 세션에서 검증하고, 본격적인 실전 워크플로우에 통합하기 위한 **통합 테스트 명세서**입니다.

---

## 1. 배경 및 현재 상태 (Status Quo)

*   **VSIX 확장 프로그램 변경 없음**: TypeScript 기반의 Antigravity IDE 확장 프로그램(`TokenManager.ts` 등)은 재설치할 필요가 없습니다. 오케스트레이션 및 게이트 검증 로직은 철저하게 분리된 PowerShell 스크립트(`scripts/dispatch/` 내부) 계층에 구현되었기 때문입니다.
*   **구현 완료된 스크립트 자산**:
    *   `Invoke-LocalLLM.ps1`: Circuit Breaker(물리적 차단기) 및 Anti-Amnesia Ledger(실패 장부 주입) 적용 완료 (Phase 1).
    *   `New-ContextManifest.ps1`: 읽기 가능한 파일 및 라인 범위를 표 형태로 만들어주는 Context Broker Lite 모듈 (Phase 3).
    *   `Invoke-AgenticLoop.ps1`: 위의 모든 기능과 LLM을 묶어, **Output Schema Gate**(정규식 필터링)와 **Validator Gate**(PowerShell AST 문법 검증)를 수행한 후 최종 패치를 적용하는 통합 오케스트레이터 (Phase 2 & 3).

---

## 2. Next Session 에이전트의 첫 번째 목표

새로운 세션이 시작되면, 에이전트는 사용자의 승인을 거친 뒤 아래의 통합 테스트(E2E)를 터미널을 통해 직접 실행해야 합니다.

### [테스트 시나리오: 엄격한 스키마 및 문법 관문 검증]

**1단계: 테스트 환경 준비**
에이전트는 `scripts/dispatch/test-dummy.ps1` 파일을 생성하고 아래의 더미 코드를 작성합니다.
```powershell
function Write-Greeting {
    Write-Host "Hello World"
}
```

**2단계: Agentic Loop 스트레스 테스트 트리거 (10회 반복)**
에이전트는 터미널에서 `Invoke-AgenticLoop.ps1`을 호출합니다. 이때 의도적으로 포맷을 잘 틀리거나 잡담이 많은 저매개변수/비코딩 특화 모델(예: `llama3.1:8b`)을 타겟으로 지정하여 가드레일을 맹렬히 테스트합니다. 또한 이를 10회 반복(Loop)하여 메모리 누수나 컨텍스트 오염이 없는지 확인합니다.
프롬프트는 다음과 같이 전달합니다:
> "test-dummy.ps1 내부의 'Hello World'를 'Hello Agentic Loop'로 수정해라. 단, 응답 시 SEARCH/REPLACE 블록 밖에는 어떠한 설명이나 잡담도 추가하지 말 것."

**3단계: 검증 포인트 (관전 요소)**
1.  **Context Budget**: 터미널 로그를 통해 프롬프트 상단에 `[Context Manifest]` 표가 정상적으로 주입되었는지 확인.
2.  **Schema Gate**: 모델이 마크다운 코드블록(` ```powershell `)이나 인삿말을 섞어 썼을 경우, 파서가 이를 거부(Reject)하고 `$attempt` 루프를 증가시키며 재시도하는지 확인.
3.  **Validator Gate**: 추출된 SEARCH와 REPLACE 문자열이 `[scriptblock]::Create()` 엔진에 의해 정상적인 PowerShell 코드로 판별되는지 확인.
4.  **최종 적용 (Apply)**: 모든 억제기를 통과한 코드만이 `test-dummy.ps1` 파일에 덮어쓰기(`Set-Content`) 되는지 파일 내용(`Get-Content`)으로 최종 확인.

---

## 3. 실행 명령어 레퍼런스 (Copy & Paste Ready)

에이전트가 터미널에서 즉시 실행할 수 있는 명령어 스니펫입니다.

```powershell
# 1. 더미 파일 세팅
$dummyFile = "C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\test-dummy.ps1"
Set-Content -Path $dummyFile -Value 'function Write-Greeting { Write-Host "Hello World" }' -Encoding UTF8

# 2. 오케스트레이터 10회 반복 호출 (스트레스 테스트)
$testPrompt = "현재 파일에 Write-Greeting 함수가 있습니다. 이 함수의 내부 출력 문자열을 'Hello World'에서 'Hello Agentic Loop'로 변경해 주십시오. 반드시 SEARCH: <기존코드> REPLACE: <변경코드> 포맷을 지키고, 문법적으로 완벽해야 합니다."

for ($i = 1; $i -le 10; $i++) {
    Write-Host "`n=========================================" -ForegroundColor Cyan
    Write-Host "[Test Run $i / 10] - Using llama3.1:8b" -ForegroundColor Cyan
    Write-Host "=========================================" -ForegroundColor Cyan
    
    try {
        & "C:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Invoke-AgenticLoop.ps1" `
            -Prompt $testPrompt `
            -TargetFile $dummyFile `
            -Model "llama3.1:8b" `
            -Files @($dummyFile)
    } catch {
        Write-Warning "Agentic Loop failed on run $i : $_"
    }
}

# 3. 결과 열람
Write-Host "`n[최종 수정된 파일 내용]" -ForegroundColor Green
Get-Content $dummyFile
```

---

## 4. 이후 확장 방향 (Post-Test)

이 테스트가 완벽하게 통과된다면, 앞으로 Antigravity(Gemini) 모델은 코드 수정이 필요할 때 직접 에디터를 열고 작성하는 대신, 이 `Invoke-AgenticLoop.ps1`에게 프롬프트와 타겟 파일만 던져주는 방식(Delegation)으로 완전한 역할 분담을 시작하게 됩니다.
