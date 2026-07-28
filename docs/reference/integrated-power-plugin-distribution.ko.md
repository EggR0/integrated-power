# Integrated Power Orchestrator 플러그인 배포·마이그레이션 규약

## Win11 직접 배포 상위 경계

최종 사용자용 ZIP은 `distribution/win11`에서 생성한다. 이 ZIP은 Dashboard VSIX와
Private Knowledge Windows 명령을 고정하지만, 이 문서의 Orchestrator 설치 규약을
우회하지 않는다. 사용자가 Configuration Center에서 설치를 명시한 뒤에만
Antigravity IDE 전역 plugin root가 변경된다.

직접 배포 설치기는 다음만 자동으로 수행한다.

1. `release-manifest.json`의 설치 payload SHA-256 검증
2. 정확한 Antigravity IDE CLI를 통한 Dashboard VSIX 설치·갱신
3. `%LOCALAPPDATA%\IntegratedPower\bin`의 제품 소유 Windows Knowledge 명령 설치
4. 기존 Windows 명령이 다른 경우 시각별 폴더에 백업

별도 Antigravity 애플리케이션, `GEMINI.md`, 사용자 Knowledge 내용, 로그인 정보,
GPU driver와 외부 도구는 변경하지 않는다. 확장 제거 진입점도 Dashboard만
제거하며 Orchestrator·Knowledge·EggR 설정과 상태를 보존한다.

## 목적

이 문서는 Antigravity IDE 확장을 다른 Windows 11 사용자에게 배포할 때
`ip-orchestrator` 플러그인을 안전하게 설치·갱신하는 기준을 정의한다.

배포 설치 관리자는 사용자 홈을 재귀 검색하거나 이름이 비슷한 파일을 삭제하지
않는다. Antigravity IDE가 공식적으로 사용하는 plugin root와 EggR가 과거에
배포한 정확한 경로만 확인한다.

## 관리 경로

현재 사용자 홈을 `HOME`이라고 할 때 관리 대상은 다음뿐이다.

| 용도 | 경로 |
|---|---|
| Antigravity IDE plugin root | `HOME/.gemini/config/plugins` |
| 현재 플러그인 | `HOME/.gemini/config/plugins/ip-orchestrator-plugin` |
| 바로 이전 플러그인 | `HOME/.gemini/config/plugins/eggr-orchestrator-plugin` |
| 초기 이전 플러그인 | `HOME/.gemini/config/plugins/codex-orchestrator-plugin` |
| 백업 | `HOME/.gemini/config/plugins/.integrated-power-backups` |
| 플러그인 설치 상태 | 현재 플러그인의 `.integrated-power-install-state.json` |
| 확장 설치 journal | 확장의 `globalStorageUri/installations/ip-orchestrator.json` |

다음은 하지 않는다.

- 사용자 홈이나 드라이브 전체에서 `*orchestrator*` 검색
- workspace의 임의 `.agents/plugins` 변경
- 이름만 같은 디렉터리 삭제
- 사용자의 `GEMINI.md` 생성·추가·복원
- 다른 사용자 프로필 순회

한 컴퓨터에 사용자가 여러 명이면 각 사용자 세션에서 독립적으로 설치한다.

## 소유권 판정

신규 플러그인은 다음을 모두 만족해야 한다.

1. 디렉터리 이름: `ip-orchestrator-plugin`
2. `plugin.json.name`: `ip-orchestrator-plugin`
3. 스킬 경로: `skills/ip-orchestrator/SKILL.md`
4. `SKILL.md` frontmatter name: `ip-orchestrator`
5. 관리 설치 후 `.integrated-power-install-state.json` 존재

바로 이전 플러그인은 디렉터리·manifest 이름
`eggr-orchestrator-plugin`, 스킬 이름 `eggr-orchestrator`, 그리고
Integrated Power가 발행한 기존 ownership metadata를 모두 만족해야 한다.

초기 이전 플러그인은 다음을 모두 만족해야 한다.

1. 디렉터리 이름: `codex-orchestrator-plugin`
2. `plugin.json.name`: `codex-orchestrator-plugin`
3. 스킬 경로와 frontmatter name: `codex-orchestrator`

정확한 경로에 다른 manifest나 skill name이 있으면 `conflict`로 판정한다. 이
경우 자동 이동·교체하지 않고 Configuration Center에 중단 이유를 표시한다.

