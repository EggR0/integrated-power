# Integrated Power

현재 릴리스: `0.7.8`

Integrated Power는 **Antigravity IDE 전용 확장 프로그램**이다. Windows 11에서
에이전트 사용량, 작업 상태, GPU와 로컬 연산 상태를 한 화면에 표시하고,
Integrated Orchestrator와 사용자 소유 Private Git Knowledge를 이어 주는 설정
진입점을 제공한다. 목적은 단순한 상태 표시가 아니라, 서로 다른 에이전트와 PC를
오가더라도 “어떤 실행 경로를 왜 골랐는지”와 “다음 작업이 무엇을 이어받아야
하는지”를 잃지 않게 하는 것이다.

| 항목 | 값 |
|---|---|
| 제품 표시명 | Integrated Power |
| Publisher | EggR |
| 확장 ID | `EggR.integrated-power` |
| 공개 배포 채널 | Open VSX Registry |
| 우선 지원 환경 | Antigravity IDE on Windows 11 |

Open VSX는 배포 채널이다. Open VSX에 게시되더라도 Visual Studio Code, Cursor 또는
다른 VS Code 파생 IDE까지 지원한다는 뜻은 아니다.

> 이 확장은 별도 `Antigravity.exe`용 확장이 아니며 Codex용 확장도 아니다.
> Codex, Agy, Ollama와 vLLM은 사용자가 선택할 수 있는 외부 실행 경로다.

## 세 가지 독립 구성

| 구성 | 역할 | 설치·데이터 경계 |
|---|---|---|
| Integrated Power Dashboard | 사용량·상태·에이전트 실행 기록 GUI | 이 VSIX가 제공 |
| Integrated Orchestrator | 주 에이전트, Codex, 로컬 LLM 사이의 작업 경로 선택 | 사용자가 명시적으로 설치·설정 |
| Private Git Knowledge | 지식, 작업 기록, 오류 이력을 사용자 자신의 Git에 누적 | 별도 Windows 도구가 사용자 선택으로 설정 |

Integrated Orchestrator의 사용자 표시명은 `Integrated Orchestrator`이고, 현재
기계 식별자는 `ip-orchestrator`다. 0.7.2 이하의 `eggr-orchestrator`와 더 이전
`codex-orchestrator`는 새 설치가 정확한 관리 표식을 확인한 경우에만 백업한 뒤
전환한다.

세 구성은 설치 수명과 데이터 소유자가 다르다. 안전한 Configuration Center는 세
상태와 설정 진입점을 한 화면에 보여 주지만, Dashboard 활성화만으로 Orchestrator나
사용자 Knowledge를 설치·변경하지 않는다.

### 왜 세 구성을 분리하는가

- **Dashboard는 관측 도구다.** 제공자가 보고한 사용량, 로컬에서 계산한 값,
  추정값과 GPU 상태를 구분해 보여 준다. 상태 화면을 여는 행위가 실행 규칙이나
  사용자 파일을 바꾸면 원인 추적이 어려워지므로 관측과 변경을 분리한다.
- **Integrated Orchestrator는 실행 경로 선택 기능이다.** 현재 에이전트가 직접
  처리할지, Codex에 맡길지, VRAM·backend 조건에 맞는 로컬 LLM을 전처리에 쓸지를
  설정에 따라 결정한다. 로컬 모델이 없으면 해당 경로만 비활성이고 Dashboard와
  Knowledge는 계속 사용할 수 있다.
- **Private Git Knowledge는 사용자 소유 기억이다.** 제품 개발자의 저장소를
  배포하는 기능이 아니라, 사용자가 선택한 Git 저장소에 작업 로그·오류 이력·계속
  보존할 지식을 쌓아 PC, OS, 에이전트가 바뀌어도 다시 참조할 수 있게 한다.

이 분리는 한 구성의 장애가 다른 두 구성을 망가뜨리지 않게 하고, 다른 사용자에게
배포할 때 각자의 경로·계정·도구 설치 상태를 Configuration Center에서 다시 정할
수 있게 한다.

## 주요 기능

