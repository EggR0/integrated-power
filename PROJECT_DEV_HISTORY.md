# Integrated POWER Project - Development History & Master Plan

본 문서는 Antigravity IDE 환경에서 동작하는 **AI 오케스트레이션 및 하이브리드 대시보드 시스템(Integrated POWER)**의 전체 개발 과정, 대화의 흐름, 마주쳤던 오류와 그 해결 과정, 그리고 향후 계획(Phase 6)을 단 하나도 빠짐없이 총망라한 마스터 기록 파일입니다.

---

## 1. 프로젝트의 태동과 철학 (Phase 1 & 2)

### 1.1. AI 라우팅 아키텍처 도입 (AI Delegation Skill)
- **목표**: 비싼 클라우드 토큰(Codex/Gemini)의 낭비를 막고, 작업의 난이도에 따라 **메인 에이전트 / Codex / 로컬 LLM(Aider)** 으로 작업을 동적으로 분배하는 시스템 구축.
- **구현**: 
  - `ai-delegation` 스킬(플러그인)을 작성하여 IDE 명령어(Slash Command)로 등록.
  - 백그라운드 위임 스크립트(`Invoke-CodexJob.ps1`, `Invoke-DelegatedAgentTask.ps1` 등) 작성.
- **발생한 오류 및 해결**:
  - **오류**: 확장 프로그램 새로고침(Reload Window) 시, 스킬 이름이 `/ai-delegation`에서 옛날 이름인 `/codex-orchestrator`로 강제 롤백되는 현상 발생.
  - **원인**: 디렉터리명과 `plugin.json`은 업데이트했으나, VSIX 배포본 내 `assets` 폴더 원본의 `SKILL.md` 상단 YAML 메타데이터(`name: codex-orchestrator`)를 갱신하지 않아 부팅 시마다 옛날 설정이 글로벌 설정을 덮어씌움.
  - **해결**: `SKILL.md` 원본의 이름을 `ai-delegation`으로 수정하고, 확장 프로그램을 재빌드(`vsce package`) 및 재설치하여 완벽히 해결함.

### 1.2. IDE 대시보드 확장 프로그램 개발 (Token Management & UI)
- **목표**: 터미널이나 콘솔이 아닌, 안티그래비티 IDE 우측 패널(Webview)을 통해 시스템 상태, 토큰 잔여량, 에러 로그를 한눈에 모니터링.
- **구현**:
  - `TokenManager.ts`를 통해 시스템의 토큰 상태와 오류를 수집하여 `.agents/dashboard-state.json`에 기록.
  - `DashboardController.ts`를 통해 JSON을 읽어 Webview HTML로 렌더링.
  - 파일 시스템 와쳐(`FileSystemWatcher`)를 연동하여 JSON 파일 변경 시 UI가 즉시 새로고침되도록 연동(리액티브 업데이트).
- **발생한 오류 및 해결**:
  - **오류**: UI에 동일한 에러 메시지가 무한히 중복되어 쌓이는 버그 발생.
  - **해결 과정**: 
    1. 로컬 LLM(Aider - Qwen)에게 디버깅 임무를 위임하여 `Set` 자료구조를 이용한 배열 중복 제거 로직(`Array.from(new Set([...]))`)을 `DashboardController.ts`에 성공적으로 작성함.
    2. 코드는 수정되었으나 확장 프로그램을 **재컴파일(`tsc`) 및 재설치**하지 않아 UI에 미반영되는 해프닝이 있었음.
    3. `npm run compile` 후 재설치 및 `Reload Window`를 통해 중복 에러 버그를 최종 수정함.

---

## 2. 하이브리드 터미널 브릿지 구축 (Phase 3 & 4)

### 2.1. 백그라운드 블랙박스 문제의 대두
- **문제 상황**: 스크립트를 통해 Aider나 로컬 LLM을 호출하면, 시스템 백그라운드 프로세스로 겉돌기 때문에 사용자는 AI가 무슨 코드를 타이핑하고 있는지, 멈췄는지 알 길이 없는 **블랙박스(Black Box)** 현상 발생.
- **사용자의 통찰**: "터미널 팝업이 직접 작동하도록 할 수 없어? (Option B)"

### 2.2. Terminal Queue & Stream Watcher 구조 설계
- **구현**:
  - **IDE Terminal Queue**: `Invoke-VisibleTask.ps1`을 만들어 `.agents/terminal-queue.json`에 팝업 요청을 쌓고, IDE 확장 프로그램(`WorkspacePaths.ts`)이 이를 감지해 `vscode.window.createTerminal`을 호출하도록 브릿지 생성.
  - **Log Tailing**: 백그라운드 AI는 조용히 로그 파일(`aider-run.log`)에 텍스트를 뱉고, 팝업된 터미널은 `Watch-LiveStream.ps1`을 실행해 그 파일을 실시간으로 스트리밍(Tailing)하여 사용자에게 중계함.
