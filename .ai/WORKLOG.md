# EggR 작업 기록

## 2026-07-27 — Antigravity IDE Dashboard 0.4.2 README 교체

- 확장 패키지에 실제 포함되는 `vscode-extension/README.md`를 전면 교체했다.
- 첫 문단에 개발·실행 대상이 Antigravity IDE 확장임을 명시하고, 별도
  Antigravity와 Codex 확장이 아님을 명시했다.
- 올바른 `Antigravity IDE\bin\antigravity-ide.cmd` 설치 경로와 사용하면 안 되는
  별도 `Programs\Antigravity\Antigravity.exe`를 함께 기록했다.
- 세 갈래 설정, 명령, 데이터 경로, 의존성, 자동 설치하지 않는 범위, Orchestrator
  로컬 모델 정책, Private Knowledge, 비밀값 정책, 문제 해결을 한 문서로 통합했다.
- 같은 버전에서 내용이 다른 VSIX가 생기지 않도록 0.4.2로 올렸다.
- 검증: headless 9개, extension-host 8개, VSIX 내부와 설치 폴더의 README 내용,
  manifest version/displayName, 확장 카탈로그 0.4.2를 확인했다.
- VSIX SHA-256:
  `5316A9FF58D0F00C0F85DEE6D2B0003FA63F4E8ACDE9C8D16CAF2ED258093D45`.

## 2026-07-27 — Antigravity IDE Dashboard 0.4.1 BOM 활성화 복구

- 범위: 별도 Antigravity나 Codex 확장이 아니라 Antigravity IDE Dashboard 확장.
- 운영 교정: 확장 조회·설치는 `Antigravity IDE\bin\antigravity-ide.cmd`만
  사용하며 GUI `.exe`에 CLI 옵션을 직접 전달하지 않는다.
- 원인: Windows PowerShell 5.1이 `roots.json`을 UTF-8 BOM과 함께 썼고,
  0.4.0의 `resolveEggRStateRoot`가 BOM을 제거하지 않아 활성화 중
  `Unexpected token '﻿'`로 종료됐다.
- 수정: 공통 UTF-8 JSON reader가 BOM을 허용하고 `roots.json`,
  `.eggr/workspace.json`, 설정 마법사 JSON에 적용된다.
- 수정: 환경 구축의 `set-eggr-roots.ps1`은 BOM 없는 UTF-8을 쓴다.
- 명칭: 사용자 명령을 `EggR: Install or Update Orchestrator`로 줄이고,
  현재 제품 대상이 Antigravity IDE임을 문서에 명시했다.
- 검증: headless 8개, extension-host 8개, VSIX manifest/entry point,
  Windows Knowledge 기능 테스트와 전체 PowerShell parser 통과.
- 설치: Dashboard 0.4.1을 Antigravity IDE 확장 카탈로그에 설치했으며,
  실행 중인 사용자 창은 강제 종료하지 않아 reload 후 실제 명령 표시를 확인한다.
- 사건 정정: 별도 Antigravity는 잘못된 실행 파일 조회로 20:40:27~20:43:21
  실행됐다. Java는 이 앱이 새로 시작한 것이 아니라 전날부터 실행 중인 Minecraft
  NeoForge였지만, 겹친 시간에 3380ms/67 ticks 과부하 경고를 남겼다. 직접 인과는
  확인되지 않았으나 “Java는 무관하다”라고 단정하지 않는다.

## 2026-07-27 — 세 갈래 최초 실행 마법사와 로컬 모델 선택

- Dashboard 0.4.0에 세 개의 독립 설정 진입점과 coordinator를 추가했다.
  Dashboard는 표시 영역과 `state_root`, Orchestrator는 실행 경로·Codex 위치·로컬
  provider와 정책, Private Knowledge는 별도 environment-bootstrap 명령을 담당한다.
- Orchestrator 1.2.0 설정에 `LocalLlm.HardwarePolicy`를 추가했다.
  `auto`는 현재 PC의 VRAM·compute capability를 매 실행 시 다시 읽고,
  `user_default`는 사용자가 지정한 모델을 조용히 교체하지 않는다.
- selector는 Ollama `/api/tags`의 설치 크기를 우선 사용하고, 없으면 registry의
  명시적 추정치를 사용한다. VRAM reserve, CPU offload 허용 여부, task 적합도,
  성공률·속도 이력을 함께 기록한다.
