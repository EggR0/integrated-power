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
  `E2902535D565AB9A28CE7368F0F2A033DDE19A51FB27793573DE2CBC4F3E298C`
- 공개 CI: 통과
- GitHub Release:
  `https://github.com/EggR0/integrated-power/releases/tag/v0.7.4`
- 현재 Antigravity IDE 설치: `eggr.integrated-power@0.7.4`

## 배포 상태

- 비공개 원본, 공개 원본, environment-bootstrap, Knowledge의 변경은 모두 PR로
  `main`에 병합됐다.
- 공개 Release에 VSIX가 첨부됐다.
- 감사한 원격 agent branch 32개는 병합·내용 회수 후 삭제됐다.
- Open VSX 게시만 Eclipse Foundation의 GitHub ID 검토 때문에 별도 대기 중이다.
