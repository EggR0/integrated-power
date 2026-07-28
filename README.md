# Integrated POWER / EggR

EggR는 Antigravity IDE, Codex, Local LLM 등 서로 다른 에이전트가 같은 프로젝트 상태와 작업 기록을 이어받도록 만드는 프레임워크 중립 실행 기반이다. 이 저장소는 비공개 canonical source이며, 현재 개발 대상은 Windows 11용 Antigravity IDE Dashboard 확장과 그 안에서 명시적으로 설치하는 EggR Orchestrator이다. Antigravity 또는 Codex 자체의 확장을 개발하는 단계가 아니다.

## 현재 구조

- `vscode-extension/`: Antigravity IDE 사용량·실행 상태 대시보드
- `vscode-extension/assets/ip-orchestrator-plugin/`: 명시적으로 설치하는 Integrated Power Antigravity IDE 오케스트레이터 번들
- `distribution/win11/`: 해시 검증, 설치·검증·제거 진입점과 직접 배포 ZIP 생성기
- `scripts/dispatch/`: Codex, Local LLM, Work Window 실행기
- `scripts/util/EggR.Paths.psm1`: OS·작업 경로에 종속되지 않는 EggR resolver
- `config/eggr.telemetry.schema.json`: 작업·토큰 이벤트 스키마
- `docs/architecture/eggr-win11-stabilization.ko.md`: 경로·백업·배포 설계
- `docs/reference/eggr-telemetry.ko.md`: 시작/종료 판정과 토큰 보정 규약

## Win11 빠른 시작

일반 사용자는 `Integrated-Power-<version>-win11.zip`을 전부 압축
해제한 뒤 `01-INSTALL.cmd`를 실행한다. 설치기는 전체 payload SHA-256을 확인하고
다음을 설치한다.

- 고정 버전 Dashboard VSIX
- Obsidian 분류표와 Private Knowledge 최초 설정·저장용 Windows 명령
- Windows 명령 경로 `%LOCALAPPDATA%\IntegratedPower\bin`

설치 후 Antigravity IDE에서 `Developer: Reload Window`와
`Integrated Power: Open Configuration Center`를 차례로 실행한다. Dashboard, Orchestrator,
Private Knowledge는 같은 페이지에서 보이지만 각각 명시적으로 설정한다.

대시보드를 여는 것만으로 `GEMINI.md`나 전역 오케스트레이터를 변경하지 않는다. 설치 명령은 기존 오케스트레이터를 `.gemini\config\plugins\.eggr-backups`에 보존하고 새 번들을 stage한 뒤 교체한다.

## Win11 직접 배포본 생성

유지관리자는 검증된 VSIX와 `environment-bootstrap` 작업 트리를 명시해 ZIP을 만든다.
개발자 개인 Knowledge 저장소는 입력이나 payload가 아니다.

```powershell
.\distribution\win11\New-EggRWin11Release.ps1 `
  -VsixPath .\vscode-extension\integrated-power-0.7.4.vsix `
  -KnowledgeBootstrapRoot ..\environment-bootstrap `
  -OutputDirectory .\release
```

출력물은 ZIP과 ZIP 자체의 `.sha256.txt`다. 배포본 내부
`release-manifest.json`은 Dashboard 버전·VSIX 해시·Knowledge 도구 원본 commit과
설치 payload 해시를 고정한다. `02-VERIFY-ONLY.cmd`는 무변경 진단,
`99-UNINSTALL-EXTENSION-ONLY.cmd`는 Dashboard 확장만 제거한다.

## EggR 경로 규칙

Win11 기본 상태 루트는 `%LOCALAPPDATA%\IntegratedPower\state`다. 다른 경로가 꼭 필요한 경우에만 다음 중 하나를 사용한다.

- 환경 변수 `EGGR_STATE_ROOT`
- `%USERPROFILE%\.config\integrated-power\roots.json`

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
