# EggR Antigravity IDE Dashboard — Win11 직접 설치

이 폴더는 Antigravity IDE용 EggR Dashboard와 세 갈래 최초 설정을 전달하는
Windows 11 직접 배포본이다. ZIP의 파일을 전부 압축 해제한 뒤 실행해야 한다.

## 설치

1. Antigravity IDE가 설치되어 있는지 확인한다.
2. `01-INSTALL.cmd`를 더블클릭한다.
3. 성공 메시지가 나오면 Antigravity IDE에서 `Developer: Reload Window`를 실행한다.
4. 명령 팔레트에서 `EggR: Open Configuration Center`를 연다.
5. 한 페이지에서 Dashboard, Orchestrator, Private Git Knowledge를 각각 설정한다.

설치 전 상태만 확인하려면 `02-VERIFY-ONLY.cmd`를 실행한다. 이 명령은 시스템을
변경하지 않고 배포 payload, Dashboard 버전, Knowledge 명령 8개와 관리 상태를
검증한다.

## 설치되는 것

- `integratedpower.antigravity-ide-dashboard` 확장
- VSIX에 포함된 EggR Orchestrator 배포 자산
- `%LOCALAPPDATA%\EggR\bin`의 Windows Private Knowledge 설정 명령
- 위 명령을 실행하기 위한 사용자 `PATH` 항목

Orchestrator 플러그인은 Configuration Center에서 사용자가 **설정 저장 및
플러그인 설치·갱신**을 눌렀을 때만 설치된다. Dashboard 설치만으로 사용자의
Antigravity 전역 플러그인을 교체하지 않는다.

## 자동 설치하지 않는 의존성

- Antigravity IDE: Dashboard 설치에 필수
- Git for Windows: Private Knowledge를 사용할 때 필수
- GitHub CLI: GitHub 설정 안내에 선택적으로 사용
- Codex CLI: Codex 위임 경로를 사용할 때 선택
- Agy: Agy 연동을 사용할 때 선택
- Ollama 또는 vLLM: 로컬 LLM 경로를 사용할 때 선택
- NVIDIA driver와 `nvidia-smi`: NVIDIA GPU 측정에 선택

이들은 계정 인증, 드라이버, 포트, 모델 다운로드처럼 사용자 환경에 큰 영향을
주므로 배포 스크립트가 임의로 설치하지 않는다. Configuration Center가 존재 여부와
설정 필요 상태를 보여준다.

## 데이터 경계

설치 프로그램은 다음 항목을 생성·추가·교체하지 않는다.

- `%USERPROFILE%\.gemini\GEMINI.md`
- 사용자의 Private Knowledge 내용
- Git 자격 증명, API key, 로그인 정보
- 별도 `Antigravity.exe` 애플리케이션의 데이터

기존 `%LOCALAPPDATA%\EggR\bin` 명령이 새 배포본과 다르면 먼저
`%LOCALAPPDATA%\EggR\backups\win11-distribution\<시각>`에 보존한다.
EggR legacy나 이전 관리 상태로 확인되지 않는 같은 이름의 파일, 또는 설치 후
사용자가 직접 수정한 관리 파일이 있으면 자동 교체하지 않고 충돌로 중단한다.

## 제거

`99-UNINSTALL-EXTENSION-ONLY.cmd`는 Dashboard 확장만 제거한다. 다음 데이터는
재설치와 복구를 위해 그대로 둔다.

- EggR Orchestrator 플러그인과 그 백업
- `%USERPROFILE%\.config\eggr` 설정
- `%LOCALAPPDATA%\EggR` 상태와 Windows 명령
- 사용자가 선택한 Private Knowledge 저장소
- 모든 `GEMINI.md`

## 무결성

설치 스크립트는 `release-manifest.json`에 기록된 모든 배포 파일의 SHA-256을
확인한 후에만 설치한다. ZIP과 함께 제공되는 별도 `.sha256.txt` 값은 다운로드한
ZIP 자체가 배포자가 제공한 파일과 같은지 확인하는 기준이다. SHA-256은 우발적
손상 검출 수단이며 코드 서명을 대체하지 않는다.
