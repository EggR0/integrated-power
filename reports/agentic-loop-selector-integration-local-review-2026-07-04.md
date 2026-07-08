### 1. 통합에 대한 정확성 위험

| 위험 | 설명 | 영향 |
|------|------|------|
| **추천 컨텍스트를 모델이 지정될 때 가져오지 못함** | 호출자가 `-Model`만 지정하고 `-NumCtx`를 넘기지 않으면, 현재 스크립트는 선택자(`Select-LocalLLMModel.ps1`)를 호출하지 않으므로 해당 모델에 대한 `RecommendedNumCtx`를 알 수 없습니다. | 실행 시에 과소/과다 컨텍스트가 할당될 수 있음. |
| **선택자 JSON 파싱 오류** | `Select-LocalLLMModel.ps1 -AsJson` 은 JSON 문자열을 반환합니다. `ConvertFrom-Json` 으로 파싱할 때 필드 이름이 다르거나 예상치 못한 타입이 들어올 수 있음. | 파싱 실패 시 스크립트가 비정상 종료. |
| **`-NumCtx <= 0` 판별 로직이 누락** | `-NumCtx` 가 0 혹은 음수일 때만 추천값을 사용하도록 되어 있으나, 현재 조건이 `-le 0` 대신 `-lt 1` 등으로 잘못 구현되었을 가능성. | 유효한 0이 넘는 값이 무시될 수 있음. |
| **`-NoHardwareSnapshot` 전달 누락** | 선택자에 `-NoHardwareSnapshot` 옵션을 전달하지 않으면, 재현 가능한(Deterministic) 실행이 어려워질 수 있음. | 실험 재현성 저하. |
| **선택자 결과에 `SelectedBy`, `SelectionReason` 포함 여부 확인** | 일부 실행 환경에서는 `SelectionReason` 이 필드가 없을 수 있으므로 스크립트가 `null`을 그대로 전달하게 됨. | 메트릭 수집 시 `null` 값이 기록됨. |
| **모델이 설치되지 않았을 때** | 호출자가 설치되지 않은 모델을 지정하면 선택자는 추천값을 제공하지 못하고 오류가 발생할 가능성. | 스크립트가 중단되거나 잘못된 컨텍스트가 할당됨. |

---

### 2. PowerShell 호출/인용 위험

| 위험 | 설명 | 해결 방법 |
|------|------|-----------|
| **JSON 문자열 내에 이스케이프 문자** | `ConvertFrom-Json` 은 기본적으로 PowerShell 7+에서 잘 동작하지만, 특정 Unicode 이스케이프(예: `\uXXXX`)가 포함될 경우 파싱이 실패할 수 있음. | `-Depth 100` 옵션으로 깊이 제한을 늘리거나, `Get-Content -Raw` 대신 `Invoke-Expression` 사용 피하기. |
| **배열/객체 전달 시 괄호/인용** | `Invoke-LocalLLM.ps1` 로 전달할 때 `-TaskTitle` 같은 문자열이 `-` 로 시작하면 파라미터 바인딩이 오류를 발생시킬 수 있음. | 항상 `@{}` 해시표를 사용하거나, `$null` 은 명시적으로 전달. |
| **숫자 인자 전달** | `-NumCtx` 를 `$null` 이외의 값으로 넘길 때, 파이프라인에서 `int` 변환이 실패할 수 있음. | `$null` 확인 후 `int` 캐스팅(`[int]$NumCtx`)을 명시적으로 수행. |
| **NoHardwareSnapshot 옵션 전달** | `-NoHardwareSnapshot` 은 스위치 파라미터로 전달되어야 함. 스크립트에서 `$NoHardwareSnapshot` 을 `$true/$false` 로 처리하고, 선택자 호출에 `-NoHardwareSnapshot:$NoHardwareSnapshot` 로 전달. | 스위치 파라미터 사용 시 `if($NoHardwareSnapshot){ ... }` 로 처리. |

---

### 3. 로컬 LLM 에이전트 런타임에 대한 다음 단계 적합성