- Q4/MXFP4 가중치 저장 형식과 native FP4 연산 요구를 분리했다. TensorRT-RTX에서
  명시적으로 FP8/FP4 runtime precision을 요구한 row에만 compute capability를
  hard constraint로 사용한다.
- 이 PC의 RTX 3090은 총 24GB, 감지 CC 8.6, 검증 시 free 약 21.2GB였다.
  reasoning 자동 선택은 예상 14GB(2GB reserve 포함)의 `gpt-oss:20b`였다.
  현재 Ollama/vLLM은 설치되어 있지 않아 실제 추론 호출은 하지 않았다.
- Agy 실행 파일은 doctor의 fallback 경로에서 발견했지만, 기존 기록에서 headless
  권한 실패와 재시도로 총 토큰이 늘어난 사례가 확인됐다. 이미 병렬 완료된 단순
  문서를 다시 위임하지 않았으며, 직접 처리와 위임+재검토 총비용 비교 규칙은
  Knowledge 문서에 남겼다.
- 검증: headless 7개, extension-host 7개, PowerShell parser 41개, selector offline
  smoke, 실제 GPU 탐지, standalone 설정 보존/auto/user-default smoke, VSIX 필수
  파일·개인 절대 경로 검사, `git diff --check` 통과.
- 산출물: `antigravity-ide-dashboard-0.4.0.vsix`, SHA-256
  `EC4D1D25074A75669D3AEB94B8CE67FA2B5DEF666152F3E5FC675C781A0453A9`.

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

## 2026-07-27 — Configuration Center와 GEMINI.md 비의존 전환

- Dashboard, Orchestrator, Private Git Knowledge 명령을 한 Configuration Center의
  독립 영역으로 연결했다.
- 번들 플러그인과 스킬의 공개 식별자를 `eggr-orchestrator-plugin`,
  `eggr-orchestrator`로 변경했다. 이전 플러그인은 명시적 설치 시
  `.eggr-backups`로 이동한다.
- Orchestrator 설정 기본 경로를 `%USERPROFILE%\.config\eggr\orchestrator.json`으로
  변경하고 이전 설정 파일은 새 설정이 없을 때만 읽는다.
- `assets/gemini.md`, 확장 초기화 함수, PowerShell `-InstallGlobalRules`와
  전역 규칙 추가 함수를 제거했다.
- 0.4.2는 기존 `GEMINI.md`를 발견하면 보존했으므로 확장 자체 백업은 만들지
  않았다. 별도 전역 규칙 추가 스크립트가 사용된 경우 백업은
  `%USERPROFILE%\.gemini\GEMINI.md.backup-YYYYMMDD-HHMMSS`에 남는다.
- 이 PC의 설치 전후 `GEMINI.md` SHA-256은
  `975B39433C22F47CFDD8D6146487D143D21EC86A613BA3C436328E2EB76D235D`로
  동일했다.
- TypeScript compile과 headless 테스트 9개를 통과하고 0.5.0을 Antigravity
  IDE에 설치했다. VSIX SHA-256은
  `C946C1B4137ABC8DBDF12E9F9B62BA7C5D66FFD821C63356543B970FED5D2D41`이다.

## 2026-07-27 — 배포형 플러그인 마이그레이션 0.6.0

- 현재 사용자 홈 전체를 검색하는 방식 대신 Antigravity IDE 공식 global plugin
  root 아래 `eggr-orchestrator-plugin`, `codex-orchestrator-plugin` 두 정확한
  경로만 확인하는 설치 코어를 추가했다.
- plugin manifest, skill frontmatter, EggR ownership marker와 설치 상태로 소유권을
  판정한다. 같은 경로에 인식되지 않은 내용이 있으면 자동 이동하지 않고
  `conflict`로 중단한다.
- staging, 전체 디렉터리 백업, 원자적 활성화, 실패 rollback, 관리 파일 SHA-256,
  확장 global storage journal, 동일 버전 `no-op`을 구현했다.
- Configuration Center에 Git/GitHub CLI를 포함한 의존성 안내, GitHub private
  저장소 생성 링크, 플러그인 설치 계획·충돌·백업 설명을 추가했다.
