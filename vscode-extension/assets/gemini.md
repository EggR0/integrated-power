# EggR 전역 오케스트레이션 규약

이 파일은 Antigravity IDE가 EggR 오케스트레이터를 사용하는 최소 전역 규칙이다. EggR는 Codex 전용 경로나 Antigravity `globalStorage`에 종속되지 않는다.

## 1. 작업 시작

비단순 작업을 시작하기 전에 다음을 확인한다.

1. 현재 OS, 작업 폴더, Git 루트, 브랜치와 기존 변경
2. 저장소의 `.ai/STATUS.md`, `.ai/HANDOFF.md`, `AGENTS.md`
3. 성공 조건과 수정 허용 범위
4. Main Agent, Codex, Antigravity, Local LLM 중 실행 경로
5. 예상 토큰 범위·점 추정·confidence

사용자의 목표가 하나인 연속 검사·수정·검증은 같은 작업으로 취급한다. 독립적인 위임과 재시도는 별도 attempt로 기록한다.

## 2. EggR 상태 경로

경로를 기억하거나 저장소에 PC 절대 경로를 기록하지 않는다. 번들 resolver를 사용한다.

```powershell
$resolver = Join-Path $HOME ".gemini\config\plugins\codex-orchestrator-plugin\skills\codex-orchestrator\scripts\lib\EggR.Paths.psm1"
Import-Module $resolver -Force
$workspaceState = Get-EggRWorkspaceStatePath -RepoRoot (Get-Location).Path
```

Win11 기본 state root는 `%LOCALAPPDATA%\EggR\state`다. `EGGR_STATE_ROOT` 또는 `%USERPROFILE%\.config\eggr\roots.json`으로 override할 수 있다. 프로젝트 ID는 명시 ID, 정규화한 Git origin, 절대 경로 순으로 결정한다.

대시보드 상태는 `<workspaceState>\reports\dashboard-state.json`, 실행 이벤트는 `<workspaceState>\.agent-runs\runs.jsonl`에 있다.

## 3. 라우팅

- 작은 검사·명확한 수정·로컬 명령: Main Agent가 직접 처리
- 긴 문맥의 정리·추출·분류: selector를 거친 Local LLM
- 어려운 구현·디버깅·코드 검토: Codex Job
- 구조적 판단과 상충하는 대안 비교: Codex Debate
- 여러 작업을 감독하며 처리: Work Window

저렴한 경로를 선택했다는 이유만으로 성공으로 보지 않는다. 결과 품질과 검증을 먼저 통과해야 한다.

## 4. 토큰과 완료 판정

토큰은 `provider_reported`, `calculated`, `estimated`, `unavailable`을 구분한다. 공식 usage가 없으면 추정값을 실제값처럼 쓰지 않는다. 분모가 공식적으로 알려지지 않은 quota는 임의의 토큰 %로 변환하지 않는다.

작업 완료는 산출물 생성, 검증, 변경·실패·남은 위험 정리, 필수 worklog 기록까지 끝났을 때만 선언한다. 자세한 규약은 저장소의 `docs/reference/eggr-telemetry.ko.md`를 따른다.

## 5. 설치 생명주기

대시보드를 열었다는 이유로 오케스트레이터나 이 파일을 덮어쓰지 않는다. 오케스트레이터 갱신은 사용자가 명령 팔레트에서 **EggR: Install or Update Antigravity Orchestrator**를 실행했을 때만 수행한다. 기존 `GEMINI.md`가 있으면 보존하고 새 템플릿을 검토 대상으로만 연다.
