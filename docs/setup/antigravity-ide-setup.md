# Antigravity IDE / EggR 설정

## 원칙

- 프로젝트를 특정 사용자명이나 절대 경로에 고정하지 않는다.
- 대시보드 설치와 EggR 오케스트레이터 설치를 별도 생명주기로 취급한다.
- 필요한 MCP만 켜고 provider별 quota와 token evidence를 섞지 않는다.

## 설치

1. Antigravity IDE에서 이 저장소를 연다.
2. 검증된 `antigravity-ide-dashboard-*.vsix`를 설치한다.
3. 명령 팔레트에서 **EggR: Install or Update Orchestrator**를 실행한다.
4. 기존 `~/.gemini/GEMINI.md`가 있으면 자동 덮어쓰기되지 않는다. 열린 번들 템플릿과 수동 비교한다.
5. 설치 결과를 확인한다.
   - 활성 오케스트레이터: `~/.gemini/config/plugins/codex-orchestrator-plugin`
   - 이전 버전: `~/.gemini/config/plugins/.eggr-backups`
   - Win11 상태: `%LOCALAPPDATA%\EggR\state\workspaces\<workspace-id>`

## 작업 시작 확인

1. 저장소 루트와 Git branch/dirty state
2. `.ai/STATUS.md`, `.ai/HANDOFF.md`, `AGENTS.md`
3. 목표, 성공 조건, 수정 범위
4. Main Agent / Codex / Local LLM route
5. 예상 토큰 범위와 confidence

오케스트레이터가 Codex를 찾지 못하면 `codex.exe`를 PATH에 추가하거나 `CODEX_EXE`를 설정한다. 프로젝트 파일에 개인 PC의 `codex.exe` 절대 경로를 기록하지 않는다.

## MCP

MCP 설정 위치는 사용자의 `~/.gemini/config/mcp_config.json`이다. 저장소에는 실제 자격증명이나 사용자별 절대 경로를 커밋하지 않고 예제만 둔다. 현재 작업에 필요한 서버만 활성화한다.

## 확인용 요청

```text
Use the installed codex-orchestrator skill.
Ground the OS, repository root, branch, dirty state, and .ai handoff first.
Resolve the EggR workspace state with the bundled resolver; do not guess an absolute path.
Classify the route and record a token estimate range before starting.
Do not declare completion until verification and worklog updates are finished.
```
