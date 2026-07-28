# EggR Win11 안정화 설계

작성일: 2026-07-27
상태: 1단계 구현 중
우선 대상: Windows 11 25H2에서 개발·검증, Windows 11 23H2와의 복구 호환성 유지

## 1. 사용자의 의도를 구현 규칙으로 바꾼 결과

EggR는 Codex의 하위 기능이나 Antigravity 전용 플러그인이 아니다. 여러 에이전트와 IDE가 같은 프로젝트를 인식하고 작업 기록을 이어받게 하는 프레임워크 중립 식별자다. 지금은 Antigravity 대시보드와 Codex orchestrator를 시험대로 사용하지만, 장기적으로 Claude CLI, AGY, 로컬 LLM, Linux와 macOS가 같은 논리 구조를 사용해야 한다.

현재 단계에서는 다음을 분리한다.

1. `Intergrated-POWER`: 비공개 원본 저장소. 코드, 배포 설정, 정제된 지식과 의사결정의 기준이다.
2. `Intergrated-POWER-public`: 검증과 비밀정보 제거가 끝난 릴리스만 생성하는 공개 미러다. 이번 안정화 단계에서는 수정하지 않는다.
3. EggR 오케스트레이터: 에이전트 라우팅, 실행, 상태·토큰 기록을 담당한다.
4. Antigravity 대시보드: EggR 상태를 읽어 GUI로 보여주고, 사용자가 명시적으로 요청할 때 오케스트레이터 번들을 설치·갱신한다.
5. 런타임 원자료: Git이 아니라 EggR 상태 경로와 암호화 백업에 둔다.

## 2. 왜 Codex 하위 경로를 사용하지 않는가

`~/.codex/...`를 공통 루트로 사용하면 다른 프레임워크가 Codex의 내부 데이터에 의존하게 된다. 경로의 소유권과 수명이 Codex 설치 방식에 묶이고, 에이전트는 같은 기능을 새 경로에 다시 만드는 오류를 반복하기 쉽다.

EggR는 다음과 같이 논리 이름을 먼저 고정하고 실제 경로는 운영체제별 resolver가 결정한다.

| 논리 루트 | Win11 기본값 | 성격 |
|---|---|---|
| `config_root` | `%USERPROFILE%\.config\eggr` | 작은 사용자 설정, 경로 override |
| `state_root` | `%LOCALAPPDATA%\EggR\state` | 실행 상태, 보고서, 세션, 계측 |
| `workspace_state` | `<state_root>\workspaces\<workspace-id>` | 프로젝트별 공유 상태 |
| canonical Git repo | 사용자가 선택한 작업 폴더 | 코드, 정제 문서, 스키마, 결정 기록 |

필요한 경우 `EGGR_STATE_ROOT` 환경 변수 또는 `%USERPROFILE%\.config\eggr\roots.json`의 `state_root`만 설정한다. 일반 사용자는 기본값을 바꿀 필요가 없다.

## 3. PC와 절대 경로가 바뀌어도 같은 프로젝트를 찾는 방법

`workspace-id` 결정 순서는 다음과 같다.

1. 저장소에 `.eggr/workspace.json`이 있고 유효한 `id`가 있으면 이를 사용한다.
2. Git `origin`이 있으면 SSH/HTTPS 문법과 `.git` 차이를 제거한 원격 식별자의 SHA-256 앞 24자를 사용한다.
3. Git 원격이 없으면 정규화한 절대 경로의 SHA-256 앞 24자를 사용한다.

예를 들어 같은 GitHub 저장소를 `C:\Work\A`와 `D:\Moved\A`에서 열어도 `git-<24 hex>`가 동일하다. 반면 Git과 명시 ID가 모두 없는 임시 폴더는 경로가 바뀌면 별개 프로젝트로 처리된다. 이것은 서로 무관한 폴더의 상태가 섞이는 것보다 안전한 후퇴 규칙이다.

기존 Antigravity IDE `globalStorage` 자료는 삭제하거나 이동하지 않는다. 사용자가 **EggR: Install or Update Orchestrator** 명령을 실행하면 알려진 구형 대·소문자 드라이브 해시 위치에서 새 EggR 상태 경로로 없는 파일만 복사한다.

## 4. 오케스트레이터와 대시보드를 분리한 이유

기존 확장 프로그램은 대시보드가 활성화될 때마다 다음 전역 상태를 자동 변경했다.

- `~/.gemini/GEMINI.md` 생성 또는 검토 유도
- `~/.gemini/config/plugins/codex-orchestrator-plugin` 전체 동기화
- 각 저장소의 `.agents/dashboard_global_storage.txt`에 PC 절대 경로 기록

