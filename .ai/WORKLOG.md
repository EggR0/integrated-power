# EggR 작업 기록

## 2026-07-27 — Win11 경로·오케스트레이터 안정화

### 범위

- canonical private repo: `Intergrated-POWER`
- branch: `agent/codex/eggr-win11-stabilization`
- 보존 checkpoint: `4966882e2a9566fa1044f4ecd36afaeb0c566911`
- public mirror, Antigravity brain 원본, globalStorage 원본은 수정하지 않음

### 확인한 원인

1. 외부 `new-chat-4`의 `.git`은 유효한 저장소가 아니며 실제 private/public 저장소는 `work/` 아래에 따로 있었다.
2. v0.2.4 소스가 commit되기 전 설치·패키징되어 복구 기준이 불명확했다.
3. `.agents/dashboard_global_storage.txt`에 Computer 1의 `C:\Users\jsp0\...` 경로가 tracked 상태로 남아 있었다.
4. TypeScript와 PowerShell의 Windows 드라이브 대소문자 정규화 차이로 workspace hash가 갈라졌다.
5. 번들 스크립트가 호출 대상 저장소의 `scripts\util\GlobalStorage.psm1`을 가정해 임의 프로젝트에서 실패했다.
6. 대시보드 활성화가 `GEMINI.md`와 전역 플러그인을 자동 변경해 여러 IDE 창·구버전 확장 사이의 덮어쓰기 위험이 있었다.
7. 실행 helper도 Codex를 호출할 때마다 전역 설정과 global rules를 쓰고 있었다.
8. Windows sandbox 환경의 `Path`/`PATH` 중복 때문에 `Start-Process`가 Codex 실행 전에 실패할 수 있었다.
9. `package-lock.json`과 `pnpm-lock.yaml`이 공존했고 package script가 이 PC에 없는 npm을 호출했다.

### 구현

- PowerShell/TypeScript 공통 EggR resolver 도입
  - Win11 기본: `%LOCALAPPDATA%\EggR\state`
  - override: `EGGR_STATE_ROOT`, `%USERPROFILE%\.config\eggr\roots.json`
  - workspace ID: 명시 ID → 정규화한 Git origin SHA-256 → 경로 SHA-256
- 번들 오케스트레이터에 self-contained resolver 포함
- `.agents/dashboard_global_storage.txt` tracking 제거, 실제 로컬 파일과 기존 runtime 자료는 보존
- 확장 0.3.0과 오케스트레이터 1.1.0 분리
  - 활성화 시 전역 오케스트레이터/GEMINI 자동 변경 제거
  - 명시적인 EggR 오케스트레이터 설치 명령에서만 설치
  - stage 후 교체, 기존 플러그인은 `.eggr-backups`에 보존, 실패 시 rollback
  - legacy 상태는 새 위치에 없는 파일만 복사
- 실행 helper를 read-only resolver로 변경하고 global rule 추가는 명시적 `-InstallGlobalRules`에서만 허용
- Codex Debate 실행을 `System.Diagnostics.Process` 기반 UTF-8 redirected process로 변경
- pnpm 단일 잠금 파일과 허용 build dependency 목록 고정
- EggR telemetry schema 1.0, 한국어 규약, metadata-only JSONL writer 추가
- active setup/README의 개인 절대 경로와 깨진 한글 정리

### 검증

- TypeScript compile 통과
- headless tests 6개 통과
- VS Code 1.130.0 extension host tests 7개 통과
- bundled Codex Debate SelfTest 통과
- PowerShell parser: 번들 10개 파일 통과
- PowerShell/TypeScript resolver가 모두 `git-17f66ea6e26ab6603c1128f1` 산출
- canonical/bundled resolver 및 telemetry writer hash 일치
- telemetry start/usage/calibration/completed 4개 이벤트 round-trip 통과
- VSIX 0.3.0 생성: 30 entries, 107,820 bytes
- VSIX SHA-256: `54C6F422DF5559E9290D3EBF04216571B969D5ABD305998E314B840031D63BA4`
- VSIX 필수 resolver/writer 포함, `C:\Users\jsp0`, marker 파일명, target-repo module 경로 검출 0
- Antigravity IDE extension catalog에 0.3.0 설치, 설치된 `out/extension.js`와 빌드 결과 hash 일치
- VSIX 설치 직후 global orchestrator는 1.0.4로 유지됨: 대시보드 설치만으로 오케스트레이터를 자동 덮어쓰지 않는 생명주기 분리 확인

