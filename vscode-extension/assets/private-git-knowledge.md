# Integrated Power Private Git Knowledge 최초 실행

이 기능은 개발자의 Knowledge 저장소를 복제하는 기능이 아니다. 각 사용자가 자신의
비공개 Git 저장소를 연결해 에이전트의 작업 기록과 장기 지식을 누적하기 위한
기능이다.

Integrated Power 확장에는 Win11용 Knowledge 도구가 포함된다. Configuration
Center에서 **내장 Knowledge 도구 설치·복구**를 누른 뒤 설정 마법사를 실행한다.
명령은 다음 제품 전용 경로에도 설치된다.

```powershell
%LOCALAPPDATA%\IntegratedPower\bin\initialize-eggr-knowledge.cmd
```

마법사가 묻는 항목:

- Knowledge 로컬 경로
- 사용자가 소유한 private Git remote URL 또는 명시적 local-only 모드
- Git 작성자 이름과 이메일

마법사는 기존 문서를 덮어쓰지 않고 빠진 Obsidian 기본 경로와
`.ai\knowledge-routing.json`만 추가한다.

- `00 Inbox`: 분류가 불확실한 기록과 Agent Worklog
- `10 Projects`: 종료 조건이 있는 프로젝트
- `20 Knowledge`: 여러 작업에서 재사용할 지식과 방법
- `30 Areas`: 지속적으로 관리할 운영·책임 영역
- `90 Templates`: 재사용 서식

에이전트는 기존 id·별칭·제목·파일명을 먼저 검색하고, 같은 주제가 있으면 기존
문서를 갱신한다. 판단이 불확실하면 `00 Inbox`를 사용하며 새 최상위 폴더를 만들지
않는다. `route-knowledge`로 경로를 검증하고 `save-knowledge` 또는
`save-agent-worklog`로 명시한 파일만 canonical `main`에 저장한다. Knowledge
작업을 분류하기 위한 `agent/...` 브랜치는 만들지 않는다.

마법사 자체는 기존 dirty 파일을 보존하고 commit·pull·push를 자동 실행하지 않는다.

GitHub, GitLab, Gitea 등 표준 Git remote를 사용할 수 있다. 인증 토큰이나
비밀번호는 Integrated Power 설정에 저장하지 않고 Git Credential Manager 또는 사용자가
선택한 Git credential helper에 맡긴다.
