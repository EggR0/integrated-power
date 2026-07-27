# EggR Intergrated-POWER 상태

## 현재

- branch: `agent/codex/first-run-wizards`
- 대상: Antigravity IDE 확장 프로그램
- Dashboard: 0.6.0 설치
- EggR Orchestrator plugin: 2.1.0 관리 설치
- skill identity: `eggr-orchestrator`
- 전역 `GEMINI.md`: 설치 과정에서 생성·추가·교체하지 않음

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

## 다음

1. 실행 중인 Antigravity IDE에서 `Developer: Reload Window`
2. `EggR: Open Configuration Center`
3. Orchestrator 영역에서 설치 계획이 `managed-current`/`no-op`인지 확인
4. Windows 11 별도 테스트 사용자 계정 또는 VM에서 0.4.2→0.6.0 UI 전환 확인
