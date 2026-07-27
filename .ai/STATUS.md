# EggR Intergrated-POWER 상태

## 현재

- branch: `agent/codex/first-run-wizards`
- 대상: Antigravity IDE 확장 프로그램
- Dashboard: 0.6.0 설치
- EggR Orchestrator plugin: 2.1.0 관리 설치
- skill identity: `eggr-orchestrator`
- 전역 `GEMINI.md`: 설치 과정에서 생성·추가·교체하지 않음
- Win11 직접 배포 ZIP: 0.6.0 생성·실설치·재실행 검증 완료

## Configuration Center

- Dashboard 표시 영역과 EggR state root
- Git, GitHub CLI, Codex, Agy, Ollama, NVIDIA 의존성 진단
- 사용자 소유 Private Git/GitHub Knowledge 설정
- Orchestrator route, Codex, 로컬 LLM, VRAM 정책
- 플러그인 설치 계획, conflict, backup, 명시적 설치

기존 명령 팔레트 명령은 유지하며 각 설정 영역으로 이동한다.

## 배포 설치 규약

- Antigravity IDE 공식 global plugin root의 정확한 신규·이전 경로만 확인
- 사용자 홈 재귀 검색과 이름 기반 삭제 금지
- plugin·skill·EggR ownership 불일치 시 설치 중단
- staging, 전체 폴더 backup, atomic activation, rollback
- 설치 버전과 관리 파일 SHA-256 기록
- 같은 버전·체크섬 재실행은 `no-op`

상세 규약: `docs/reference/eggr-plugin-distribution.ko.md`

## 검증

- headless: 기존 9개 + 배포 마이그레이션 5개 통과
- extension host: 8개 통과
- PowerShell parser: 10개 통과
- `eggr-orchestrator` skill validation 통과
- VSIX 필수 파일·개인 절대 경로·이메일·GEMINI template 검사 통과
- 라이브 재계획: `managed-current`, `no-op`
- 설치 전후 사용자 `GEMINI.md` 해시 동일
- 직접 배포 PowerShell 파일: Windows PowerShell 5.1용 UTF-8 BOM 확인
- VSIX 내부 ID·버전, Knowledge payload commit·clean source 확인
- 압축 해제본 `VerifyOnly`, 설치, 두 번째 설치 `already-current` 통과
- Knowledge 8개 파일 hash와 schema 2 install state 일치
- 변조 VSIX, 잘못된 CLI, 누락·중복 manifest mapping 거부
- ZIP 개인 경로·이메일·개발자 원격 식별자 검사 통과
- ZIP SHA-256:
  `FF84156C82C5C3F07BA2ACBAE0432B506679F1ECC2C6E1AB91F5E44E6976704F`

## 다음

1. 최종 ZIP과 `.sha256.txt`를 함께 전달
2. 수신자는 ZIP 전체 압축 해제 후 `01-INSTALL.cmd` 실행
3. Antigravity IDE에서 `Developer: Reload Window`
4. `EggR: Open Configuration Center`
5. 별도 Windows 11 사용자 계정 또는 VM에서 신규 사용자 UI 전환 확인
