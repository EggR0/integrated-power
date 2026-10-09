# Integrated Power

[![Open VSX](https://img.shields.io/open-vsx/v/EggR0/integrated-power?color=blue&label=Open%20VSX)](https://open-vsx.org/extension/EggR0/integrated-power)
[![GitHub Release](https://img.shields.io/github/v/release/EggR0/integrated-power?color=green&label=GitHub%20Release)](https://github.com/EggR0/integrated-power/releases/tag/v0.9.5)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/EggR0/integrated-power?color=orange&label=Downloads)](https://open-vsx.org/extension/EggR0/integrated-power)
[![Platform](https://img.shields.io/badge/Platform-Windows%2011-blue)](https://github.com/EggR0/integrated-power)
[![Target](https://img.shields.io/badge/Target-Antigravity%20IDE-purple)](https://github.com/EggR0/integrated-power)

> **"Quota를 기다리는 대시보드가 아니라, 작업을 다음 실행 경로로 이어 주는 AI 작업 컨트롤 센터"**

Integrated Power는 **Antigravity IDE 전용 확장 프로그램**이다. Windows 11에서 에이전트 잔여 사용량(Quota), 작업 큐(Queue), GPU 및 로컬 연산 자원을 한 화면에 통합 표시하고, 작업이 Quota에 걸려 중단되지 않도록 **최적의 AI 실행 경로(Antigravity · Codex · Claude · Local LLM Qwen 3.8 27B)**로 매끄럽게 연결합니다.

---

## ⚡ 빠른 시작 & 설치 (Quick Start)

### 방법 1. Open VSX 마켓플레이스 설치 (가장 추천)
Antigravity IDE 또는 VS Code 확장 탭(`Ctrl+Shift+X`)에서 **`Integrated Power`** 또는 **`EggR0.integrated-power`**를 검색하여 클릭 한 번으로 설치할 수 있습니다.
* **Open VSX 등록 페이지**: [open-vsx.org/extension/EggR0/integrated-power](https://open-vsx.org/extension/EggR0/integrated-power)

### 방법 2. GitHub Releases VSIX 다운로드 및 CLI 설치
검증된 최신 패키지 [`integrated-power-0.9.5.vsix`](https://github.com/EggR0/integrated-power/releases/download/v0.9.5/integrated-power-0.9.5.vsix)를 다운로드한 후, 아래 명령어로 설치합니다:

```powershell
# PowerShell
& "$env:LOCALAPPDATA\Programs\Antigravity IDE\bin\antigravity-ide.cmd" `
  --install-extension ".\integrated-power-0.9.5.vsix" `
  --force

# 또는 CMD
"%LOCALAPPDATA%\Programs\Antigravity IDE\bin\antigravity-ide.cmd" --install-extension ".\integrated-power-0.9.5.vsix" --force
```

설치 또는 업데이트 후 실행 중인 Antigravity IDE에서 다음 명령을 한 번 실행합니다.

```text
Developer: Reload Window
```

> ⚠️ **주의**: 별도 프로그램인 `%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe`는 확장 설치 대상이 아닙니다. 이 확장은 별도 `Antigravity.exe`용 확장이 아니며 Codex용 확장도 아니다.

---

## 🎯 핵심 사용 시나리오 (Use Cases)

### 시나리오 1. Quota 소진 시 로컬 LLM(Qwen 3.8 27B)으로 무중단 작업 전환
* **상황**: Antigravity Gemini 또는 Claude 5시간 쿼터가 15% 이하로 떨어져 코딩 에이전트 작업이 멈춤
* **해결**: Dashboard에서 쿼터 잔여량을 실시간 감지하고 경고를 표시합니다. Integrated Orchestrator를 통해 보조 GPU(RTX 3090/4090)에 상주하는 로컬 고성능 모델(`qwen3.8:27b`)로 즉시 작업을 전환하여 클라우드 토큰 리셋을 기다리지 않고 작업을 연속적으로 진행합니다.

### 시나리오 2. 8개 타깃 100% 완충 실시간 알림 (Notification)
* **상황**: 쿼터 리셋 시간을 일일이 확인하느라 작업 흐름이 분산됨
* **해결**: 4대 핵심 모델(Antigravity Gemini, Antigravity Claude, ChatGPT/Codex, Claude Direct)의 **5-Hour 및 Weekly 시간창(총 8개 타깃)**이 100% 충전되는 순간 IDE 네이티브 알림을 자동 팝업합니다. 설정(`integratedPower.notifications.*`)에서 필요한 모델만 개별적으로 켜고 끌 수 있습니다.

### 시나리오 3. 로컬 연산 자원 & GPU 텔레메트리 병목 감시
* **상황**: 로컬 LLM 추론 시 GPU 부하, VRAM 초과(OOM), 전력 제한 상태를 확인하기 어려움
* **해결**: 로컬 연산 패널에서 GPU Load, VRAM 사용량, 소모 전력(`[GPU] 35% load | 170.8W / 370W`)을 대칭형 프로그레스 바로 실시간 모니터링하여 안전하고 쾌적한 로컬 파이프라인을 유지합니다.

### 시나리오 4. 3단계 스마트 쿼터 프리웜(Pre-warm)으로 5시간 대기 시간 단축
* **상황**: 5시간 쿼터는 첫 사용 시점부터 카운트다운되므로, 사용 전 100% 상태에서는 타이머가 돌지 않아 작업 개시 후 충전까지 만 5시간을 온전히 기다려야 함
* **해결**: 미사용 100% 대기 쿼터에 대해 백그라운드 초단기 취소 핑(Instant Cancellation Ping)을 트리거하여, 토큰 용량은 99.9% 이상 보존하면서 5시간 리셋 타이머를 사전에 기동합니다. 3가지 모드(`Always`, `Once`, `Click`)를 지원하며 대시보드 툴바에서 원클릭 제어 가능합니다.

---

## 🚀 주요 기능 (v0.9.5)

- **3-Mode 5시간 쿼터 프리웜 (Quota Pre-warm Strategy - Click / Once / Always)**: 미사용 100% 쿼터 창에 대해 최소 토큰 핑 후 즉각 취소(Abort)를 수행하여, 잔여 용량을 99.9% 이상 보존하면서 5시간 리셋 카운트다운을 사전 개시. 작업 시작 전 미리 타이머를 굴려 작업 중 리셋 시간을 극적으로 단축. 사용 환경에 맞춰 Always(자동 감지 상시 가동), Once(세션 시작 시 1회), Click(수동 버튼) 3모드 완벽 지원
- **프리웜 인터랙티브 UI 툴바 및 실시간 상태 배지**: Webview 대시보드 및 독립형 Control Center 상단에 프리웜 툴바(`[⚡ Pre-warm]`, 모드 셀렉터, `Ready`/`Armed`/`Prewarming...`/`Success` 상태 배지) 탑재
- **최저/최고(Lowest/Best) 잔여 용량 계산 보안 강화**: 로그인되지 않거나(`unauthenticated`, `offline`, `disabled`) 사용자 설정으로 숨겨진(View Config Hidden) 프로바이더가 0% 최저 용량으로 오표기되는 버그 원천 차단. 실제 활성 인증된 서비스만 집계
- **100% 쿼터 팬텀 카운트다운 제거**: 사용 시작 전 100% 상태에서 타이머가 무의미하게 감소 표시되던 현상을 수정하고 `Ready` 상태로 명확히 표시

- **8종 대상 100% 쿼터 완충 실시간 알림 (Full Recharge Notifications)**: Antigravity IDE Gemini (5h / 주간), Antigravity IDE Claude (5h / 주간), ChatGPT / Codex (5h / 주간), Anthropic Claude Direct (5h / 주간) 4대 핵심 모델 × 2개 시간창(5시간, 주간)에 대해 100% 완충 시 IDE 네이티브 알림 발송 및 설정(`integratedPower.notifications.*`)별 개별 토글 지원
- **컴팩트 UI 텍스트 오버플로우 방지 및 포맷 통일**: 리셋 시간이 2~3자리(예: `151h`)인 경우에도 글자가 잘리거나 칸을 넘어가지 않도록 유연 렌더링, 시간/분 단위 포맷 일관성 확보
- **Antigravity 하위 모델 표기 정규화**: 불필요한 버전 숫자 표기를 덜어내고 직관적인 `Gemini`, `Claude` 레이블로 통일
- **공식 퍼블리셔 정렬 (`EggR0.integrated-power`)**: Open VSX의 계정(@EggR0)과 1:1로 일치시켜 인증 경고 없는 클린 퍼블리싱 및 네임스페이스 소유권 확립
- **3단계 점진적 반응형 UI (Progressive 3-Stage Truncation)**: 사이드바 폭에 맞춰 Full (> 290px), Medium (215px ~ 290px), Short (< 215px) 3단계로 텍스트와 라벨이 짝짝이 없이 균일하게 축약되며, 170px 이하의 극단적인 슬림 사이드바에서도 가로 스크롤 및 우측 글자 잘림 없는 무결점 레이아웃 제공
- **100% 대칭형 메트릭 & 하드웨어 레이아웃**: 모든 Provider의 `5Hours` / `Weekly` 시간창 지표와 GPU / VRAM 하드웨어 행(`[GPU] 35% load | 170.8W / 370W`, `[VRAM] 32.8% used | 7.9GB / 24GB`)의 좌우 구조, 프로그레스 바, 리셋 타이머 서식이 완벽한 시각적 대칭을 이룸
- **우측 경계선 클리핑 방지 & 방어적 텍스트 보호**: 24시간 초과 주간 리셋 타이머 간소화(`· 151h`) 및 `text-overflow: ellipsis`, 패딩 안전 여백을 통해 우측 테두리에 텍스트가 닿거나 잘리는 현상 원천 차단
- **기본 로컬 LLM Qwen 3.8 27B 탑재**: 레지스트리 및 브로커 전반의 최우선 선호 모델을 `qwen3.8:27b`로 갱신하여 고품질 로컬 추론 및 오케스트레이션 지원
- **대시보드 뷰 설정(View Settings) 및 개별 패널 토글**: 대시보드 상단 View Settings 버튼 및 확장 설정을 통해 4대 Provider(Antigravity, OpenAI/Codex, Claude, Local LLM) 및 큐(Queue), 메트릭스(Metrics), 에러(Errors) 패널의 표시/숨김을 완벽히 커스터마이징
- **UI 레이아웃 안정화 & 무음 비동기 갱신**: 5초 주기 백그라운드 쿼터 폴링 시 불필요한 내부 텔레메트리 텍스트로 인한 UI 흔들림(Layout Shift)을 완전히 제거하고 매끄러운 갱신 경험 제공
- **4대 Provider 전면 Bar UI 통일**: Antigravity IDE(Gemini/Claude), OpenAI(ChatGPT·Codex), Anthropic Claude, Local LLM(GPU) 4개 영역 모두 동일한 고품질 프로그레스 바 형태 제공
- **Qwen 3.8 27B 및 멀티 GPU 전담 오케스트레이션**: 연산 전용 보조 GPU(GPU 1번, RTX 3090 24GB)를 메인 디바이스로 자동 바인딩하여 쾌적한 로컬 LLM 추론 지원
- **Anthropic Claude 진단 및 통합**: Claude Desktop & Claude Code CLI 환경 진단 및 표준 대화·API 예산 Bar 렌더링
- **동적 로컬 모델 경로 탐색**: `$env:OLLAMA_MODELS`, `D:\AI_Models`, `~/.ollama/models`를 자동 감지하여 모든 PC 환경에서 무결점 실행
- **Node.js Native HTTP 로컬 실행기**: PowerShell 스크립트 프로세스 의존성을 최소화하고 HTTP REST 통신 기반 처리
- **최대 32k (`32,768`) 토큰 로컬 컨텍스트 지원**: RTX 3090/4090 등 고용량 VRAM 환경 모델 적재 지원
- **100% 쿼터 완충 알림 및 Windows 부팅 자동 실행(AutoStart)** 옵션 탑재

---

## 📖 시스템 아키텍처 및 상세 기술 명세

### 세 가지 독립 구성

| 구성 | 역할 | 설치·데이터 경계 |
|---|---|---|
| Integrated Power Dashboard | 사용량·상태·에이전트 실행 기록 GUI | 이 VSIX가 제공 |
| Integrated Orchestrator | 주 에이전트, Codex, 로컬 LLM(Qwen 3.8 27B) 사이의 작업 경로 선택 | 사용자가 명시적으로 설치·설정 |
| Private Git Knowledge | 지식, 작업 기록, 오류 이력을 사용자 자신의 Git에 누적 | 별도 Windows 도구가 사용자 선택으로 설정 |

세 구성은 설치 수명과 데이터 소유자가 다르다. 안전한 Configuration Center는 세 상태와 설정 진입점을 한 화면에 보여 주지만, Dashboard 활성화만으로 Orchestrator나 사용자 Knowledge를 설치·변경하지 않는다.

### 왜 세 구성을 분리하는가

- **Dashboard는 관측 도구다.** 제공자가 보고한 사용량, 로컬에서 계산한 값, 추정값과 GPU 상태를 구분해 보여 준다. 상태 화면을 여는 행위가 실행 규칙이나 사용자 파일을 바꾸면 원인 추적이 어려워지므로 관측과 변경을 분리한다.
- **Integrated Orchestrator는 실행 경로 선택 기능이다.** 현재 에이전트가 직접 처리할지, Codex에 맡길지, VRAM·backend 조건에 맞는 로컬 LLM(Qwen 3.8 27B)을 전처리에 쓸지를 설정에 따라 결정한다. 로컬 모델이 없으면 해당 경로만 비활성이고 Dashboard와 Knowledge는 계속 사용할 수 있다.
- **Private Git Knowledge는 사용자 소유 기억이다.** 제품 개발자의 저장소를 배포하는 기능이 아니라, 사용자가 선택한 Git 저장소에 작업 로그·오류 이력·계속 보존할 지식을 쌓아 PC, OS, 에이전트가 바뀌어도 다시 참조할 수 있게 한다.

이 분리는 한 구성의 장애가 다른 두 구성을 망가뜨리지 않게 하고, 다른 사용자에게 배포할 때 각자의 경로·계정·도구 설치 상태를 Configuration Center에서 다시 정할 수 있게 한다.

---

### Antigravity IDE 아티팩트 관리

Antigravity IDE는 `~/.gemini/antigravity-ide/brain/<작업 ID>/` 아래의 일반 파일을 아티팩트로 표시한다. 그래서 모델 호출마다 `scratch/prompt_*.txt`, `scratch/response_*.txt`, 임시 실행 스크립트를 만들면 같은 작업의 목록이 계속 늘어난다.

Integrated Orchestrator 3.3.0부터는 한 `brain/<작업 ID>`를 하나의 논리 작업으로 보고 그 안의 출력 경로를 기본적으로 `<작업 ID>/ip-orchestrator.md` 하나로 합친다. 짧은 지시는 파일 대신 `-PromptText`, 기존 프로젝트 자료는 `-ContextFile`로 전달하며, 출력 경로를 생략해도 타임스탬프 대신 안정된 작업 키 경로를 재사용한다. 별도 아티팩트가 정말 필요할 때만 사용자가 요청한 경우 `-ArtifactPolicy Separate`를 쓴다.

업데이트는 새 파일의 과잉 생성을 막지만 기존 `brain` 파일을 자동 삭제하거나 수정하지 않는다. 이전 목록 정리는 사용자 데이터 삭제가 포함되므로 별도 작업이다.

---

### Agy 사용량 경계

Agy TUI에서는 공식 `/usage` 명령으로 사용량을 사용자가 직접 확인할 수 있다.

Windows에서 사용자가 Agy에 로그인한 경우 Integrated Power는 로컬 프로세스에서 Windows Credential Manager의 Agy 자격 증명을 읽고 사용량 API를 조회해 Dashboard에 표시한다. 만료된 인증의 갱신이 필요하면 설치된 Agy client 정보와 refresh token을 로컬 프로세스 안에서 사용한다.

실제 access token과 refresh token 값은 Integrated Power 설정, 로그 또는 공개 저장소에 기록하지 않는다. Integrated Power가 읽은 token 값의 사본은 사용량 조회와 필요한 인증 갱신 동안 로컬 프로세스 메모리에서만 사용한다. 원본 자격 증명은 Agy가 Windows Credential Manager에서 관리하며, Integrated Power가 계정을 만들거나 로그인 정보를 배포하지 않는다.

---

### GEMINI.md 경계

Integrated Power는 전역 또는 프로젝트 `GEMINI.md`를 생성, 추가, 교체하거나 내용을 병합하지 않는다. Antigravity IDE 연동에는 plugin, `ip-orchestrator` 기계 식별자, Integrated Power 설정과 상태 파일을 사용한다.

확장 설치, 업데이트, Configuration Center 열기와 Integrated Orchestrator 설치 전후에 기존 `GEMINI.md`가 그대로 남아야 한다.

---

### 설정 센터와 명령

Dashboard와 Configuration Center는 이 VSIX가 제공하는 webview다. 별도 Tauri Control Center나 loopback broker를 설치하지 않아도 두 화면을 열 수 있으며, 외부 도구는 각 기능의 상태를 수집하거나 실제 작업을 실행할 때만 필요하다.

명령 팔레트에서 다음 명령을 사용할 수 있다. 표시 제목은 현재 `package.json`과 일치한다.

| 명령 | 동작 |
|---|---|
| `Integrated Power: Open Configuration Center` | 세 구성의 통합 설정 페이지 열기 |
| `Integrated Power: Run First-Run Setup` | 최초 설정 개요 열기 |
| `Integrated Power: Configure Dashboard` | Dashboard 설정 영역 열기 |
| `Integrated Power: Configure Integrated Orchestrator` | Integrated Orchestrator 설정 영역 열기 |
| `Integrated Power: Configure Private Git Knowledge` | 사용자 Knowledge 설정 영역 열기 |
| `Integrated Power: Install or Update Integrated Orchestrator` | 설치 계획과 충돌 상태 확인 |

명령의 내부 `integratedPower.*` ID와 `ip-orchestrator` 기계 식별자는 호환성을 위해 유지한다.

개요 탭의 **상태 다시 확인**은 단순히 이전 결과를 다시 표시하지 않는다. 버튼을 누를 때 Windows 레지스트리의 최신 사용자·시스템 PATH와 GitHub CLI, Git, Ollama의 표준 설치 위치를 다시 읽는다. 따라서 IDE 실행 후 설치한 CLI도 IDE를 재시작하지 않고 감지할 수 있다. Ollama, Codex, Agy와 GitHub CLI는 관련 경로를 켜지 않았다면 “고장”이 아니라 선택 사항으로 표시한다.

Dashboard 표시 항목은 Antigravity IDE 설정에서 선택할 수 있다.

| 설정 | 기본값 | 설명 |
|---|---:|---|
| `integratedPower.view.showAntigravity` | `true` | Antigravity IDE 상태 영역 표시 |
| `integratedPower.view.showCodex` | `true` | Codex 상태 영역 표시 |
| `integratedPower.view.showClaude` | `true` | Anthropic Claude 상태 영역 표시 |
| `integratedPower.view.showLocalLlm` | `true` | 로컬 LLM·GPU 상태 영역 표시 |
| `integratedPower.view.showQueue` | `true` | AI Work Queue 패널 표시 |
| `integratedPower.view.showMetrics` | `true` | Recent Metrics 패널 표시 |
| `integratedPower.view.showErrors` | `true` | Errors 패널 표시 |
| `integratedPower.notifications.notifyOnFullTokens` | `true` | 개별 모델 쿼터 100% 충전 시 알림 |

---

### Integrated Orchestrator와 로컬 LLM

Integrated Orchestrator는 다음 두 정책을 제공한다.

- `user_default`: 사용자가 지정한 provider, endpoint와 model ID를 우선하며 임의로 다른 모델로 바꾸지 않는다.
- `auto`: 현재 여유 VRAM, Compute Capability, backend 요구 조건, 설치 모델 크기, VRAM 예약량, CPU offload 허용 여부와 작업 적합도를 평가한다.

가중치 양자화 이름(Q4, MXFP4 등)과 GPU의 native FP4·FP8 연산 지원을 같은 것으로 취급하지 않는다. Ollama는 설치 모델 중 선택·실행할 수 있고, vLLM은 endpoint에 이미 로드된 모델과의 적합성을 확인한다. 자동 선택 결과는 추정 근거와 사용자 override를 구분해 기록한다.

Ollama를 선택하고 설정을 저장하거나 **설치 모델 다시 확인·레지스트리 동기화**를 누르면 `/api/tags`를 우선 사용하고 `ollama ls`를 호환 fallback으로 사용해 현재 PC의 모델을 조사한다. 설치됐지만 번들 목록에 없는 모델은 `%USERPROFILE%\.config\integrated-power\local_llm_model_registry.csv`에 중립 점수로 등록한다. Ollama가 제공하는 family, parameter size, quantization, 실제 파일 크기를 함께 기록하므로 다른 PC의 고정 목록을 그대로 재사용하지 않는다.

레지스트리에만 있고 설치되지 않은 모델은 정보로 표시할 뿐 자동으로 내려받지 않는다. 실제 작업에 맞는 설치 모델이 하나도 없을 때만 선택기가 VRAM 조건을 통과한 상위 후보를 반환하고, 에이전트는 정확한 모델 이름을 설명한 뒤 사용자에게 설치 여부를 물어야 한다. 승인 전에는 `ollama pull`을 실행하지 않는다. 실제 추론 요청은 `keep_alive`를 포함하며, `/api/ps`에서 모델이 내려가 있는 경우 cold-load용 긴 제한 시간을 적용한다.

---

### Private Git Knowledge

Integrated Power는 개발자의 Knowledge 저장소 내용을 배포하지 않는다. 각 사용자는 자신의 private Git remote 또는 원격 없는 `local_only` 저장소를 선택한다.

확장에는 Win11용 Knowledge 설정·분류·저장 도구가 포함된다. Configuration Center의 **내장 Knowledge 도구 설치·복구**가 이를 `%LOCALAPPDATA%\IntegratedPower\bin`에 설치하므로 별도 `environment-bootstrap` clone은 필수가 아니다.

Git 작성자 email은 commit metadata이며 로그인 수단이 아니다. 원격 인증은 Git Credential Manager 또는 SSH agent가 담당한다. 최초 설정·재설정 마법사는 기존 branch와 dirty 변경을 보존하며 commit, pull, rebase, checkout과 push를 자동 실행하지 않는다.

마법사는 기존 파일을 덮어쓰지 않고 빠진 Obsidian 기본 구조와 `.ai/knowledge-routing.json`만 만든다.

| 경로 | 지식 종류 |
|---|---|
| `00 Inbox` | 분류가 불확실한 기록과 Agent Worklog |
| `10 Projects` | 종료 조건이 있는 프로젝트 |
| `20 Knowledge` | 여러 작업에서 재사용할 지식·방법 |
| `30 Areas` | 지속적으로 관리할 운영·책임 영역 |
| `90 Templates` | 재사용 서식 |

에이전트는 `route-knowledge`로 기존 id·별칭·제목·파일명을 먼저 검사한다. 같은 주제가 있으면 기존 문서를 갱신하고, 불확실하면 새 폴더 대신 `00 Inbox`를 쓴다. `save-knowledge`와 `save-agent-worklog`는 명시된 허용 파일만 검증·stage·commit하고 origin이 있으면 `main`을 `pull --rebase --autostash`한 뒤 force 없이 push한다. Knowledge의 최종 기준은 항상 `main`이며 작업 이름의 `agent/...` 브랜치를 만들지 않는다. 코드·설정 저장소의 임시 작업 브랜치 정책과 구분된다.

---

### 상태와 설정 경로

| 데이터 | Windows 경로 |
|---|---|
| 공통 root 설정 | `%USERPROFILE%\.config\integrated-power\roots.json` |
| 기본 runtime state | `%LOCALAPPDATA%\IntegratedPower\state` |
| Integrated Orchestrator 설정 | `%USERPROFILE%\.config\integrated-power\orchestrator.json` |
| 사용자 로컬 LLM 레지스트리 | `%USERPROFILE%\.config\integrated-power\local_llm_model_registry.csv` |
| Antigravity IDE plugin | Configuration Center에서 확정한 plugin root 아래 `ip-orchestrator-plugin` |
| Win11 Knowledge 명령 | 기본 `%LOCALAPPDATA%\IntegratedPower\bin`, 사용자 지정 가능 |
| Private Git Knowledge | 사용자가 최초 설정에서 선택 |

경로 결정은 **명시적 환경 변수 → 이 PC의 canonical `roots.json` → 현재 OS·사용자의 제안값** 순서다. 확장은 사용자 홈 전체나 다른 드라이브에서 비슷한 이름의 폴더를 검색하지 않는다. Configuration Center에서 공통 작업 루트, Knowledge 경로, Antigravity 플러그인 루트를 확인하고 저장한 값만 사용한다. Knowledge가 WorkRoot 밖에 있어도 사용자 선택을 존중하며 기존 저장소를 자동 이동·병합·삭제하지 않는다.

---

### 의존성

| 의존성 | 필요한 경우 | 자동 설치 |
|---|---|---|
| Antigravity IDE | 항상 | 하지 않음 |
| VSIX JavaScript runtime | 항상 | VSIX에 포함 |
| Git for Windows | Private Git Knowledge 사용 시 | 하지 않음 |
| Codex CLI | Codex 경로 사용 시 | 하지 않음 |
| Ollama 또는 vLLM | 로컬 LLM 경로 사용 시 | 하지 않음 |
| NVIDIA driver와 `nvidia-smi` | NVIDIA GPU 측정 시 | 하지 않음 |
| Agy | Agy 사용량을 Dashboard에 표시할 때 | 하지 않음 |

GPU driver, 모델, 서비스 포트, Git 인증과 API 자격 증명은 묵시적으로 설치하거나 변경하지 않는다. Configuration Center는 존재 여부와 영향을 진단하고 설정 위치를 안내한다.

---

### 문제 해결

#### 확장은 설치됐지만 명령이 보이지 않음
1. Antigravity IDE의 Extensions 화면에서 Integrated Power가 활성화됐는지 확인한다.
2. `Developer: Reload Window`를 실행한다.
3. 명령 팔레트에서 `Integrated Power:`를 다시 검색한다.
4. 계속 실패하면 다음 확장 호스트 로그에서 활성화 오류를 확인한다:
   `%APPDATA%\Antigravity IDE\logs\<최근 세션>\window1\exthost\exthost.log`

#### 별도 Antigravity가 시작됨
확장 관리에는 다음 wrapper만 사용한다:
```text
%LOCALAPPDATA%\Programs\Antigravity IDE\bin\antigravity-ide.cmd
```

#### 로그인 또는 인증 문제
Antigravity IDE, Codex, Agy와 Git 인증은 각 제품이 소유한다. Integrated Power는 사용자 계정을 삭제하거나 로그인 상태를 복구하지 않는다. 확장 활성화 오류와 인증 오류를 같은 원인으로 단정하지 말고 제품별 로그를 분리해 확인한다. Agy 사용량이 표시되지 않으면 Agy TUI에서 로그인을 확인하고 `/usage`가 동작하는지 먼저 확인한다.

---

## 📦 메타데이터 & 공개 사양

| 항목 | 사양 |
|---|---|
| 제품 표시명 | Integrated Power |
| Publisher / 네임스페이스 | **EggR0** |
| 확장 ID | **`EggR0.integrated-power`** |
| 현재 버전 | **`0.9.5`** |
| 공개 마켓 | [Open VSX Registry](https://open-vsx.org/extension/EggR0/integrated-power) · [GitHub Releases](https://github.com/EggR0/integrated-power/releases/tag/v0.9.5) |
| 지원 OS | Windows 11 |
| 주 타깃 IDE | Antigravity IDE (VS Code ^1.80.0 호환) |
| 라이선스 | PolyForm Strict License 1.0.0 ([LICENSE](LICENSE)) |

---

## 📚 관련 문서
* [통합 배포 및 릴리스 가이드](docs/distribution/release-and-deployment-guide.ko.md)
* [Open VSX 자동 배포 가이드](docs/distribution/open-vsx-publishing.ko.md)
* [변경 이력 (CHANGELOG.md)](CHANGELOG.md)
* [상세 지원 정책 (SUPPORT.md)](SUPPORT.md)
* [상업용 라이선스 안내 (COMMERCIAL-LICENSING.md)](COMMERCIAL-LICENSING.md)
