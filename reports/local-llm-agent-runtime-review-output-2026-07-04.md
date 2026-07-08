## 1. 최적 호출 패턴  
```powershell
# 1) Context Manifest 생성 (필요한 변수를 포함)
$manifest = New-ContextManifest -ProjectPath $projPath -UserPrompt $prompt

# 2) 하드웨어 감지 + 모델/컨텍스트 크기 결정
$policy = Select-LocalLLMModel -Manifest $manifest

# 3) 실제 로컬 LLM 호출
Invoke-LocalLLM `
    -ContextManifest $manifest `
    -Model $policy.Model `
    -ContextSize $policy.ContextSize `
    -MaxTokens $policy.MaxTokens `
    -Temperature $policy.Temperature
```

* **핵심 포인트**  
  * `New-ContextManifest`는 *필수* 정보를 한 번에 모아두고, `Invoke-LocalLLM`은 그 객체를 바로 받음 → 토큰 오버헤드 최소화.  
  * `Select-LocalLLMModel`은 CPU/GPU/메모리 정보를 읽어 최적의 모델·컨텍스트 크기를 결정 → “작은 스니펫” 문제 방지.  
  * 파라미터가 명시적이므로 스크립트 재사용과 테스트가 쉬움.

---

## 2. 최소 상태 머신 (state machine)  
| 상태 | 설명 | 전이 조건 |
|------|------|-----------|
| **Idle** | 준비 대기 | 매니페스트 준비 완료 |
| **Preparing** | 모델, 컨텍스트 크기 결정 | `Select-LocalLLMModel` 반환 |
| **Running** | 실제 추론 중 | `Invoke-LocalLLM` 시작 |
| **Completed** | 추론 결과 반환 | 정상 종료 |
| **Error** | OOM / 스크립트 오류 | 예외 발생 |

* **왜 최소인가?**  
  * 5개의 상태는 “준비 → 실행 → 완료/오류”를 직관적으로 표현하고, 트랜지션을 로깅하거나 모니터링하기 용이합니다.

---

## 3. 하드웨어 / 모델 / 컨텍스트 정책  
| 하드웨어 요건 | 권장 모델 | 컨텍스트 크기 | MaxTokens | 온도 |
|---------------|-----------|---------------|-----------|------|
| GPU 메모리 ≥ 12 GB | `vllm-7B` | 4 k tokens | 2 k | 0.3 |
| GPU 메모리 8–12 GB | `vllm-7B` | 2 k tokens | 1 k | 0.4 |
| GPU 메모리 < 8 GB | `vllm-4B` | 1 k tokens | 500 | 0.5 |
| CPU‑전용 | `vllm-2B` | 512 tokens | 250 | 0.6 |

* **컨텍스트 크기**  
  * 코딩/디자인 루프에서는 *“전체 프로젝트 + 사용자 요구사항 + 이전 단계 결과”*를 모두 포함하도록, 1k–4k 토큰 범위가 가장 적절합니다.  
  * 작은 스니펫이 전달될 경우 자동으로 **`Select-LocalLLMModel`**이 컨텍스트를 확장하도록 설계합니다 (예: `-AppendContext` 옵션).

---

## 4. 가장 위험한 실패 모드  
* **GPU OOM (Out‑of‑Memory)**  
  * 컨텍스트가 너무 커서 GPU 메모리가 초과 → 프로세스 강제 종료 → 코드 루프 끊김.  
  * 방지책: `Invoke-LocalLLM` 실행 전 `Select-LocalLLMModel`이 실제 메모리 사용량을 예측하도록 구현하고, 실패 시 `vLLMJob`을 재시도(다른 모델/작은 컨텍스트).

---

## 5. 구현 계획 (약 2~3일)  

| 단계 | 내용 | 예상 소요 |
|------|------|----------|
| **1** | `Select-LocalLLMModel` 스크립트 수정 → `Get-CimInstance Win32_Processor`, `Get-CimInstance Win32_VideoController` 로 메모리/코어 감지 | 0.5일 |
| **2** | `Invoke-LocalLLM` 파라미터에 `-ContextSize`, `-MaxTokens`, `-Temperature` 추가 및 기본값 설정 | 0.5일 |
| **3** | `New-ContextManifest`에 `-AppendContext` 옵션 구현 (필요 시 자동 컨텍스트 확장) | 0.5일 |
| **4** | 테스트 케이스 추가 (GPU 4 GB, 8 GB, CPU‑전용) → 실패 시 OOM 경고 | 0.5일 |
| **5** | 상태 머신 로깅 추가 (간단한 `Write-Host` 혹은 `Write-Verbose`) | 0.5일 |

* **배포**  
  * 테스트 후 CI에 새 스크립트 버전을 푸시 → 문서(README, Architecture.md) 갱신.

이렇게 하면 **로컬 LLM이 에이전트 루프**에서 제대로 동작하고, 하드웨어 리소스를 최대한 활용하며, 스니펫이 작은 경우에도 안정적인 컨텍스트 전달이 보장됩니다.