- 임시 사용자 홈에서 clean install, 0.4.2 전환, same-path conflict, 강제 실패
  rollback, idempotency를 검증했다. 기존 headless 9개와 신규 배포 5개,
  extension-host 8개, PowerShell 10개 parser, 스킬 형식 검사가 통과했다.
- 라이브 2.0.0 수동 설치본을 전체 백업하고 관리 상태가 있는 2.1.0으로 전환했다.
  재계획은 `managed-current`/`no-op`이며 `GEMINI.md` 해시는 변하지 않았다.
- VSIX 0.6.0 최종 SHA-256:
  `2B000FDCFFEC4EBA1131BB0EC43BF3BB532C58285EECFBF4CBC93BFF5D6506E8`.

## 2026-07-27 — Win11 직접 배포 ZIP

- `distribution/win11`에 더블클릭 설치, 무변경 검증, Dashboard 확장만 제거하는
  진입점과 재현 가능한 ZIP 생성기를 추가했다.
- Dashboard VSIX와 `environment-bootstrap`의 사용자 소유 Private Knowledge
  Windows 명령 8개를 한 배포본에 포함했다. Knowledge payload는 commit
  `eea1adf1050e1a13a93272c06aabf92ea4979db8`로 고정하며 해당 source file의
  dirty/staged 변경이 있으면 패키징을 중단한다.
- Windows PowerShell 5.1의 UTF-8 무BOM 오해석을 막기 위해 배포되는 PowerShell
  파일만 UTF-8 BOM으로 변환한다. 소스 파일 인코딩은 변경하지 않는다.
- 설치기는 VSIX 내부 identity/version, 전체 필수 payload SHA-256, Knowledge
  mapping 완전성, reparse point, Antigravity IDE CLI identity를 검증한다.
- 기존 Knowledge 명령은 인식 가능한 EggR legacy 또는 관리 state와 hash가 맞을
  때만 백업 후 갱신한다. 외부 수정이나 인식되지 않은 같은 이름 파일은 충돌로
  중단한다. schema 2 state에 설치 파일별 hash, 생성 파일, PATH 추가 여부를 남긴다.
- 이 PC에서 실제 설치 후 두 번째 실행이 완전한 `already-current`였고 state hash도
  동일했다. `GEMINI.md`와 `roots.json` 해시는 전후 동일했다.
- 압축 해제본 검증, 변조 VSIX 거부, 잘못된 CLI 거부, extension-only 제거 검증,
  개인 경로·이메일·개발자 원격 식별자 검사와 ZIP sidecar 비교가 통과했다.
- 최종 ZIP SHA-256:
  `FF84156C82C5C3F07BA2ACBAE0432B506679F1ECC2C6E1AB91F5E44E6976704F`.

## 2026-07-28 — Integrated Power 0.7.0 공개 배포 준비

- 기존 Agy 사용량 조회 파일 3개는 HEAD와 byte/hash가 동일하도록 보존했다.
- 공개 표시명은 Integrated Power, 사용자 표시명은 Integrated Orchestrator로
  정리하고 기계 ID는 `integratedPower.*`, `eggr-orchestrator*`로 유지했다.
- PolyForm Strict 1.0.0, NOTICE, 지원·보안·상용 문의 문서와 256 px 아이콘을
  추가했다. `GEMINI.md`를 생성하거나 교체하는 경로는 포함하지 않았다.
- headless와 extension-host 8/8 검사를 통과했다. 0.7.0 VSIX는 39개 entry이며
  개인정보·개인 이메일·개발자 홈 경로·중첩 VSIX 검사 0건이다.
- VSIX SHA-256:
  `3B20CFC5DA5A06AB456FBA56A47D6F8DEC6BE66CF26204D8D0440F48653654FE`.
- 허용 목록 83개 파일만 새 `integrated-power-antigravity-public` 저장소로
  내보내고 `agent/codex/public-release-0.7.0` root commit
  `a819f41f5d500571590cf4cf114d1ecddbed511a`을 만들었다.
- GitHub 연결 계정은 확인됐으나 새 저장소 생성용 브라우저가 로그아웃 상태라
  remote 생성·push와 Open VSX 게시는 사용자 로그인 이후로 남겼다.

## 2026-07-28 — 공개 GitHub 저장소와 v0.7.0 Release 게시

- GitHub CLI 2.96.0을 공식 winget 패키지로 설치하고 `R-Github04` 계정을 Windows
  자격 증명 저장소에 연결했다.
