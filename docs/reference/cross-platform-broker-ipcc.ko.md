# Integrated Power 브로커 탈(脫)IDE화 및 IPCC 크로스 플랫폼 아키텍처 규약

## 1. 배경 및 설계 철학

기존 Integrated Power 브로커는 Antigravity IDE (VS Code 기반) 확장 프로세스 생명주기에 종속되어 있어, IDE가 닫히면 브로커도 함께 종료되는 구조적 한계가 있었습니다. 이로 인해 데스크톱 Control Center(IPCC), Claude Desktop, ChatGPT App, 모바일 인입 등 외부 에이전트/클라이언트가 브로커에 지속적으로 연결되지 못했습니다.

또한 기존 많은 스크립트가 Windows 11 및 PowerShell 환경에 편중되어 있어, macOS 및 Linux 환경으로의 확장에 제약이 있었습니다.

본 규약은 **(1) Antigravity IDE로부터 브로커를 완전 분리한 독립형 헤드리스 데몬(Standalone Headless Daemon)**과, **(2) Windows 11·macOS·Linux를 아우르는 OS 중립적 Integrated Power Control Center (IPCC)** 아키텍처를 정의합니다.

---

## 2. 3계층 디커플링 아키텍처

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
│  - Task Queue & Event Ledger (Encrypted/Durable)                       │
│  - Human-in-the-Loop Approval Engine (No Self-Approval)                │
│  - Local LLM & Quota Controller (Ollama/vLLM/OpenAI/Gemini/Anthropic)  │
│  - Cloud Storage Tier 2 Broker (Google Drive 5TB Ingestion & Offload)   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                 OS 추상화 계층 (platformPaths.ts)                       │
├─────────────────────┬──────────────────────────┬───────────────────────┤
│    Windows 11       │          macOS           │         Linux         │
│  %LOCALAPPDATA%     │ ~/Library/App Support    │  $XDG_DATA_HOME       │
│  DPAPI / Credential │ Keychain (security)      │  secret-tool (libsec) │
│  Registry Autostart │ launchd LaunchAgents     │  XDG autostart        │
└─────────────────────┴──────────────────────────┴───────────────────────┘
```

---

## 3. 크로스 플랫폼 OS 경로 및 환경 추상화 (`platformPaths.ts`)

브로커 및 IPCC는 OS별 표준 디렉터리 규약을 철저히 준수합니다.

| 플랫폼 | 상태 원장 루트 (`stateRoot`) | 설정 디렉터리 (`configDir`) | 캐시 디렉터리 (`cacheDir`) |
| :--- | :--- | :--- | :--- |
| **Windows** | `%LOCALAPPDATA%\IntegratedPower\state` | `%APPDATA%\IntegratedPower` | `%LOCALAPPDATA%\IntegratedPower\cache` |
| **macOS** | `~/Library/Application Support/IntegratedPower/state` | `~/.config/integrated-power` | `~/Library/Caches/IntegratedPower` |
| **Linux (XDG)** | `$XDG_DATA_HOME/IntegratedPower/state`<br>(기본: `~/.local/share/...`) | `$XDG_CONFIG_HOME/integrated-power`<br>(기본: `~/.config/...`) | `$XDG_CACHE_HOME/integrated-power`<br>(기본: `~/.cache/...`) |

### 보안 키스토어 (Ledger Key Storage)
- **Windows**: Windows Credential Manager (`wincred`) 우선, 부재 시 사용자별 `DPAPI` 폴백.
- **macOS**: Apple Keychain CLI (`security find-generic-password`).
- **Linux**: FreeDesktop Secret Service (`secret-tool`).
- **헤드리스/CI 환경**: 암호화된 파일 키 격리 폴백 지원.

---

## 4. 독립형 브로커 라이프사이클 및 어태치(Attach) 규약

1. **포트 단일성**: 브로커는 루프백 포트 `37241` (`127.0.0.1:37241`)을 유일한 권위 엔드포인트로 바인딩합니다.
2. **선점 및 어태치 (Probe & Attach)**:
   - IPCC, IDE 확장, 또는 CLI 스크립트가 기동될 때 `http://127.0.0.1:37241/health`를 먼저 프로브합니다.
   - 이미 브로커가 실행 중이면 중복 실행하지 않고 즉시 해당 브로커에 어태치(`attached: true`)합니다.
   - 브로커가 미실행 상태이면 직접 데몬을 기동하여 서비스를 활성화합니다.
3. **우아한 셧다운 (Graceful Shutdown)**:
   - `SIGINT`, `SIGTERM` 수신 시 활성 SSE 스트림을 안전하게 닫고 원장 트랜잭션을 플러시한 후 0으로 종료합니다.

---

## 5. IPCC (Integrated Power Control Center) 로드맵

1. **Tauri 기반 멀티 플랫폼 빌드**:
   - Windows x64 NSIS 인스톨러뿐만 아니라 macOS DMG / `.app` 번들, Linux AppImage / `.deb` 빌드를 동일한 프론트엔드 및 Rust 백엔드 구조에서 지원.
2. **IDE 없는 단독 관제**:
   - IDE가 없어도 IPCC 대시보드에서 실시간 5시간 쿼터 잔여량 조회, 로컬 모델 전환(Qwen2.5/3.8), Google Drive 인입 태스크 모니터링, 작업 승인/거절을 독자적으로 완수.