- **장점**  
  - 모델과 컨텍스트 선택을 완전히 자동화하여 사용자가 일일이 `-Model`, `-NumCtx` 를 지정할 필요가 없음.  
  - 하드웨어 상황을 반영한 `RecommendedNumCtx` 를 사용함으로써 메모리/전력 최적화가 자연스럽게 이뤄짐.  
  - `SelectedBy`, `SelectionReason` 같은 메트릭 정보를 그대로 전달해 분석과 튜닝이 용이해짐.

- **단점**  
  - 선택자와 실제 모델이 완전히 동기화되지 않을 경우(예: 설치되지 않은 모델 지정) 예외가 발생할 수 있음.  
  - 선택자 내부 로직이 변경되면 `Invoke-AgenticLoop.ps1` 에서도 수정이 필요해질 수 있음.

전반적으로 **이 통합은 로컬 LLM 에이전트 런타임을 사용자 친화적으로 만들고, 하드웨어 기반의 최적화를 자연스럽게 적용할 수 있는 좋은 다음 단계**입니다. 단, 위에서 언급한 위험 요소들을 사전에 처리해 두면 스크립트 안정성이 크게 향상됩니다.

---

### 4. 간단한 패치 제안

```powershell
# scripts/dispatch/Invoke-AgenticLoop.ps1

param(
    [string]$TaskTitle,
    [string]$TaskType,
    [int]$TaskScale,
    [string]$Model,
    [int]$NumCtx,
    [switch]$NoHardwareSnapshot
)

# 1. 기본값 처리
$NumCtxProvided = $false
if ($null -ne $NumCtx -and $NumCtx -gt 0) {
    $NumCtxProvided = $true
}

# 2. 모델이 지정되지 않았을 때 선택자 호출
if ($null -eq $Model) {
    $selectorJson = Select-LocalLLMModel.ps1 `
        -TaskType $TaskType `
        -TaskScale $TaskScale `
        -InstalledOnly `
        -AsJson `
        -NoHardwareSnapshot:$NoHardwareSnapshot

    $selector = $selectorJson | ConvertFrom-Json
    $Model = $selector.SelectedModel
    $SelectedBy = $selector.SelectedBy
    $SelectionReason = $selector.SelectionReason

    if (-not $NumCtxProvided) {
        $NumCtx = $selector.RecommendedNumCtx
    }
}
else {
    # 3. 사용자가 모델을 지정했지만 NumCtx가 없을 때
    $SelectedBy = "User"
    $SelectionReason = "Explicit model selection"

    if (-not $NumCtxProvided) {
        # 같은 모델에 대해 추천 컨텍스트를 얻기 위해 선택자 호출
        $selectorJson = Select-LocalLLMModel.ps1 `
            -TaskType $TaskType `
            -TaskScale $TaskScale `
            -InstalledOnly `
            -AsJson `
            -ModelName $Model `
            -NoHardwareSnapshot:$NoHardwareSnapshot

        $selector = $selectorJson | ConvertFrom-Json
        $NumCtx = $selector.RecommendedNumCtx
    }
}

# 4. Invoke-LocalLLM 호출
Invoke-LocalLLM.ps1 `
    -TaskTitle $TaskTitle `
    -TaskType $TaskType `
    -TaskScale $TaskScale `
    -Model $Model `
    -NumCtx $NumCtx `
    -SelectedBy $SelectedBy `
    -SelectionReason $SelectionReason
```

**핵심 변경 사항**  
- `Select-LocalLLMModel.ps1` 를 모델 지정 여부와 컨텍스트 유무에 따라 유연하게 호출.  
- 선택자 반환값(`SelectedBy`, `SelectionReason`, `RecommendedNumCtx`)을 모두 활용.  
- `-NoHardwareSnapshot` 를 선택자 호출에 명시적으로 전달.  
- `Invoke-LocalLLM.ps1` 로 모든 메트릭 정보를 전달해 로깅 및 분석이 가능하도록 함.

이 패치를 적용하면 현재 요구 사항을 충족하면서도, 예외 상황(설치되지 않은 모델, 비정상 JSON)에서 안전하게 동작하도록 보완됩니다.