- `R-Github04/integrated-power-antigravity` 공개 저장소를 생성하고
  `agent/codex/public-release-0.7.0` 브랜치를 push했다.
- Draft PR #1을 만들고 CI 통과 후 `main`에 병합했다. merge commit은
  `3f018f46a473c7eb2facc467793efc35392cf73e`이다.
- 첫 CI는 pnpm 11.9와 Node 20 불일치, 다음 CI는 Windows PowerShell 5.1의 UTF-8
  무BOM 오해석으로 실패했다. 확장 런타임을 수정하지 않고 공개 CI와 내보내기
  템플릿만 Node 24 및 `pwsh`로 변경했다.
- PR CI와 병합 후 `main` CI에서 의존성 설치, TypeScript compile, headless tests,
  공개 PowerShell 전체 parser 검사가 통과했다.
- GitHub Release `v0.7.0`을 게시하고 검증된 VSIX를 첨부했다. GitHub가 계산한
  asset digest가 로컬 SHA-256
  `3B20CFC5DA5A06AB456FBA56A47D6F8DEC6BE66CF26204D8D0440F48653654FE`와 일치한다.
- 남은 외부 단계는 Eclipse/Open VSX 계정 연결, publisher agreement,
  `integratedpower` namespace 생성·확인, Open VSX 게시다.

## 2026-07-28 — Integrated Power 정식 확장 ID와 0.7.1 배포 후보

- 첫 마켓 게시 전 호환성 유지가 필요 없다는 사용자 결정을 반영해 확장 기술 이름을
  `integrated-power`, 정식 확장 ID를 `integratedpower.integrated-power`로 변경했다.
- 표시명은 올바른 영어 표기 `Integrated Power`로 유지하고 검색 키워드에
  `integrated power`, `integratedpower`를 추가했다. 오타 표기는 추가하지 않았다.
- Windows 배포 manifest, 설치 검증기, 테스트, README와 현재 운영 문서를 새 ID 및
  `integrated-power-0.7.1.vsix` 파일명으로 맞췄다. 기능 로직은 변경하지 않았다.
- headless 14개와 extension-host 8개 테스트가 통과했다. 공개 내보내기 허용 목록
  83개 및 개인정보 검사가 통과했다.
- 비공개 원본과 공개 소스에서 만든 VSIX의 39개 내부 entry가 모두 byte-identical이다.
  공개 배포 후보 SHA-256은
  `FC9255FEE24D0BAC45A9F29FD35A7AF2CAB24F5046C08BA502CAF63D3D470339`이다.
- 공개 commit `69af20a`를 PR #2와 CI를 거쳐 `main` merge commit
  `f9ab76943258c70cc4e5593ea827d35d6497bce5`로 병합했다. 병합 후 CI도 통과했다.
- GitHub Release `v0.7.1`을 게시하고 `integrated-power-0.7.1.vsix`를 첨부했다.
  GitHub asset digest가 위 로컬 SHA-256과 일치한다.

## 2026-07-28 — Open VSX 게시 CLI의 빌드 절차 분리 설치

- VSIX 생성과 이미 생성된 VSIX의 마켓 게시가 별도 작업이라는 경계를 바로잡았다.
- Win11에 공식 Node.js LTS 24.18.0과 npm 11.16.0을 설치하고, 사용자 전역 npm
  경로에 `ovsx` 1.0.2를 설치했다. 새 레지스트리 PATH 기준으로 `node`, `npm`,
  `ovsx` 명령의 경로와 버전을 확인했다.
- 앞서 잘못 추가한 프로젝트 내부 `ovsx` 개발 의존성과 미게시 GitHub Actions
  워크플로 초안은 제거했다. 확장 기능 및 기존 0.7.2 변경은 수정하지 않았다.
- 게시 대상은 공개 소스에서 이미 만들어진 `EggR.integrated-power` 0.7.2
  VSIX이며 SHA-256은
  `052F392F6EB50F6265CC88B96F62727A18E492D14C1F10024EF875FDF43879D6`이다.
- 설치 직후 Open VSX의 `EggR` namespace는 HTTP 404였고 저장된 PAT가 없었다.
  토큰이 화면·채팅·Git에 노출되지 않도록 별도 PowerShell의 보안 입력으로
  namespace 생성과 자격 증명 검증을 시작했다.
