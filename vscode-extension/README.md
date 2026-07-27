# EggR Antigravity IDE Dashboard

EggR Antigravity IDE Dashboard는 **Antigravity IDE에서 실행되는 확장 프로그램**이다.
현재 Windows 11에서 에이전트 사용량·작업 상태·로컬 연산 상태를 GUI로 확인하고,
EggR Orchestrator와 사용자 소유 Private Knowledge의 최초 설정으로 연결한다.

> 이 확장은 별도 `Antigravity.exe`용 확장이 아니며 Codex용 확장도 아니다.
> Codex, Agy, 로컬 LLM은 Orchestrator가 선택적으로 호출할 수 있는 외부 실행
> 경로다.

## 제품 범위

| 구성 | 역할 | 이 확장과의 관계 |
|---|---|---|
| Dashboard | 사용량·상태·에이전트 실행 기록 GUI | 이 VSIX가 직접 제공 |
| EggR Orchestrator | 주 에이전트·Codex·로컬 LLM 사이의 작업 경로 선택 | 사용자가 명령을 실행할 때 명시적으로 설치·설정 |
| Private Knowledge | 사용자의 지식·작업 기록·오류 이력을 개인 Git에 누적 | 별도 `environment-bootstrap` 명령을 호출 |

세 구성은 설치 수명과 데이터 소유자가 다르므로 독립적으로 설정한다.
`EggR: Open Configuration Center`는 세 구성의 상태와 설정을 한 페이지에서
보여주지만 하나의 설정이나 설치 수명으로 강제 결합하지 않는다.

## 주요 기능

- Antigravity IDE, Codex 및 로컬 LLM 상태 영역을 선택적으로 표시
- GPU 사용률, VRAM, 전력 사용량과 현재 제한 표시
- 작업별 실행 기록, 활성 작업, 결과물과 JSONL 기록 열기
- 실제 provider 보고값, 계산값, 추정값, 미확인 값을 구분하는 사용량 표시
- `auto` 또는 `user_default` 방식의 로컬 LLM 선택 정책
- 사용자 소유 Private Knowledge Git 최초 설정 연결
- WorkRoot의 절대 경로를 코드에 고정하지 않는 EggR 상태 경로 해석

## 지원 범위

- 현재 안정화·배포 대상: Windows 11
- 실행 대상:

  ```text
  %LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe
  ```

- 확장 조회·설치용 CLI:

  ```text
  %LOCALAPPDATA%\Programs\Antigravity IDE\bin\antigravity-ide.cmd
  ```

별도 프로그램인 다음 실행 파일은 Antigravity IDE 확장 설치에 사용하지 않는다.

```text
%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe
```

이 파일에 `--list-extensions`나 `--install-extension`을 전달하면 별도
Antigravity 애플리케이션이 시작될 수 있다.

## 설치

일반 사용자에게는 저장소나 Node.js 개발 도구 대신 Win11 직접 배포 ZIP을 전달한다.
ZIP을 전부 압축 해제한 뒤 `01-INSTALL.cmd`를 실행하면 VSIX와 Windows Private
Knowledge 명령의 SHA-256을 확인하고 설치한다. `02-VERIFY-ONLY.cmd`는 설치 전
진단만 수행하며 시스템을 변경하지 않는다.

개발자가 VSIX만 직접 설치해야 할 때는 Antigravity IDE 명령줄 wrapper를 사용한다.

Antigravity IDE 명령줄 wrapper에서 VSIX를 설치한다.

```powershell
& "$env:LOCALAPPDATA\Programs\Antigravity IDE\bin\antigravity-ide.cmd" `
  --install-extension ".\antigravity-ide-dashboard-0.6.0.vsix" `
  --force
```

설치 또는 업데이트 후 실행 중인 Antigravity IDE에서 다음 명령을 한 번 실행한다.

```text
Developer: Reload Window
```

그 다음 명령 팔레트에서 `EggR:`를 검색한다.

## EggR 명령

| 명령 | 동작 |
|---|---|
| `EggR: Open Configuration Center` | 세 구성의 통합 설정 페이지 열기 |
| `EggR: Run First-Run Setup` | Configuration Center 개요 열기 |
| `EggR: Configure Dashboard` | Configuration Center의 Dashboard 영역 열기 |
| `EggR: Configure Orchestrator` | Configuration Center의 Orchestrator 영역 열기 |
| `EggR: Configure Private Git Knowledge` | Configuration Center의 Knowledge 영역 열기 |
| `EggR: Install or Update Orchestrator` | Orchestrator 설치 영역 열기 |

