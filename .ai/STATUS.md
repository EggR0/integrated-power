# Integrated Power 상태

## 현재

- branch: `agent/codex/first-run-wizards`
- 대상: Antigravity IDE 확장 프로그램
- 설치된 Dashboard: `EggR.integrated-power@0.7.3`
- 활성 plugin: `ip-orchestrator-plugin` 3.0.0
- 활성 skill identity: `ip-orchestrator`
- 기본 Win11 state root: `%LOCALAPPDATA%\IntegratedPower\state`
- Private Git Knowledge remote: `https://github.com/EggR0/eggr-knowledge.git`
- 전역 `GEMINI.md`: 설치·이전 과정에서 변경하지 않음

## Configuration Center

- 개요의 `상태 다시 확인`은 Windows 레지스트리의 최신 사용자·시스템 PATH와
  표준 설치 위치를 다시 읽는다. IDE 시작 후 설치된 GitHub CLI도 재시작 없이
  감지한다.
- Dashboard는 사용량·GPU 관측, Integrated Orchestrator는 실행 경로 선택,
  Private Git Knowledge는 사용자 소유 작업 기억 보존으로 역할을 분리한다.
- Knowledge 탭에서 현재 `gh` 로그인과 실제 origin을 확인하고, 새 계정 기준 remote
  감지와 명시적 origin 재설정을 수행할 수 있다.
- Knowledge 최초 설정 마법사는 commit·pull·push를 실행하지 않는다.
  `save-agent-worklog`는 중앙 Agent Worklog 한 파일만 검증해 agent 브랜치에서
  commit, pull --rebase, push한다.

## 마이그레이션

- 0.7.2 이하의 `%LOCALAPPDATA%\EggR\state`는 새 상태 루트로 누락 파일만 한 번
  복사하며 원본을 삭제하지 않는다.
- 인식된 `eggr-orchestrator-plugin`과 `codex-orchestrator-plugin`만 정확한
  경로에서 `.integrated-power-backups`로 보존한 뒤 `ip-orchestrator-plugin`을
  설치한다.
- 현재 PC의 이전 `eggr-orchestrator-plugin`은
  `.integrated-power-backups/eggr-orchestrator-plugin-2026-07-28T13-22-30-691Z`
  로 보존됐다.

## 검증

- headless: 17개 통과
- extension host: 9개 통과
- PowerShell parser: 16개 통과
- Skill Creator `quick_validate.py`: `Skill is valid!`
- 공개 allowlist: 83개 파일, private-content dry-run 통과
- VSIX: 39 entries, `EggR.integrated-power@0.7.3`
- 현재 설치 카탈로그: `eggr.integrated-power@0.7.3`
- 설치 전후 `GEMINI.md` SHA-256 동일:
  `975B39433C22F47CFDD8D6146487D143D21EC86A613BA3C436328E2EB76D235D`
- 최종 VSIX SHA-256은 재패키징 결과와 함께 WORKLOG/HANDOFF에 기록한다.

## 다음

1. Antigravity IDE에서 `Developer: Reload Window`를 한 번 실행한다.
2. `Integrated Power: Open Configuration Center`의 개요에서
   `상태 다시 확인`을 눌러 GitHub CLI가 `✓`로 표시되는지 확인한다.
3. Knowledge 탭에서 GitHub 로그인 `EggR0`와 실제 origin을 확인한다.
4. 공개 agent branch를 push하고 GitHub Release 0.7.3에 최종 VSIX를 첨부한다.
