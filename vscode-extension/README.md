# Antigravity IDE Dashboard

**Antigravity IDE Dashboard** is a comprehensive VS Code extension designed to track AI agent runs, token capacity, and local LLM hardware metrics in a single unified view.

---

## 🌟 Features (English)

* **Unified Token Capacity Tracking**
  Keep track of your API token usage and quotas for various AI models, including:
  * Gemini 3.1 Pro (Antigravity IDE)
  * Opus 4.6 Thinking
  * Codex

* **Local LLM & Hardware Metrics**
  Monitor your local compute environment in real-time. View detailed GPU statistics including:
  * GPU Utilization (%)
  * VRAM Usage (MB)
  * Power Draw / Limit (W)

* **Agent Runs & Artifact Management**
  * View active and completed AI agent runs directly within VS Code.
  * Access detailed run logs and open underlying JSONL run files with a single click.
  * Click on generated artifacts in the dashboard to instantly open them in the editor.

* **Customizable Dashboard View**
  Configure the dashboard to show only what you need. Using VS Code Settings (`Ctrl + ,`), you can toggle the visibility of specific capacity sections:
  * `integratedPower.view.showAntigravity`: Show/hide the Antigravity IDE capacity section.
  * `integratedPower.view.showCodex`: Show/hide the Codex capacity section.
  * `integratedPower.view.showLocalLlm`: Show/hide the Local LLM capacity section.

* **Auto-Refreshing & Status Indicators**
  * Real-time status indicators (e.g., Online, Offline, Loading).
  * Automatically calculates time remaining until your quotas refresh (e.g., "· Refreshes in 2h 15m").

---

## 🌟 주요 기능 (한국어)

* **통합 토큰 사용량 및 한도 추적**
  다양한 AI 모델의 API 토큰 사용량과 남은 할당량을 한눈에 파악할 수 있습니다.
  * Gemini 3.1 Pro (Antigravity IDE)
  * Opus 4.6 Thinking
  * Codex

* **로컬 LLM 및 하드웨어 모니터링**
  로컬 컴퓨팅 환경의 실시간 상태를 모니터링합니다. 상세한 GPU 통계를 제공합니다.
  * GPU 사용률 (%)
  * VRAM 사용량 (MB)
  * 전력 소비량 및 제한 (W)

* **AI 에이전트 실행 내역 및 아티팩트 관리**
  * VS Code 내부에서 현재 실행 중이거나 완료된 AI 에이전트 작업 내역을 확인할 수 있습니다.
  * 단일 클릭으로 상세 실행 로그를 보거나 백엔드 JSONL 실행 파일을 직접 열 수 있습니다.
  * 대시보드에 표시된 생성 아티팩트를 클릭하면 즉시 에디터에서 열립니다.

* **사용자 맞춤형 대시보드 설정**
  필요한 정보만 보이도록 대시보드를 커스터마이징하세요. VS Code 설정(`Ctrl + ,`)에서 특정 섹션을 숨기거나 표시할 수 있습니다.
  * `integratedPower.view.showAntigravity`: Antigravity IDE 토큰 섹션 표시/숨기기
  * `integratedPower.view.showCodex`: Codex 토큰 섹션 표시/숨기기
  * `integratedPower.view.showLocalLlm`: 로컬 LLM 상태 섹션 표시/숨기기

* **자동 새로고침 및 상태 표시기**
  * 실시간 연결 상태 표시 기능 (예: Online, Offline, Loading).
  * 쿼터(할당량)가 초기화될 때까지 남은 시간을 자동으로 계산하여 보여줍니다 (예: "· Refreshes in 2h 15m").

---

## ⚙️ Extension Settings

This extension contributes the following settings:

* `integratedPower.view.showAntigravity`: Set to `false` to hide the Antigravity IDE section.
* `integratedPower.view.showCodex`: Set to `false` to hide the Codex section.
* `integratedPower.view.showLocalLlm`: Set to `false` to hide the Local LLM section.