Dashboard를 열거나 확장을 활성화하는 것만으로 Orchestrator와 사용자 Knowledge
저장소를 자동 변경하지 않는다. 0.5.0부터 확장 패키지에는 `GEMINI.md` 템플릿이나
이를 생성·추가·교체하는 코드가 없다.

## Dashboard 설정

Antigravity IDE 설정에서 다음 값을 사용할 수 있다.

| 설정 | 기본값 | 설명 |
|---|---:|---|
| `integratedPower.view.showAntigravity` | `true` | Antigravity IDE 상태 영역 표시 |
| `integratedPower.view.showCodex` | `true` | Codex 상태 영역 표시 |
| `integratedPower.view.showLocalLlm` | `true` | 로컬 LLM·GPU 상태 영역 표시 |

## 상태와 설정 경로

| 데이터 | Windows 경로 |
|---|---|
| EggR root 설정 | `%USERPROFILE%\.config\eggr\roots.json` |
| 기본 runtime state | `%LOCALAPPDATA%\EggR\state` |
| Orchestrator 설정 | `%USERPROFILE%\.config\eggr\orchestrator.json` |
| Antigravity IDE plugin | `%USERPROFILE%\.gemini\config\plugins\eggr-orchestrator-plugin` |
| Private Knowledge | 사용자가 최초 실행 마법사에서 선택 |

현재 PC의 경로나 Git 원격을 다른 사용자에게 배포하지 않는다. 새 PC에서는 사용자
선택을 먼저 사용하고, 선택이 없을 때만 `%USERPROFILE%\Documents\EggR`를 WorkRoot
권장값으로 제안한다. 기존 저장소는 자동 이동·병합·삭제하지 않는다.

## Orchestrator와 로컬 LLM

Orchestrator는 다음 두 정책을 제공한다.

- `user_default`: 사용자가 지정한 provider·endpoint·model ID를 우선하며 임의로
  다른 모델로 교체하지 않는다.
- `auto`: 현재 여유 VRAM, Compute Capability, backend 요구 조건, 설치 모델 크기,
  VRAM 예약량, CPU offload 허용 여부와 작업 적합도를 평가한다.

가중치 양자화 이름(Q4, MXFP4 등)과 GPU의 native FP4·FP8 연산 지원을 같은
것으로 취급하지 않는다. Ollama는 설치 모델 중 선택·실행할 수 있고, vLLM은
일반적으로 endpoint에 이미 로드된 모델과의 적합성을 확인한다.

## 의존성

| 의존성 | 필수 여부 | 자동 설치 |
|---|---|---|
| Antigravity IDE | 필수 | 하지 않음 |
| VSIX JavaScript runtime | 필수 | VSIX에 포함 |
| Git for Windows | Private Knowledge 사용 시 | 하지 않음 |
| Codex CLI | Codex 경로 사용 시 | 하지 않음 |
| Ollama 또는 vLLM | 로컬 LLM 경로 사용 시 | 하지 않음 |
| NVIDIA driver와 `nvidia-smi` | NVIDIA GPU 측정 시 | 하지 않음 |
| Agy | Agy 사용량 연동 시 | 하지 않음 |

직접 배포본은 EggR가 소유한 Private Knowledge Windows 명령만 함께 설치한다.
Antigravity IDE, Git, GPU driver, 외부 에이전트 CLI와 로컬 모델은 자동 설치하지
않는다.

GPU driver, 모델, 서비스 포트, Git 인증과 API 자격 증명은 사용자 환경에 큰 영향을
주므로 묵시적으로 설치하거나 변경하지 않는다. 마법사는 존재 여부를 진단하고 필요한
설정 위치를 안내한다.

## Private Knowledge

이 확장은 개발자의 Knowledge 저장소 내용을 배포하지 않는다. 각 사용자는 다음 중
하나를 선택한다.

- 자신의 private Git remote 연결
- 원격이 없는 `local_only` 저장소

Git 작성자 email은 커밋 메타데이터이며 로그인 수단이 아니다. 원격 인증은 Git
Credential Manager 또는 SSH agent가 담당한다. 최초 설정 마법사는 기존 branch와
dirty 변경을 보존하며 commit, pull, rebase, checkout, push를 실행하지 않는다.

## 개인정보와 비밀값

- 비밀번호, access token, refresh token과 API key 값을 설정 JSON이나 작업 로그에
  저장하지 않는다.