- Antigravity IDE, Codex 및 로컬 LLM 상태 영역 선택 표시
- GPU 사용률, VRAM, 전력 사용량과 현재 전력 제한 표시
- 작업별 실행 기록, 활성 작업, 결과물과 JSONL 기록 열기
- provider 실측값, 계산값, 추정값과 미확인 값을 구분하는 사용량 표시
- `auto` 또는 `user_default` 방식의 로컬 LLM 선택 정책
- VRAM, Compute Capability, backend 요구 조건과 설치 모델 크기를 고려한 후보 평가
- Ollama 설치 모델 자동 조사와 사용자 전용 로컬 모델 레지스트리 동기화
- 필요한 모델이 없을 때 사용자 동의 후에만 설치하도록 하는 구조화된 제안
- Dashboard, Integrated Orchestrator, Private Git Knowledge의 독립 설정 센터
- Orchestrator 설치 전 계획 표시, 소유권 충돌 차단, backup, rollback과 재실행 안전성
- 개발자 절대 경로를 내장하지 않는 WorkRoot와 상태 경로 해석
- Antigravity IDE 작업별 `ip-orchestrator.md` 단일 아티팩트 재사용

## Antigravity IDE 아티팩트 관리

Antigravity IDE는 `~/.gemini/antigravity-ide/brain/<작업 ID>/` 아래의 일반 파일을
아티팩트로 표시한다. 그래서 모델 호출마다 `scratch/prompt_*.txt`,
`scratch/response_*.txt`, 임시 실행 스크립트를 만들면 같은 작업의 목록이 계속
늘어난다.

Integrated Orchestrator 3.3.0부터는 한 `brain/<작업 ID>`를 하나의 논리 작업으로 보고
그 안의 출력 경로를 기본적으로 `<작업 ID>/ip-orchestrator.md` 하나로 합친다. 짧은
지시는 파일 대신 `-PromptText`, 기존 프로젝트 자료는 `-ContextFile`로 전달하며,
출력 경로를 생략해도 타임스탬프 대신 안정된 작업 키 경로를 재사용한다. 별도
아티팩트가 정말 필요할 때만 사용자가 요청한 경우 `-ArtifactPolicy Separate`를 쓴다.

업데이트는 새 파일의 과잉 생성을 막지만 기존 `brain` 파일을 자동 삭제하거나
수정하지 않는다. 이전 목록 정리는 사용자 데이터 삭제가 포함되므로 별도 작업이다.

## Agy 사용량 경계

Agy TUI에서는 공식 `/usage` 명령으로 사용량을 사용자가 직접 확인할 수 있다.

Windows에서 사용자가 Agy에 로그인한 경우 Integrated Power는 로컬 프로세스에서
Windows Credential Manager의 Agy 자격 증명을 읽고 사용량 API를 조회해 Dashboard에
표시한다. 만료된 인증의 갱신이 필요하면 설치된 Agy client 정보와 refresh token을
로컬 프로세스 안에서 사용한다.

실제 access token과 refresh token 값은 Integrated Power 설정, 로그 또는 공개
저장소에 기록하지 않는다. Integrated Power가 읽은 token 값의 사본은 사용량 조회와
필요한 인증 갱신 동안 로컬 프로세스 메모리에서만 사용한다. 원본 자격 증명은 Agy가
Windows Credential Manager에서 관리하며, Integrated Power가 계정을 만들거나 로그인
정보를 배포하지 않는다.

## GEMINI.md 경계

Integrated Power는 전역 또는 프로젝트 `GEMINI.md`를 생성, 추가, 교체하거나
내용을 병합하지 않는다. Antigravity IDE 연동에는 plugin, `ip-orchestrator` 기계
식별자, Integrated Power 설정과 상태 파일을 사용한다.

확장 설치, 업데이트, Configuration Center 열기와 Integrated Orchestrator 설치 전후에
기존 `GEMINI.md`가 그대로 남아야 한다.

## 설치

### Open VSX 검색 설치

Antigravity IDE의 Extensions 화면에서 `Integrated Power`를 검색하고 제품명
`Integrated Power`와 Publisher `EggR`를 함께 확인한 뒤 설치한다.

### VSIX 직접 설치

