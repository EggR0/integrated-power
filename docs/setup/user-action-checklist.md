# 사용자 확인 체크리스트

## 최초 설치

- [ ] 비공개 canonical 저장소인지 확인
- [ ] Win11 doctor 결과에서 failure가 없는지 확인
- [ ] 대시보드 compile/headless test 통과
- [ ] 검증된 VSIX 설치
- [ ] **EggR: Install or Update Orchestrator** 명령 1회 실행
- [ ] 기존 `GEMINI.md`가 보존되었는지 확인
- [ ] `%LOCALAPPDATA%\EggR\state\workspaces`에 상태가 생성되는지 확인

## 매 작업 시작

- [ ] 현재 저장소·브랜치·기존 변경 확인
- [ ] HANDOFF/STATUS와 사용자 목표 확인
- [ ] 수정 범위와 금지 범위 확인
- [ ] 실행 route와 성공 조건 결정
- [ ] 토큰 low/point/high와 confidence 기록

## 매 작업 종료

- [ ] diff와 테스트 결과 확인
- [ ] provider-reported/calculated/estimated/unavailable 구분
- [ ] 예상과 실제 토큰 비교, 실제값이 없으면 보정하지 않음
- [ ] 오류 원인·재현·수정·남은 위험 기록
- [ ] HANDOFF/WORKLOG와 중앙 Agent Worklog 갱신
- [ ] 현재 작업 파일만 commit
- [ ] 신뢰가 확인된 비공개 원격의 agent 브랜치에 push
- [ ] 원시 brain/runtime 로그는 Git이 아닌 암호화 백업으로 보존

## 다른 PC로 이동

- [ ] 비공개 Git 저장소 clone
- [ ] environment-bootstrap doctor 실행
- [ ] 필요하면 `%USERPROFILE%\.config\eggr\roots.json` 복원
- [ ] 암호화 백업에서 EggR state와 원시 로그 복구
- [ ] VSIX와 오케스트레이터를 설치한 뒤 workspace-id가 이전 PC와 같은지 확인
- [ ] public 미러는 복구 기준으로 사용하지 않음