- 필요한 경우 값 대신 환경변수 이름만 기록한다.
- 원문 대화, 인증 데이터베이스와 개인 Knowledge 내용은 VSIX에 포함하지 않는다.
- 사용자 경로와 원격 URL을 소스 또는 배포물에 고정하지 않는다.

## 0.6.0 변경 사항

- 사용자 홈 재귀 검색 없이 Antigravity IDE 공식 plugin root의 신규·이전 경로만 검사
- 플러그인 manifest와 스킬 identity로 EggR 배포본을 판정하고, 인식되지 않은
  동일 이름 폴더는 자동 이동하지 않음
- staging, 전체 폴더 백업, 원자적 활성화, 실패 rollback을 적용
- 설치 버전·관리 파일 SHA-256·백업 위치를 설치 상태와 확장 global storage
  journal에 기록
- Configuration Center에서 설치 계획, 충돌, 신규·이전 상태와 의존성 안내 표시
- Git/GitHub CLI 진단과 GitHub private 저장소 생성 페이지 연결
- 임시 사용자 홈으로 clean install, 0.4.2 upgrade, conflict, rollback,
  idempotency를 검증

## 0.5.0 변경 사항

- Dashboard, Orchestrator, Private Git Knowledge를 한 Configuration Center에서 설정
- 기존 명령은 유지하되 해당 설정 페이지 영역으로 연결
- 플러그인과 스킬 공개 이름을 `eggr-orchestrator`로 변경
- 이전 `codex-orchestrator-plugin`을 명시적 설치 시 백업 후 전환
- `GEMINI.md` 템플릿과 모든 생성·추가 코드를 패키지에서 제거
- Orchestrator 설정을 프레임워크 공통 EggR 경로로 이동하고 이전 설정은 읽기 호환

## 0.4.2 변경 사항

- 확장 README를 현재 제품 범위에 맞게 전면 교체
- 개발 대상이 Antigravity IDE 확장임을 첫 화면에 명시
- 별도 Antigravity와 Codex 확장이 아님을 명시
- 올바른 Antigravity IDE CLI wrapper와 잘못된 실행 파일을 명시
- 세 갈래 설정, 의존성, 데이터 경로, 자동 설치하지 않는 범위를 통합 설명

## 0.4.1 변경 사항

0.4.0은 Windows PowerShell 5.1이 `roots.json` 앞에 기록한 UTF-8 BOM을 제거하지
않아 확장 활성화가 실패할 수 있었다.

0.4.1에서는 다음을 수정했다.

- BOM이 있는 UTF-8 JSON 읽기 지원
- `roots.json`, `.eggr/workspace.json`, 설정 마법사의 공통 JSON 처리
- Windows root 설정 도구의 BOM 없는 UTF-8 저장
- BOM 재현 headless·extension-host 테스트
- `EggR: Install or Update Orchestrator` 명칭 정리
- Antigravity와 Antigravity IDE 실행 파일 구분 명시

## 문제 해결

### 확장은 설치됐지만 EggR 명령이 보이지 않음

1. 확장 카탈로그가 `integratedpower.antigravity-ide-dashboard@0.4.1` 이상인지
   확인한다.
2. `Developer: Reload Window`를 실행한다.
3. 명령 팔레트에서 `EggR:`를 다시 검색한다.
4. 계속 실패하면 최신 로그의 Dashboard 활성화 오류를 확인한다.

   ```text
   %APPDATA%\Antigravity IDE\logs\<최근 세션>\window1\exthost\exthost.log
   ```

### 별도 Antigravity가 시작됨

Antigravity IDE CLI 대신 다음 파일을 잘못 실행했는지 확인한다.

```text
%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe
```

확장 관리에는 `Antigravity IDE\bin\antigravity-ide.cmd`만 사용한다.

### Antigravity IDE 로그인 문제

로그인과 OAuth는 Antigravity IDE 자체 기능이다. Dashboard는 로그인 상태를
삭제하거나 계정을 변경하지 않는다. Dashboard 활성화 오류와 인증 오류를 같은
원인으로 단정하지 말고 `auth.log`와 `exthost.log`를 나누어 확인한다.

## 현재 제약

- Windows 11을 우선 검증했다. Linux와 macOS 배포는 후속 범위다.
- provider가 실제 token usage를 제공하지 않으면 값을 0으로 만들지 않고
  `estimated` 또는 `unavailable`로 표시한다.
- Ollama/vLLM이 설치되지 않은 환경에서는 로컬 모델 선택 결과만 검증할 수 있으며
  실제 추론 성능은 측정할 수 없다.
- 공개 marketplace 배포 전 repository metadata와 LICENSE 정책을 확정해야 한다.