관리 설치 후 사용자가 플러그인 파일을 수정하면 체크섬 불일치로 판정한다. 수정본을
파일별로 덮어쓰지 않고 디렉터리 전체를 백업한 뒤 새 버전을 설치한다.

## 설치 상태

설치 계획은 다음 상태를 사용한다.

| 상태 | 의미 | 기본 처리 |
|---|---|---|
| `absent` | 경로 없음 | 신규 설치 |
| `recognized-unmanaged` | identity는 맞지만 EggR 설치 상태 없음 | 전체 백업 후 관리 설치 |
| `managed-current` | 소유권 상태와 파일 체크섬 일치 | 같은 버전이면 `no-op` |
| `managed-outdated` | 상태는 있으나 버전 또는 파일 변경 | 전체 백업 후 교체 |
| `conflict` | identity 불일치 | 설치 중단 |

버전형 마이그레이션은 한 번 적용한 이력을 상태와 journal에 기록하고, 같은 설치를
다시 실행해도 결과가 바뀌지 않아야 한다.

## 적용 순서

1. bundled source의 manifest와 skill identity를 검증한다.
2. 정확한 신규·이전 경로만 진단한다.
3. Configuration Center에 변경 계획과 예상 백업 위치를 표시한다.
4. 사용자가 `설정 저장 및 플러그인 설치·갱신`을 명시적으로 누른다.
5. plugin root 아래 고유 staging 디렉터리에 새 버전을 복사한다.
6. 관리 파일 SHA-256과 버전을 staging의 설치 상태에 기록한다.
7. 기존 신규 경로가 있으면 `.integrated-power-backups`로 이동한다.
8. 인식된 이전 경로가 있으면 `.integrated-power-backups`로 이동한다.
9. staging을 신규 경로로 원자적으로 이동한다.
10. 확장 global storage에 완료 journal을 기록한다.

중간 단계가 실패하면 이동한 기존·이전 디렉터리를 원래 위치로 되돌린다. staging은
plugin root 내부의 검증된 정확한 경로만 제거한다.

## 제거와 복구

자동 uninstall은 외부 플러그인 데이터를 삭제하지 않는다. 향후 제거 기능은
`.integrated-power-install-state.json`이 있는 정확한 신규 경로만 대상으로 삼고, 삭제 대신
백업 이동을 기본으로 한다.

복구는 Configuration Center가 journal의 백업 목록을 보여준 뒤 사용자가 명시적으로
선택하는 방식으로 구현한다. 신규 경로에 사용자가 수정한 파일이 있으면 복구 전에
그 디렉터리도 새 백업으로 보존한다.

## 배포 검증 행렬

실제 사용자 홈이 아니라 매 테스트마다 새 임시 홈을 만든다.

| 사례 | 기대 결과 |
|---|---|
| 신규 사용자 | 신규 플러그인 설치, 다른 경로 불변 |
| 0.4.2 공식 이전 플러그인 | 이전 전체 백업, 신규 설치 |
| 이름만 같은 타 플러그인 | `conflict`, 변경 없음 |
| 신규·이전 동시 존재 | 각 identity 확인 후 신규 교체·이전 백업 |
| 관리 파일 사용자 수정 | 수정본 전체 백업 후 교체 |
| 설치 중 강제 실패 | 이전 위치 복원, 신규 활성화 없음 |
| 동일 버전 재실행 | `no-op` |
| 사용자 `GEMINI.md` 존재 | 설치 전후 해시 동일 |
| 홈 내부 무관한 decoy 경로 | 내용과 시각 불변 |
| 권한 또는 잠금 실패 | 오류 보고와 rollback |

VSIX에는 다음도 확인한다.

- `ip-orchestrator-plugin`과 `ip-orchestrator` 포함
- `assets/gemini.md` 미포함
- 개발자 절대 경로·이메일·비밀값 미포함
- 이전 이름은 마이그레이션 상수와 문서에만 존재

## Configuration Center 역할

Configuration Center는 다음을 한 화면에 제공하지만 데이터 수명은 분리한다.

- Dashboard 표시 영역과 EggR state root
- Git, GitHub CLI, Codex, Agy, Ollama, NVIDIA 진단과 의존성 안내
- Private Git/GitHub Knowledge 설정
- Orchestrator 설정
- 플러그인 설치 계획, conflict 이유, 백업 정책
- 명시적 플러그인 설치·갱신

명령 팔레트의 기존 명령은 유지하고 각 설정 영역으로 바로 이동한다.