### 근거와 결정

- OpenTelemetry GenAI usage 명명법은 매핑 대상으로 채택하되 Development 상태이므로 EggR schema를 versioned source of truth로 유지한다.
- provider 응답을 `provider_reported`, tokenizer/count endpoint를 `calculated`, 모델/문자 기반 값을 `estimated`, 값이 없으면 `unavailable`로 분리한다.
- 원시 brain/tool 로그는 민감정보와 고빈도 변경 때문에 Git에 넣지 않고 암호화 백업 대상으로 둔다. Git에는 정제된 사건·결정·집계만 기록한다.

### 현재 작업의 토큰 보정

이 Codex desktop 작업은 provider-reported 총 token usage를 로컬 이벤트로 제공하지 않았다. 따라서 실제값을 0이나 추정값으로 대체하지 않고 evidence를 `unavailable`로 기록하며 이번 작업으로 calibration ratio를 만들지 않는다. 다음 작업부터는 시작 이벤트의 low/point/high/confidence를 먼저 기록하고, 공식 usage가 있는 실행만 calibration한다.

### 남은 작업

1. 원격 `https://github.com/R-Github04/Intergrated-POWER.git`이 신뢰 가능한 비공개 canonical 원격이라는 사용자 확인 후 agent 브랜치 push
2. Antigravity IDE를 재시작하고 명시적 EggR 설치 명령을 실행해 global orchestrator 1.1.0·backup·legacy state 복사를 smoke test
3. marketplace/public 배포 전 repository metadata와 LICENSE 결정
4. public mirror sanitization pipeline과 Win11 암호화 backup/save-agent-worklog 구현
5. Linux/macOS resolver·installer 실제 검증

중앙 `Knowledge/00 Inbox/Agent Worklog.md`에는 한 줄 audit를 추가했다. 다만 이 Win11 환경에는 `save-agent-worklog` 명령이 설치되어 있지 않아 실행이 `CommandNotFoundException`으로 끝났다. bootstrap에 있는 구현은 Linux `$HOME/Knowledge` 전용이며 `main`에 직접 push하므로, 기존 Knowledge 사용자 변경을 섞지 않는 Windows용 동등 구현이 필요하다.

## 2026-07-27 — 오케스트레이터 명칭과 0.3.1 검증

- Decision: 사용자가 만든 `codex-orchestrator` 기능은 오케스트레이터라고만 부른다.
  더 큰 실행 프레임워크나 외부 제품 개념과 혼동되는 명칭을 이 기능에 사용하지 않는다.
- Outcome: 표시 명칭, command ID, 함수명, 설치 오류, 문서, 테스트, telemetry
  producer 필드를 `orchestrator` 기준으로 통일했다.
- Outcome: 확장 0.3.1과 번들 오케스트레이터 1.1.1을 패키징하고 Antigravity
  IDE에 설치했다. 대시보드 설치는 전역 오케스트레이터를 자동 교체하지 않는다.
- Fix: 사용량 값이 없는 telemetry 이벤트에서 빈 배열의 `.Count`가 실패하던
  PowerShell 버그를 canonical/bundled writer 모두 수정했다.
- Verification: headless 6개, extension-host 7개, PowerShell parser 33개,
  Debate SelfTest, telemetry unavailable/estimated round-trip, VSIX 내부 문자열·버전
  검사 통과.
- Artifact: `antigravity-ide-dashboard-0.3.1.vsix`,
  SHA-256 `6BBB6877473E87211E8D0171F2A5E9E2BBAFE426003A0323F9BD1C1C61910ECC`.