- **발생한 오류 및 해결**:
  - **오류 (터미널 버퍼링/먹통)**: 첫 구현 시 팝업 터미널에서 로그가 한 글자도 실시간으로 나오지 않고 먹통이 됨.
  - **원인**: PowerShell 내장 명령어인 `Get-Content -Wait | ForEach-Object`의 심각한 파이프라인 버퍼링 문제. 메모리에 수 킬로바이트가 찰 때까지 화면에 텍스트를 내보내지 않음.
  - **해결**: 파워쉘 파이프라인을 버리고, C#의 로우레벨 `.NET API`인 `System.IO.StreamReader`를 직접 호출하는 방식의 무버퍼(Buffer-free) 읽기 로직으로 스크립트를 전면 재작성함.

---

## 3. 로컬 LLM 실시간 스트리밍 한계 돌파 (Phase 5)

### 3.1. 직접 호출 테스트 (Haiku 작성)
- **요청**: Aider 같은 래퍼 툴 없이, 순수 로컬 LLM(`Invoke-LocalLLM.ps1`)이 콘솔에 직접 타자를 치는(Streaming) 모습을 팝업 터미널로 보고 싶음.
- **발생한 오류 1 (즉시 종료)**: 터미널이 열리자마자 텍스트 없이 `[__EOF__]`를 띄우고 닫힘.
  - **원인**: 이전 실패 작업이 남겨둔 로그 파일의 잔여 `[__EOF__]` 태그를 새 뷰어가 읽어버림. (로그 파일 초기화 누락)
- **발생한 오류 2 (단일 응답 및 버퍼링)**:
  - 기존 `Invoke-LocalLLM.ps1`은 배치 작업용으로 설계되어 Ollama API에 `stream = $false`로 던지고 있었음.
  - 이를 고치려 `curl.exe | ForEach-Object` 구조로 짰으나, 파워쉘이 `curl.exe` (외부 프로세스)의 출력을 또다시 라인 단위 이상으로 심하게 버퍼링하여 아무것도 안 뜸.
- **최종 해결**: 
  - 외부 `curl`과 파이프라인을 전부 버림.
  - `Invoke-StreamingLocalLLM.ps1`을 신규 작성하여, 순수 C# `System.Net.WebRequest`를 사용해 Chunk 단위로 JSON 스트림을 직접 파싱.
  - 이를 통해 파워쉘 버퍼링을 100% 우회하여, 단 1밀리초의 지연도 없는 **진정한 실시간 터미널 스트리밍(Ollama Live Stream)**을 완성함.

### 3.2. UX(사용자 경험) 출력 방식 분기 체계 확립
- **통찰**: "스트리밍 뷰어일 때랑 파일 직접 생성일 때의 터미널 출력을 조정해야 한다."
- **해법 적용**: 
  - 단순 백그라운드 파일 분석/생성 작업은 팝업 터미널을 배제하고 완료 알림만 남김.
  - 코딩이나 스트리밍 관전이 필요한 작업에만 `Queue-Watcher.ps1`을 동적으로 결합하여 팝업을 띄우는 이원화 아키텍처 적용 완료.

---

## 4. 앞으로 작업할 내용 총망라 (Phase 6: Serena Architecture)

### 4.1. 현재 상태 및 문제점
저장소 전담 분석(Read-only) 에이전트인 **Serena**가 현재 저장소 전체를 매번 맹목적으로 다 읽으며 토큰을 낭비하고 있습니다. 또한 분석 결과를 파일로만 남기고 있어, IDE 대시보드 활용도가 떨어집니다.

### 4.2. 상세 개발 계획 (Implementation Plan)
1. **하이브리드 스마트 인덱싱 (Serena)**
   - 전체 스캔 폐기. `Invoke-SerenaBackgroundJob.ps1` 내부에 `git diff --name-only main` 및 `git status` 로직을 삽입.
   - 변경된 모듈과 연관 파일만 읽도록 지시. 구조적 변경이 없으면 무의미한 LLM 쿼리 없이 **우아한 종료(Graceful Exit)** 수행.

2. **동적 Mermaid 마인드맵 생성기**
   - Serena가 분석을 마치면, 반드시 프로젝트의 전체 컴포넌트 연결 구조를 **Mermaid 플로우차트** 코드 블록으로 생성하여 `.agents\dashboard_architecture.md`에 저장하도록 강제.

3. **IDE Webview 대시보드 완전 연동 (Visual Architecture)**
   - `webview/main.js`에 `mermaid.js` 렌더러를 탑재.
   - 대시보드 확장 프로그램이 `.agents\dashboard_architecture.md`를 읽어들여, 단순히 텍스트가 아닌 **인터랙티브한 다이어그램 그래픽**으로 화면 우측이나 하단에 상시 렌더링하도록 구현.
   - 이로써 "사용자와 AI의 기억 의존도"를 낮추고, IDE만 열면 시스템 전체의 지도를 볼 수 있게 됨.

4. **문서화 및 자가 호출 룰 추가**
   - `AGENTS.md` 전역 룰에 "저장소 구조 파악 시 절대 스스로 짐작하지 말고, Serena를 호출해 Mermaid 지도를 갱신시키고 참조하라"는 지시어 추가.

---
**기록 생성일**: 2026-07-08 (Phase 5 스트리밍 아키텍처 완공 직후)
**다음 목표**: Phase 6 기획안(Serena 고도화) 승인 시 즉각 코드 구현 착수 예정.