검증이나 직접 배포에서는
[GitHub Releases](https://github.com/EggR0/integrated-power/releases)의 VSIX를
Antigravity IDE 전용 CLI wrapper로 설치한다. `<version>`은 받은 파일의 버전으로
바꾼다.

```powershell
& "$env:LOCALAPPDATA\Programs\Antigravity IDE\bin\antigravity-ide.cmd" `
  --install-extension ".\integrated-power-<version>.vsix" `
  --force
```

설치 또는 업데이트 후 실행 중인 Antigravity IDE에서 다음 명령을 한 번 실행한다.

```text
Developer: Reload Window
```

별도 프로그램인 다음 실행 파일은 확장 설치에 사용하지 않는다.

```text
%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe
```

## 설정 센터와 명령

명령 팔레트에서 다음 명령을 사용할 수 있다. 표시 제목은 현재 `package.json`과
일치한다.

| 명령 | 동작 |
|---|---|
| `Integrated Power: Open Configuration Center` | 세 구성의 통합 설정 페이지 열기 |
| `Integrated Power: Run First-Run Setup` | 최초 설정 개요 열기 |
| `Integrated Power: Configure Dashboard` | Dashboard 설정 영역 열기 |
| `Integrated Power: Configure Integrated Orchestrator` | Integrated Orchestrator 설정 영역 열기 |
| `Integrated Power: Configure Private Git Knowledge` | 사용자 Knowledge 설정 영역 열기 |
| `Integrated Power: Install or Update Integrated Orchestrator` | 설치 계획과 충돌 상태 확인 |

명령의 내부 `integratedPower.*` ID와 `ip-orchestrator` 기계 식별자는 호환성을
위해 유지한다.

개요 탭의 **상태 다시 확인**은 단순히 이전 결과를 다시 표시하지 않는다. 버튼을
누를 때 Windows 레지스트리의 최신 사용자·시스템 PATH와 GitHub CLI, Git, Ollama의
표준 설치 위치를 다시 읽는다. 따라서 IDE 실행 후 설치한 CLI도 IDE를 재시작하지
않고 감지할 수 있다. Ollama, Codex, Agy와 GitHub CLI는 관련 경로를 켜지 않았다면
“고장”이 아니라 선택 사항으로 표시한다.

Dashboard 표시 항목은 Antigravity IDE 설정에서 선택할 수 있다.

| 설정 | 기본값 | 설명 |
|---|---:|---|
| `integratedPower.view.showAntigravity` | `true` | Antigravity IDE 상태 영역 표시 |
| `integratedPower.view.showCodex` | `true` | Codex 상태 영역 표시 |
| `integratedPower.view.showLocalLlm` | `true` | 로컬 LLM·GPU 상태 영역 표시 |

## Integrated Orchestrator와 로컬 LLM

Integrated Orchestrator는 다음 두 정책을 제공한다.

- `user_default`: 사용자가 지정한 provider, endpoint와 model ID를 우선하며 임의로
  다른 모델로 바꾸지 않는다.
- `auto`: 현재 여유 VRAM, Compute Capability, backend 요구 조건, 설치 모델 크기,
  VRAM 예약량, CPU offload 허용 여부와 작업 적합도를 평가한다.

가중치 양자화 이름(Q4, MXFP4 등)과 GPU의 native FP4·FP8 연산 지원을 같은 것으로
취급하지 않는다. Ollama는 설치 모델 중 선택·실행할 수 있고, vLLM은 endpoint에 이미
로드된 모델과의 적합성을 확인한다. 자동 선택 결과는 추정 근거와 사용자 override를
구분해 기록한다.

Ollama를 선택하고 설정을 저장하거나 **설치 모델 다시 확인·레지스트리 동기화**를
누르면 `/api/tags`를 우선 사용하고 `ollama ls`를 호환 fallback으로 사용해 현재 PC의
모델을 조사한다. 설치됐지만 번들 목록에 없는 모델은
`%USERPROFILE%\.config\integrated-power\local_llm_model_registry.csv`에 중립 점수로
등록한다. Ollama가 제공하는 family, parameter size, quantization, 실제 파일 크기를
함께 기록하므로 다른 PC의 고정 목록을 그대로 재사용하지 않는다.

레지스트리에만 있고 설치되지 않은 모델은 정보로 표시할 뿐 자동으로 내려받지
않는다. 실제 작업에 맞는 설치 모델이 하나도 없을 때만 선택기가 VRAM 조건을 통과한
상위 후보를 반환하고, 에이전트는 정확한 모델 이름을 설명한 뒤 사용자에게 설치
여부를 물어야 한다. 승인 전에는 `ollama pull`을 실행하지 않는다. 실제 추론 요청은
`keep_alive`를 포함하며, `/api/ps`에서 모델이 내려가 있는 경우 cold-load용 긴 제한
시간을 적용한다.

## Private Git Knowledge

Integrated Power는 개발자의 Knowledge 저장소 내용을 배포하지 않는다. 각 사용자는
자신의 private Git remote 또는 원격 없는 `local_only` 저장소를 선택한다.

확장에는 Win11용 Knowledge 설정·분류·저장 도구가 포함된다. Configuration
Center의 **내장 Knowledge 도구 설치·복구**가 이를
`%LOCALAPPDATA%\IntegratedPower\bin`에 설치하므로 별도
`environment-bootstrap` clone은 필수가 아니다.

Git 작성자 email은 commit metadata이며 로그인 수단이 아니다. 원격 인증은 Git
Credential Manager 또는 SSH agent가 담당한다. 최초 설정·재설정 마법사는 기존
branch와 dirty 변경을 보존하며 commit, pull, rebase, checkout과 push를 자동
실행하지 않는다.

마법사는 기존 파일을 덮어쓰지 않고 빠진 Obsidian 기본 구조와
`.ai/knowledge-routing.json`만 만든다.

| 경로 | 지식 종류 |
|---|---|
| `00 Inbox` | 분류가 불확실한 기록과 Agent Worklog |
| `10 Projects` | 종료 조건이 있는 프로젝트 |
| `20 Knowledge` | 여러 작업에서 재사용할 지식·방법 |
| `30 Areas` | 지속적으로 관리할 운영·책임 영역 |
| `90 Templates` | 재사용 서식 |

에이전트는 `route-knowledge`로 기존 id·별칭·제목·파일명을 먼저 검사한다. 같은
주제가 있으면 기존 문서를 갱신하고, 불확실하면 새 폴더 대신 `00 Inbox`를 쓴다.
`save-knowledge`와 `save-agent-worklog`는 명시된 허용 파일만 검증·stage·commit하고
origin이 있으면 `main`을 `pull --rebase --autostash`한 뒤 force 없이 push한다.
Knowledge의 최종 기준은 항상 `main`이며 작업 이름의 `agent/...` 브랜치를 만들지
않는다. 코드·설정 저장소의 임시 작업 브랜치 정책과 구분된다.

GitHub 사용자명을 바꾼 경우 Configuration Center의 Knowledge 탭에서 다음 순서로
재설정한다.

1. **현재 GitHub 로그인으로 remote 감지**를 눌러 `gh api user`의 실제 로그인과
   현재 origin의 저장소 이름을 조합한 URL을 제안받는다.
2. 제안 URL을 확인한 뒤 **입력한 remote로 origin 재설정**을 눌러 해당 Knowledge
   저장소의 정확한 `origin`과 제품 설정을 함께 갱신한다.

이 작업은 commit, pull 또는 push를 실행하지 않는다.

## 상태와 설정 경로

| 데이터 | Windows 경로 |
|---|---|
| 공통 root 설정 | `%USERPROFILE%\.config\integrated-power\roots.json` |
| 기본 runtime state | `%LOCALAPPDATA%\IntegratedPower\state` |
| Integrated Orchestrator 설정 | `%USERPROFILE%\.config\integrated-power\orchestrator.json` |
| 사용자 로컬 LLM 레지스트리 | `%USERPROFILE%\.config\integrated-power\local_llm_model_registry.csv` |
| Antigravity IDE plugin | Configuration Center에서 확정한 plugin root 아래 `ip-orchestrator-plugin` |
| Win11 Knowledge 명령 | 기본 `%LOCALAPPDATA%\IntegratedPower\bin`, 사용자 지정 가능 |
| Private Git Knowledge | 사용자가 최초 설정에서 선택 |

경로 결정은 **명시적 환경 변수 → 이 PC의 canonical `roots.json` → 현재 OS·사용자의
제안값** 순서다. 확장은 사용자 홈 전체나 다른 드라이브에서 비슷한 이름의 폴더를
검색하지 않는다. Configuration Center에서 공통 작업 루트, Knowledge 경로,
Antigravity 플러그인 루트를 확인하고 저장한 값만 사용한다. Knowledge가 WorkRoot 밖에
있어도 사용자 선택을 존중하며 기존 저장소를 자동 이동·병합·삭제하지 않는다.

새 PC에서는 이전 PC의 절대 경로를 가져오지 않는다. 확장을 설치하고 Configuration
Center에서 세 경로를 현재 PC 기준으로 다시 확정한 다음, 사용자의 Knowledge Git
remote를 연결한다. 로컬 경로 설정은 Git에 넣지 않으며, 지식과 작업 기록만 Git으로
이어받는다. 자동화 환경은 `INTEGRATED_POWER_ROOTS_CONFIG`,
`INTEGRATED_POWER_WORK_ROOT`, `INTEGRATED_POWER_KNOWLEDGE_ROOT`,
`INTEGRATED_POWER_STATE_ROOT`, `INTEGRATED_POWER_TOOLS_ROOT`,
`INTEGRATED_POWER_ANTIGRAVITY_PLUGIN_ROOT`로 같은 선택을 명시할 수 있다.

0.7.2 이하의 기본 `%LOCALAPPDATA%\EggR\state`가 있으면 0.7.3 최초 활성화 때 새
`IntegratedPower\state`로 누락 파일만 한 번 복사한다. 이전 디렉터리는 삭제하지
않고 migration 기록을 새 상태 루트에 남긴다. 사용자가 별도 드라이브를 명시한
경우에는 그 사용자 지정 경로를 유지한다.

## 의존성

| 의존성 | 필요한 경우 | 자동 설치 |
|---|---|---|
| Antigravity IDE | 항상 | 하지 않음 |
| VSIX JavaScript runtime | 항상 | VSIX에 포함 |
| Git for Windows | Private Git Knowledge 사용 시 | 하지 않음 |
| Codex CLI | Codex 경로 사용 시 | 하지 않음 |
| Ollama 또는 vLLM | 로컬 LLM 경로 사용 시 | 하지 않음 |
| NVIDIA driver와 `nvidia-smi` | NVIDIA GPU 측정 시 | 하지 않음 |
| Agy | Agy 사용량을 Dashboard에 표시할 때 | 하지 않음 |

GPU driver, 모델, 서비스 포트, Git 인증과 API 자격 증명은 묵시적으로 설치하거나
변경하지 않는다. Configuration Center는 존재 여부와 영향을 진단하고 설정 위치를
안내한다.

## 개인정보와 비밀값

배포 VSIX와 공개 저장소에는 다음 개인 데이터를 포함하지 않는다.

- 비밀번호, access token, refresh token, API key와 자격 증명 데이터베이스
- 사용자 대화 원문, 개인 Knowledge 내용과 작업 기록
- 사용자 홈 절대 경로, 개인 Git remote와 로컬 설정값
- 내부 operational data, 테스트 계정과 인증 cache

설정에 외부 secret이 필요하면 값 대신 사용자가 선택한 환경 변수 이름만 기록한다.
로그를 공유하기 전에도 경로, remote URL, prompt와 token을 제거해야 한다.

## 문제 해결

### 확장은 설치됐지만 명령이 보이지 않음

1. Antigravity IDE의 Extensions 화면에서 Integrated Power가 활성화됐는지 확인한다.
2. `Developer: Reload Window`를 실행한다.
3. 명령 팔레트에서 `Integrated Power:`를 다시 검색한다.
4. 계속 실패하면 다음 확장 호스트 로그에서 활성화 오류를 확인한다.

   ```text
   %APPDATA%\Antigravity IDE\logs\<최근 세션>\window1\exthost\exthost.log
   ```

### 별도 Antigravity가 시작됨

확장 관리에는 다음 wrapper만 사용한다.

```text
%LOCALAPPDATA%\Programs\Antigravity IDE\bin\antigravity-ide.cmd
```

### 로그인 또는 인증 문제

Antigravity IDE, Codex, Agy와 Git 인증은 각 제품이 소유한다. Integrated Power는
사용자 계정을 삭제하거나 로그인 상태를 복구하지 않는다. 확장 활성화 오류와 인증
오류를 같은 원인으로 단정하지 말고 제품별 로그를 분리해 확인한다. Agy 사용량이
표시되지 않으면 Agy TUI에서 로그인을 확인하고 `/usage`가 동작하는지 먼저 확인한다.

## 공개판 지원 범위

- Windows 11을 우선 검증한다. Linux와 macOS 배포는 후속 범위다.
- provider가 실제 token usage를 제공하지 않으면 값을 0으로 만들지 않고
  `estimated` 또는 `unavailable`로 표시한다.
- Ollama나 vLLM이 없는 환경에서는 후보 선택을 검증할 수 있지만 실제 추론 성능을
  측정할 수 없다.
- Agy 사용량 표시는 Windows에서 설치된 Agy의 로컬 로그인 정보와 사용량 API에
  의존한다. Agy가 없거나 로그인되지 않은 환경에서는 값을 표시할 수 없다.

라이선스, 보안 신고, 지원 범위와 변경 이력은 각각 [LICENSE](LICENSE),
[COMMERCIAL-LICENSING.md](COMMERCIAL-LICENSING.md), [SECURITY.md](SECURITY.md),
[SUPPORT.md](SUPPORT.md), [CHANGELOG.md](CHANGELOG.md)에서 확인한다.
