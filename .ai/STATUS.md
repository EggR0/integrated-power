# EggR Intergrated-POWER 상태

## Current

- branch: `agent/codex/first-run-wizards`
- 개발 대상: Antigravity IDE Dashboard 확장. 별도 Antigravity 또는 Codex 확장이 아님
- Antigravity IDE Dashboard: 0.4.1 설치, 사용자 창 reload 대기
- bundled EggR Orchestrator: 1.2.0
- telemetry schema: 1.2.0
- 전역 Orchestrator는 명시적 IDE 명령을 실행할 때만 갱신된다.

## Verified

- 0.4.0 활성화 실패 원인: Windows `roots.json` UTF-8 BOM
- headless tests: 8 passed, BOM 재현 포함
- extension-host tests: 8 passed, BOM 재현 포함
- VSIX manifest/entry point 검사 통과
- installed extension catalog: `integratedpower.antigravity-ide-dashboard@0.4.1`
- 현재 `roots.json`은 BOM 없는 UTF-8

## Next

1. 실행 중인 Antigravity IDE 창을 reload한다.
2. 명령 팔레트에서 `EggR: Run First-Run Setup` 표시를 확인한다.
3. 사용자가 선택한 뒤 `EggR: Install or Update Orchestrator`를 실행한다.
4. public mirror는 별도 sanitization 작업 전까지 수정하지 않는다.
