# 외부 게시 직전 체크리스트

## 공급 상태

- [ ] 게시물의 설치 링크가 검증된 동일 artifact를 가리킨다(현재 공개 기준은 GitHub `v0.9.8` 및 Open VSX `v0.9.8`).
- [ ] 게시하려는 `.vsix`의 내부 manifest, 파일명, tag/release 버전이 서로 일치한다.
- [ ] 소스 `package.json` 버전이 공개 artifact와 다르면 두 버전을 명시적으로 구분한다.
- [ ] publisher와 extension ID가 `EggR0` / `EggR0.integrated-power`로 일치한다.
- [ ] Open VSX listing은 canonical publisher/ID가 확인된 경우에만 설치 링크로 사용한다.
- [ ] GitHub Actions CI (`Publish to Open VSX`) 파이프라인이 초록색(성공)으로 완료되었음을 확인했다.
- [ ] Control Center는 별도 제품·저장소·release 상태로 검증하고 VSIX와 합쳐 표현하지 않는다.
- [ ] 수동 설치 안내가 실제 Antigravity 메뉴 이름과 일치한다.
- [ ] 지원 환경을 Antigravity IDE on Windows 11로 명확히 표시했다.

## 메시지 안전성

- [ ] quota를 늘리거나 우회한다고 주장하지 않았다.
- [ ] Antigravity quota와 직접 측정한 Claude/API/CLI 사용량을 구분했다.
- [ ] 로그인·토큰·외부 통신 여부를 과장하거나 누락하지 않았다.
- [ ] 경쟁 확장을 근거 없이 비난하지 않았다.

## 게시 순서

1. Antigravity Reddit 또는 Google AI Developers Forum에 문제 해결형 글을 하나 게시한다.
2. 같은 주에 30초 데모를 공개하고 첫 글에서 연결한다.
3. 질문이 반복되면 README와 지원 문서를 먼저 갱신한다.
4. 반응이 확인된 뒤 Dev.to·GeekNews·영상 채널로 확장한다.

## 기록할 결과

- 게시 시각과 URL
- 조회수·댓글·링크 클릭
- 설치 성공 또는 실패 사례
- 반복 질문과 다음 릴리스 반영 여부
