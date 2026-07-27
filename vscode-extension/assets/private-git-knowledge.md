# EggR Private Git Knowledge 최초 실행

이 기능은 개발자의 Knowledge 저장소를 복제하는 기능이 아니다. 각 사용자가 자신의
비공개 Git 저장소를 연결해 에이전트의 작업 기록과 장기 지식을 누적하기 위한
기능이다.

Windows에서는 `environment-bootstrap`을 설치한 뒤 다음 명령을 실행한다.

```powershell
initialize-eggr-knowledge
```

마법사가 묻는 항목:

- Knowledge 로컬 경로
- 사용자가 소유한 private Git remote URL 또는 명시적 local-only 모드
- Git 작성자 이름과 이메일

WorkRoot는 공통 `roots.json`에서 동적으로 읽는다. 마법사는 기존 branch와 dirty
파일을 보존하고 commit·pull·push를 자동 실행하지 않는다. 설정 후 사용자가
`git status`를 검토하고 첫 commit/push 시점을 직접 정한다.

GitHub, GitLab, Gitea 등 표준 Git remote를 사용할 수 있다. 인증 토큰이나
비밀번호는 EggR 설정에 저장하지 않고 Git Credential Manager 또는 사용자가
선택한 Git credential helper에 맡긴다.
