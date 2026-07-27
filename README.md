# Integrated POWER / EggR

EggR는 Antigravity IDE, Codex, Local LLM 등 서로 다른 에이전트가 같은 프로젝트 상태와 작업 기록을 이어받도록 만드는 프레임워크 중립 실행 기반이다. 이 저장소는 비공개 canonical source이며, 현재는 Windows 11에서 Antigravity 대시보드와 Codex 오케스트레이터를 먼저 안정화한다.

## 현재 구조

- `vscode-extension/`: Antigravity IDE 사용량·실행 상태 대시보드
- `vscode-extension/assets/codex-orchestrator-plugin/`: 명시적으로 설치하는 EggR Antigravity 오케스트레이터 번들
- `scripts/dispatch/`: Codex, Local LLM, Work Window 실행기
- `scripts/util/EggR.Paths.psm1`: OS·작업 경로에 종속되지 않는 EggR resolver
- `config/eggr.telemetry.schema.json`: 작업·토큰 이벤트 스키마
- `docs/architecture/eggr-win11-stabilization.ko.md`: 경로·백업·배포 설계
- `docs/reference/eggr-telemetry.ko.md`: 시작/종료 판정과 토큰 보정 규약

## Win11 빠른 시작

1. 이 저장소를 원하는 위치에 clone한다.
2. `vscode-extension`에서 compile과 headless test를 실행한다.
3. 검증된 VSIX를 Antigravity IDE에 설치한다.
4. 명령 팔레트에서 **EggR: Install or Update Antigravity Orchestrator**를 실행한다.
5. `%LOCALAPPDATA%\EggR\state\workspaces`에 프로젝트 상태가 만들어지는지 확인한다.

대시보드를 여는 것만으로 `GEMINI.md`나 전역 오케스트레이터를 변경하지 않는다. 설치 명령은 기존 오케스트레이터를 `.gemini\config\plugins\.eggr-backups`에 보존하고 새 번들을 stage한 뒤 교체한다.

## EggR 경로 규칙

Win11 기본 상태 루트는 `%LOCALAPPDATA%\EggR\state`다. 다른 경로가 꼭 필요한 경우에만 다음 중 하나를 사용한다.

- 환경 변수 `EGGR_STATE_ROOT`
- `%USERPROFILE%\.config\eggr\roots.json`

```json
{
  "state_root": "D:\\EggR\\state"
}
```

프로젝트 ID는 `.eggr/workspace.json`의 명시 ID, 정규화한 Git origin, 절대 경로 순으로 결정된다. 같은 Git 저장소를 다른 PC나 폴더에 clone해도 같은 ID를 얻는다.

## 개발 검증

```powershell
cd .\vscode-extension
pnpm run compile
node .\scripts\run-headless-tests.js
```

PowerShell 실행 정책이 로컬 모듈을 차단하면 시스템 정책을 영구 변경하지 않고 검증된 스크립트에 한해 별도 프로세스로 실행한다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\eggr-doctor.ps1
```

## 저장과 공개

- 비공개 Git: 소스, 테스트, 스키마, 정제된 한국어 인수인계와 오류 기록
- 암호화 백업: 원시 Antigravity brain, 전체 프롬프트·도구 로그, 고빈도 런타임 상태
- 공개 미러: 비밀정보와 운영 원자료를 제거하고 검증한 릴리스만 반영

원시 로그를 Git에 넣지 않는 이유와 복구 절차는 [EggR Win11 안정화 설계](docs/architecture/eggr-win11-stabilization.ko.md)를 참고한다.
