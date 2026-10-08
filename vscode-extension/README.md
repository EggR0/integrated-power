# Integrated Power

[![Open VSX](https://img.shields.io/open-vsx/v/EggR0/integrated-power?color=blue&label=Open%20VSX)](https://open-vsx.org/extension/EggR0/integrated-power)
[![GitHub Release](https://img.shields.io/github/v/release/EggR0/integrated-power?color=green&label=GitHub%20Release)](https://github.com/EggR0/integrated-power/releases/tag/v0.9.2)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/EggR0/integrated-power?color=orange&label=Downloads)](https://open-vsx.org/extension/EggR0/integrated-power)
[![Platform](https://img.shields.io/badge/Platform-Windows%2011-blue)](https://github.com/EggR0/integrated-power)
[![Target](https://img.shields.io/badge/Target-Antigravity%20IDE-purple)](https://github.com/EggR0/integrated-power)

> **"Quota를 기다리는 대시보드가 아니라, 작업을 다음 실행 경로로 이어 주는 AI 작업 컨트롤 센터"**

Integrated Power는 **Antigravity IDE 전용 확장 프로그램**이다. Windows 11에서 에이전트 잔여 사용량(Quota), 작업 상태, GPU 및 로컬 연산 자원을 한 화면에 통합 표시하고, 작업이 Quota에 걸려 중단되지 않도록 **최적의 AI 실행 경로(Antigravity · Codex · Claude · Local LLM Qwen 3.8 27B)**로 매끄럽게 연결합니다.

---

## ⚡ 빠른 시작 & 설치 (Quick Start)

### 방법 1. Open VSX 마켓플레이스 설치 (가장 추천)
Antigravity IDE 또는 VS Code 확장 탭(`Ctrl+Shift+X`)에서 **`Integrated Power`** 또는 **`EggR0.integrated-power`**를 검색하여 클릭 한 번으로 설치할 수 있습니다.
* **Open VSX 등록 페이지**: [open-vsx.org/extension/EggR0/integrated-power](https://open-vsx.org/extension/EggR0/integrated-power)

### 방법 2. GitHub Releases VSIX 다운로드 및 CLI 설치
검증된 최신 패키지 [`integrated-power-0.9.2.vsix`](https://github.com/EggR0/integrated-power/releases/download/v0.9.2/integrated-power-0.9.2.vsix)를 다운로드한 후, PowerShell에서 아래 명령어로 설치합니다:

```powershell
# PowerShell
& "$env:LOCALAPPDATA\Programs\Antigravity IDE\bin\antigravity-ide.cmd" `
  --install-extension ".\integrated-power-0.9.2.vsix" `
  --force

# 또는 CMD
"%LOCALAPPDATA%\Programs\Antigravity IDE\bin\antigravity-ide.cmd" --install-extension ".\integrated-power-0.9.2.vsix" --force
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

---

## 🚀 주요 기능 (v0.9.2)

1. **8종 대상 100% 쿼터 완충 실시간 알림 (Full Recharge Notifications)**:
   - Antigravity IDE Gemini (5h / 주간)
   - Antigravity IDE Claude (5h / 주간)
   - ChatGPT / Codex (5h / 주간)
   - Anthropic Claude Direct (5h / 주간)
   - 토큰 100% 리차지 시 즉각적인 IDE 알림 및 개별 토글 지원
2. **3단계 점진적 반응형 컴팩트 UI (Progressive 3-Stage Truncation)**:
   - 사이드바 너비에 맞춰 Full (> 290px), Medium (215px ~ 290px), Short (< 215px) 3단계 자동 최적화
   - 리셋 시간이 2~3자리(예: `151h`)인 경우에도 글자가 잘리거나 칸을 벗어나지 않는 방어적 텍스트 렌더링
3. **4대 Provider 전면 대칭형 Bar UI 통일**:
   - Antigravity IDE, OpenAI(ChatGPT·Codex), Anthropic Claude, Local LLM 전 영역에 일관된 프로그레스 바 적용
   - 불필요한 버전 숫자 노이즈를 덜어낸 직관적인 `Gemini`, `Claude` 레이블
4. **로컬 LLM Qwen 3.8 27B 및 전용 GPU 자동 바인딩**:
   - 보조 연산 GPU(GPU 1번, RTX 3090 24GB 등)를 기본 디바이스로 자동 감지·바인딩
   - GPU 캐싱 및 공유 용량 서머리(Capacity Summary) 지원
5. **대시보드 뷰 설정(View Settings) 및 패널 커스터마이징**:
   - Provider별 카드 및 작업 큐(Queue), 메트릭스(Metrics), 에러(Errors) 패널을 자유롭게 토글

---

## 🛡️ 프라이버시 및 데이터 경계 (Privacy First)

* **자격 증명 무전송**: 사용자를 대신해 계정에 로그인하거나 비밀번호, API 키를 외부 서버로 전송하지 않습니다.
* **Quota 무조작**: Quota를 강제로 늘리거나 제공자 정책을 우회하지 않으며, 정확한 잔여량 관측과 안전한 분기 경로만을 제공합니다.
* **독립 아키텍처**: Dashboard(관측 GUI), Integrated Orchestrator(실행 경로 선택), Private Git Knowledge(사용자 소유 Git 작업 로그) 3개 구성이 완전히 분리되어 있어 특정 구성의 장애가 다른 구성에 영향을 주지 않습니다.
* **GEMINI.md 비간섭**: 전역 또는 프로젝트의 기존 `GEMINI.md` 파일을 임의로 덮어쓰거나 수정하지 않습니다.

---

## 📦 메타데이터 & 공개 사양

| 항목 | 사양 |
|---|---|
| 제품 표시명 | Integrated Power |
| Publisher / 네임스페이스 | **EggR0** |
| 확장 ID | **`EggR0.integrated-power`** |
| 현재 버전 | **`0.9.2`** |
| 공개 마켓 | [Open VSX Registry](https://open-vsx.org/extension/EggR0/integrated-power) · [GitHub Releases](https://github.com/EggR0/integrated-power/releases/tag/v0.9.2) |
| 지원 OS | Windows 11 |
| 주 타깃 IDE | Antigravity IDE (VS Code ^1.80.0 호환) |
| 라이선스 | PolyForm Strict License 1.0.0 ([LICENSE](LICENSE)) |

---

## 📚 관련 문서
* [Open VSX 자동 배포 가이드](../docs/distribution/open-vsx-publishing.ko.md)
* [변경 이력 (CHANGELOG.md)](CHANGELOG.md)
* [상세 지원 정책 (SUPPORT.md)](SUPPORT.md)
* [상업용 라이선스 안내 (COMMERCIAL-LICENSING.md)](COMMERCIAL-LICENSING.md)
