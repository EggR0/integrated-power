# 바로 게시할 홍보 문안

아래 문안은 채널별로 그대로 붙여 넣은 뒤 최신 릴리스 링크만 추가한다.

## Reddit / Google AI Developers Forum

### 제목

Antigravity에서 quota가 부족해도 작업을 이어가는 로컬 대시보드를 만들었습니다

### 본문

Antigravity를 오래 사용하다 보면 지금 어떤 모델 사용량이 남았는지, 로컬 GPU가 준비됐는지, 작업을 다른 실행 경로로 넘길 수 있는지 한 번에 보기 어렵습니다.

그래서 Windows 11용 `Integrated Power`를 만들었습니다.

- Antigravity 사용량과 상태를 한 화면에서 확인
- Codex·로컬 LLM·GPU 상태를 별도로 확인
- 작업을 어떤 실행 경로로 넘길지 Configuration Center에서 선택
- 로컬에서 수집한 데이터와 직접 측정한 사용량을 구분
- quota를 늘리거나 계정을 대신 인증하지 않음

짧은 데모: `[영상 링크]`  
설치: `[최신 VSIX 또는 문서 링크]`  
소스/문제 제보: `[저장소 또는 이슈 링크]`

Antigravity + Windows 11 환경에서 실제로 써 보신 뒤, 첫 화면에서 헷갈리는 점이나 꼭 필요한 지표를 알려 주시면 다음 릴리스에 반영하겠습니다.

## Dev.to / GeekNews / Velog

### 제목

AI IDE의 quota가 아니라 작업 경로를 관리하는 Integrated Power를 만든 이유

### 요약

AI IDE 사용량을 보여 주는 것만으로는 작업이 계속되지 않습니다. Integrated Power는 Antigravity의 상태, Codex·Claude 직접 사용량, Ollama/vLLM·GPU 상태를 구분해 보여 주고, 사용량이 부족할 때 작업을 어느 경로로 이어갈지 선택하게 하는 Windows용 도구입니다.

이 글에서는 다음을 공개합니다.

1. Antigravity quota와 직접 측정한 Claude 사용량을 왜 분리했는가
2. 로컬 파일에서 어떤 숫자만 집계하고 원문 로그는 왜 표시하지 않는가
3. cloud 경로와 local 경로를 작업 단위로 나누는 방법
4. 설치·업데이트·문제 제보 경계

데모와 설치 안내: `[링크]`

## X / LinkedIn / Bluesky

Antigravity 사용량만 보는 대시보드가 아니라, quota·GPU·로컬 LLM·Codex 실행 경로를 한 화면에서 관리하는 Windows 11 도구를 만들었습니다.

작업이 막히면 “기다리기”가 아니라 “다음 실행 경로 선택”으로 이어가는 것이 목표입니다.

30초 데모: `[링크]`  설치: `[링크]`

## 크리에이터 연락 문안

안녕하세요. Antigravity용 Windows 확장 `Integrated Power`를 만들고 있습니다.

quota 표시만 하는 도구가 아니라 Antigravity·Codex·로컬 LLM·GPU 상태를 한 화면에서 보여 주고, 작업 경로를 바꾸는 흐름을 시연할 수 있습니다.

혹시 5분 정도 사용해 보시고 다음 세 가지만 알려 주실 수 있을까요?

1. 첫 화면에서 바로 이해되지 않는 부분
2. 실제로 매일 확인할 지표
3. 설치·보안 측면에서 불안한 부분

리뷰나 홍보를 요청드리는 것이 아니라 초기 사용성 피드백을 받고 싶습니다. 필요하시면 VSIX, 짧은 데모 영상, 테스트 시나리오를 함께 보내 드리겠습니다.