여러 IDE 창이나 구버전 확장이 동시에 살아 있으면 마지막으로 활성화된 버전이 전역 플러그인을 되돌릴 수 있다. 또한 저장소에 기록한 PC 절대 경로는 다른 컴퓨터에서 유효하지 않다.

0.3.0부터 대시보드 활성화는 오케스트레이터를 설치하지 않는다. 명시적 설치 명령만 다음 트랜잭션을 수행한다.

1. 새 번들을 임시 stage 디렉터리에 완전히 복사한다.
2. 기존 플러그인을 `.eggr-backups` 아래로 이동한다.
3. stage를 활성 경로로 바꾼다.
4. 실패하면 기존 플러그인을 복원한다.
5. 구형 대시보드 상태의 없는 파일만 EggR 상태로 복사한다.

이 분리는 대시보드 릴리스와 오케스트레이터 릴리스가 나중에 서로 다른 저장소·버전 주기를 갖게 하기 위한 첫 단계다.

## 5. Git과 암호화 백업의 역할 분담

| 자료 | 저장 수단 | 이유 |
|---|---|---|
| 소스, 테스트, 배포 설정 | 비공개 Git | 변경 추적·리뷰·복구 |
| 정제된 한국어 결정·인수인계·오류 재발 방지 기록 | 비공개 Git + Knowledge | 에이전트가 재사용할 작은 문맥 |
| 공개 가능한 릴리스 | 정제 후 public 미러 | 원본 저장소의 비밀·운영자료 유출 차단 |
| 토큰 집계, 성공률, 보정계수 | EggR state + 정제된 집계 snapshot | 고빈도 원자료와 장기 지식을 분리 |
| 원시 Antigravity brain, 프롬프트, 도구 인자, 전체 로그 | 암호화 백업 | 민감정보·절대경로·대용량 고빈도 자료 |
| 비밀정보와 `.env` | 비밀 저장소/로컬 전용 | Git 이력과 에이전트 로그에 남기지 않음 |

### 원시 brain 로그를 Git에 넣지 않는 이유

원시 로그에는 프롬프트뿐 아니라 도구 인자, 사용자명, 절대 경로, 작업 파일 일부, 자격증명 단서가 섞일 수 있다. 한 번 Git 이력과 원격 복제본에 들어가면 파일을 현재 커밋에서 지우는 것만으로 제거되지 않으며, 이력 재작성과 모든 복제본의 재동기화가 필요하다. GitHub도 민감정보 제거는 이력 재작성과 협업자 조정이 필요한 파괴적 절차라고 설명한다.

또한 런타임 로그는 작고 의미 있는 소스 변경과 달리 계속 증가한다. GitHub는 생성 파일을 Git 밖에 두고 큰 바이너리는 Git LFS나 별도 저장소를 사용하도록 권장한다. 복구 목적이라면 저장소 데이터 전체를 암호화하고 인증하는 restic 같은 백업이 더 맞다.

- GitHub 민감정보 제거: <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository>
- GitHub 저장소 제한 권고: <https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits>
- restic 설계와 암호화: <https://restic.readthedocs.io/en/v0.18.1/design.html>
- restic 저장소 준비: <https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html>

Git에는 원시 로그 대신 사건 요약, 재현 조건, 원인, 수정, 검증, 남은 위험과 집계 지표를 남긴다. 원본과 정제본을 모두 보존해야 할 때 원본은 암호화 백업, 정제본은 Git이라는 두 층을 사용한다.

## 6. Win11 배포와 복구 순서

1. 비공개 원본 저장소를 clone하고 agent 브랜치에서 작업한다.
2. Node/pnpm과 PowerShell 요구사항을 doctor로 확인한다. 실행 정책 때문에 `.ps1` 직접 실행이 막히면 서명 정책을 바꾸지 말고 현재 단계에서는 `powershell -ExecutionPolicy Bypass -File <검증된 스크립트>`를 사용한다.
3. 확장 프로그램 테스트와 패키징을 완료한다.
4. Antigravity에 VSIX를 설치한다.
5. 명령 팔레트에서 **EggR: Install or Update Orchestrator**를 한 번 실행한다.
6. `%LOCALAPPDATA%\EggR\state\workspaces`와 `.gemini\config\plugins\.eggr-backups`를 확인한다.
7. 비공개 Git 원격과 암호화 백업을 각각 검증한다.

이번 단계는 자동으로 기존 brain/globalStorage를 삭제하지 않으며 public 미러도 갱신하지 않는다. Linux/macOS는 resolver 형식만 미리 두었고, 실제 배포 안정화는 Win11 이후 별도 검증한다.
