# Integrated Power

[![Open VSX](https://img.shields.io/open-vsx/v/EggR0/integrated-power?color=blue&label=Open%20VSX)](https://open-vsx.org/extension/EggR0/integrated-power)
[![GitHub Release](https://img.shields.io/github/v/release/EggR0/integrated-power?color=green&label=GitHub%20Release)](https://github.com/EggR0/integrated-power/releases/latest)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/EggR0/integrated-power?color=orange&label=Downloads)](https://open-vsx.org/extension/EggR0/integrated-power)
[![Platform](https://img.shields.io/badge/Platform-Windows%2011%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/EggR0/integrated-power)
[![Target](https://img.shields.io/badge/Target-Antigravity%20IDE%20%7C%20VS%20Code%20%7C%20IPCC-purple)](https://github.com/EggR0/integrated-power)

> **"멀티 AI 쿼터 실시간 추적, 5시간 프리웜(Pre-warm) 최적화, 독립형 헤드리스 브로커, 로컬 GPU 및 5TB 클라우드 스토리지를 통합 관제하는 올인원 AI 엔지니어링 플랫폼"**

Integrated Power는 **Antigravity IDE, VS Code 및 독립형 데스크톱 관제 센터(IPCC)**를 위한 차세대 멀티 AI 브로커 및 리소스 오케스트레이션 플랫폼입니다. Windows 11, macOS, Linux 환경에서 4대 핵심 AI 모델(Antigravity Gemini · Antigravity Claude · ChatGPT/Codex · Claude Direct)의 실시간 쿼터(5시간/주간), 5시간 선행 프리웜, 3계층 스토리지, 로컬 GPU 하드웨어 텔레메트리를 단일 시스템에서 직관적으로 통합 관제합니다.

---

## ⚡ 빠른 시작 (Quick Start)

1. **대시보드 열기**: Antigravity IDE 또는 VS Code 좌측 액티비티 바에서 **Integrated Power** 아이콘을 클릭하거나, 명령 팔레트(`Ctrl+Shift+P` / `Cmd+Shift+P`)에서 `Integrated Power: Open Dashboard`를 실행합니다.
2. **독립 관제 센터(IPCC) 실행**: IDE 없이도 백그라운드에서 브로커를 구동하거나, 독립형 Tauri 데스크톱 앱(IPCC)을 통해 시스템 전역을 관제할 수 있습니다.
3. **실시간 쿼터 모니터링**: 상단 `Token Status` 패널에서 Gemini, Claude, ChatGPT의 5시간 및 주간 쿼터 잔여율과 실시간 리셋 타이머를 확인합니다.
4. **5시간 쿼터 프리웜(Pre-warm)**: 각 모델 헤더에서 `Click`(수동), `Once`(1회 자동), `Always`(상시 자동) 모드를 선택하여 대기 시간 없이 충전 카운트다운을 선행 가동합니다.

---

## 🚀 주요 핵심 기능 (Key Features)

### 1. 3-Mode 5시간 쿼터 프리웜 (Smart Pre-warm Strategy)
- **배경**: 5시간 쿼터는 첫 사용 시점부터 카운트다운되므로, 사용 전 100% 상태에서는 타이머가 돌지 않아 작업 개시 후 충전까지 만 5시간을 온전히 기다려야 함
- **해결**: 미사용 100% 대기 쿼터에 대해 백그라운드 초단기 취소 핑(Instant Cancellation Ping)을 트리거하여, 토큰 용량은 99.9% 이상 보존하면서 5시간 리셋 카운트다운을 사전 개시.
- **모드 지원**: `Always`(자동 감지 상시 가동), `Once`(세션 시작 시 1회 선행 충전), `Click`(원클릭 수동 트리거)

### 2. 8종 대상 100% 쿼터 완충 실시간 알림 (Full Recharge Notifications)
- Antigravity IDE Gemini (5h / 주간), Antigravity IDE Claude (5h / 주간), ChatGPT / Codex (5h / 주간), Anthropic Claude Direct (5h / 주간) 4대 핵심 모델 × 2개 시간창(총 8개 타깃)에 대해 100% 충전 즉시 네이티브 알림 발송.

### 3. 독립형 헤드리스 브로커 데몬 (Standalone Headless Daemon on 37241)
- **탈(脫)IDE 독립 상주**: IDE가 켜져 있지 않아도 루프백 포트 `127.0.0.1:37241`에서 상시 대기하며, IPCC(Tauri), Claude Desktop, ChatGPT App, 모바일 인입 등 외부 클라이언트를 수용.
- **선점 및 자동 어태치 (Probe & Attach)**: IDE 실행 시 브로커를 중복 기동하지 않고 실행 중인 37241 데몬에 즉각 가볍게 어태치.

### 4. 에이전트 비자율성(Non-Autonomy) 대응 내구성 프로토콜
- **통찰**: *"에이전트는 자동화된 무한 프로세스가 아니라, 언제든 중단되거나 실패할 수 있는 휘발성 세션이다."*
- **7단계 내구성 생애주기**: `Inbox` -> `Queued` (멱등키 발급) -> `Dispatched` -> `AwaitingApproval` -> `Executing` -> `Offloaded` -> `Distilled`.
- **에이전트 셀프 승인 차단 (Block Self-Approval)**: 파괴적 작업(파일 삭제, git push, 외부 전송, 결제)은 에이전트가 스스로 승인할 수 없으며, 오직 IPCC 또는 IDE 제어 패널의 물리적 사용자 클릭 인터랙션으로만 승인.

### 5. 3계층 멀티 티어 스토리지 (Tiered Storage Architecture)
- **Tier 1 (로컬 원장 - 기본 탑재)**: 100% 오프라인 작동하는 로컬 SQLite/암호화 원장 (`stateRoot`).
- **Tier 2 (Google Drive 5TB 클라우드 - 선택 연동)**:
  - 개인 구글 계정(무료 15GB ~ Google One 5TB)을 2차 스토리지로 연결.
  - **모바일/웹 메모 인입 (Option B)**: 스마트폰에서 Google Drive `IntegratedPower/Inbox`에 올린 메모를 브로커 태스크로 자동 인입.
  - **대용량 아티팩트 오프로드 (Option C)**: VSIX 번들, 브라우저 QA 녹화 영상(WebP/MP4), 거대 로그를 Google Drive로 비동기 업로드하여 로컬 SSD 절약 및 영구 `webViewLink` 발급.
- **Tier 3 (GitHub 지식 저장소 - Obsidian Vault 증류)**:
  - `DriveKnowledgeDistillationBridge`를 통해 핵심 요약 지식과 아키텍처 결정(ADR)만 가벼운 마크다운 문서로 변환하여 Obsidian Vault(`eggr-knowledge`)에 커밋/푸시. 무거운 바이너리는 드라이브 링크로 연결하여 Git 용량 한도(100MB) 보존.

### 6. 로컬 연산 자원 & GPU 텔레메트리
- 로컬 연산 패널에서 GPU Load, VRAM 사용량, 소모 전력(`[GPU] 35% load | 170.8W / 370W`)을 대칭형 프로그레스 바로 실시간 모니터링.
- 기본 로컬 LLM으로 `qwen3.8:27b`를 자동 바인딩하여 안전한 오프라인 전처리/추론 지원.

---

## 🏛️ 4대 코어 시스템 아키텍처

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        클라이언트 / UI 계층                            │
├─────────────────────┬──────────────────────────┬───────────────────────┤
│  Antigravity IDE    │   IPCC (Control Center)  │  외부 에이전트 / MCP   │
│  (VS Code 확장)     │   (Tauri Cross-Platform) │  (Claude / ChatGPT)   │
└──────────┬──────────┴────────────┬─────────────┴───────────┬───────────┘
           │                       │                         │
           └───────────────────────┼─────────────────────────┘
                                   │ HTTP Loopback (127.0.0.1:37241)
                                   │ SSE /v1/events
┌──────────────────────────────────▼─────────────────────────────────────┐
│              독립형 헤드리스 브로커 데몬 (Standalone Daemon)            │
│   (scripts/standalone-broker.js / control-center/broker-server.js)     │
├────────────────────────────────────────────────────────────────────────┤
│  - Task Queue & Event Ledger (Encrypted / Durable / Idempotent)        │
│  - Human-in-the-Loop Approval Engine (No Autonomous Self-Approval)     │
│  - Multi-AI Quota & Pre-warm Controller (Gemini / Claude / Codex)       │
│  - Local Compute & VRAM-aware Runner (Ollama / vLLM / Qwen 3.8 27B)    │
│  - Cloud Storage Tier 2 Broker (Google Drive 5TB Ingestion & Offload)   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                 OS 추상화 계층 (platformPaths.ts)                       │
├─────────────────────┬──────────────────────────┬───────────────────────┤
│    Windows 11       │          macOS           │         Linux         │
│  %LOCALAPPDATA%     │ ~/Library/App Support    │  $XDG_DATA_HOME       │
│  DPAPI / WinCred    │ Keychain (security)      │  secret-tool (libsec) │
│  Registry Autostart │ launchd LaunchAgents     │  XDG autostart        │
└─────────────────────┴──────────────────────────┴───────────────────────┘
```

---

## ☁️ 스토리지 및 외부 계정 연결 안내

사용자는 필요에 따라 원하는 저장 수단을 유연하게 결합할 수 있습니다:

| 스토리지 티어 | 지원 수단 | 설정 방법 및 가이드 |
| :--- | :--- | :--- |
| **Tier 1 (로컬)** | 로컬 암호화 SQLite/JSONL 원장 | **기본 탑재 (추가 설정 불필요)** |
| **Tier 2 (클라우드)** | Google Drive (무료 15GB ~ 5TB) | [Google Drive 연동 가이드](../docs/guides/google-drive-mcp-setup.ko.md) 참조 (약 3분 소요) |
| **Tier 3 (지식)** | GitHub 기반 Obsidian Vault | [멀티 티어 스토리지 총괄 가이드](../docs/guides/storage-backends.ko.md) 참조 |

---

## 🛠️ 내장 공식 MCP 서버 & 에이전트 스킬

Integrated Power는 외부 에이전트 도구와의 연동을 위해 **공식 내장 MCP(Model Context Protocol) 서버**와 **오케스트레이션 에이전트 스킬**을 기본 제공합니다.

### 1. 내장 공식 MCP 서버 (`integrated-power`)
* **지원 프로토콜**: 로컬 고속 `stdio` 통신 및 HTTP/SSE (`/mcp`, `/sse`) 엔드포인트 동시 지원
* **외부 클라이언트**: Claude Desktop 및 ChatGPT Developer 커넥터 원클릭 연동 지원
* **주요 도구**:
  - `integrated_power_get_token_status`: 실시간 모델별 쿼터 잔여율, 리셋 잔여 시간 및 최적 모델 가이드
  - `integrated_power_quick_delegate`: 외부 에이전트에서 Antigravity, Codex, 로컬 LLM으로 단일 작업 즉시 위임
  - `integrated_power_create_task` / `integrated_power_delegate`: 통합 작업 큐에 태스크 생성 및 위임
  - `integrated_power_request_approval` / `integrated_power_merge`: 안전 승인 요청 및 결과 브랜치 병합

### 2. 오케스트레이션 에이전트 스킬 (`ip-orchestrator`)
* **Routing Decision**: VRAM 및 복잡도 분석을 통한 최적 모델 자동 배정
* **Debate Mode**: 핵심 아키텍처 및 치명적 버그에 대한 모델 간 상호 비판(Writer-Critic) 및 교차 검증
* **Local LLM Mode**: 오프라인 Qwen 3.8 27B 기반 제로 클라우드 토큰 로컬 전처리

---

## 💻 크로스 플랫폼 표준 경로 규약

| 데이터 종류 | Windows 11 | macOS | Linux (XDG 규약) |
| :--- | :--- | :--- | :--- |
| **상태 원장 루트 (`stateRoot`)** | `%LOCALAPPDATA%\IntegratedPower\state` | `~/Library/Application Support/IntegratedPower/state` | `$XDG_DATA_HOME/IntegratedPower/state`<br>(기본: `~/.local/share/...`) |
| **설정 디렉터리 (`configDir`)** | `%APPDATA%\IntegratedPower` | `~/.config/integrated-power` | `$XDG_CONFIG_HOME/integrated-power`<br>(기본: `~/.config/...`) |
| **캐시 디렉터리 (`cacheDir`)** | `%LOCALAPPDATA%\IntegratedPower\cache` | `~/Library/Caches/IntegratedPower` | `$XDG_CACHE_HOME/integrated-power`<br>(기본: `~/.cache/...`) |
| **Google Drive MCP 인증키** | `%USERPROFILE%\.config\google-drive-mcp\` | `~/.config/google-drive-mcp/` | `~/.config/google-drive-mcp/` |

---

## 📦 메타데이터 & 공개 배포 사양

| 항목 | 사양 |
| :--- | :--- |
| **제품 표시명** | Integrated Power |
| **Publisher / 네임스페이스** | **EggR0** |
| **확장 ID** | **`EggR0.integrated-power`** |
| **현재 최신 버전** | **`v0.10.1`** |
| **공식 마켓플레이스** | [Open VSX Registry](https://open-vsx.org/extension/EggR0/integrated-power) · [GitHub Releases (Latest)](https://github.com/EggR0/integrated-power/releases/latest) |
| **지원 플랫폼** | Windows 11, macOS, Linux |
| **지원 클라이언트** | Antigravity IDE, VS Code (^1.80.0), Standalone Desktop IPCC (Tauri) |
| **라이선스** | PolyForm Strict License 1.0.0 ([LICENSE](../LICENSE)) |

---

## 📚 관련 상세 기술 문서

* [Google Drive MCP 연동 및 배포 가이드](../docs/guides/google-drive-mcp-setup.ko.md)
* [멀티 티어 스토리지 연동 및 선택 가이드](../docs/guides/storage-backends.ko.md)
* [브로커 탈(脫)IDE화 및 IPCC 크로스 플랫폼 아키텍처 규약](../docs/reference/cross-platform-broker-ipcc.ko.md)
* [에이전트 비자율성 대응 내구성 브로커 프로토콜 규약](../docs/reference/durable-agent-broker-protocol.ko.md)
* [Google Drive 2차 스토리지 브로커 연동 규약](../docs/reference/google-drive-storage-broker.ko.md)
* [통합 배포 및 릴리스 가이드](../docs/distribution/release-and-deployment-guide.ko.md)
* [프로젝트 변경 이력 (CHANGELOG.md)](../CHANGELOG.md)
