# STATUS

## 현재 기준

- 제품: Antigravity IDE 전용 확장 `Integrated Power`
- 버전: `0.7.4`
- 공개 ID: `eggr.integrated-power`
- 오케스트레이션 스킬 ID: `ip-orchestrator`
- Windows 상태 루트: `%LOCALAPPDATA%\IntegratedPower`
- Knowledge 도구 설치 루트: `%LOCALAPPDATA%\IntegratedPower\bin`

## Knowledge 동작

- 확장 자체가 Windows용 지식 도구 6개를 포함한다.
- Configuration Center에서 도구 설치, 저장소 최초 설정, GitHub 로그인·origin
  재설정을 이어서 수행할 수 있다.
- 전역 Knowledge 저장소는 `main`만 기준 브랜치로 사용한다.
- 문서는 `.ai/knowledge-routing.json`이 선언한 기존 문서와 고정 폴더로만
  라우팅한다.
- 애매한 지식은 `00 Inbox`, 프로젝트는 `10 Projects`, 재사용 지식은
  `20 Knowledge`, 지속 책임은 `30 Areas`, 형식은 `90 Templates`에 둔다.
- 코드 저장소의 `agent/...` 브랜치 규칙을 Knowledge 저장소에 적용하지 않는다.

## 검증

- TypeScript compile: 통과
- headless: 17개 통과
- extension host: 10개 통과
- PowerShell parser: 16개 통과
- initialize/routing PowerShell 통합 테스트: 통과
- Skill Creator 검증: 통과
- VSIX: `integrated-power-0.7.4.vsix`, 46개 파일
- SHA-256:
  `F74883F8FE3DA35EC8DD5D433A1EC41FA2A1518F9D89D6FB49AEA87F3E18A8B7`

## 남은 배포 작업

1. 비공개 원본과 environment-bootstrap, Knowledge 변경을 각각 agent branch에
   커밋한다.
2. PR을 통해 기준 브랜치로 병합한다.
3. 공개 저장소의 기존 draft PR #3을 0.7.4 내용으로 갱신한다.
4. Antigravity IDE에 0.7.4 VSIX를 설치해 실제 Configuration Center를 확인한다.
