# Standing Orders (상시 지시)

이 문서는 에이전트의 자율 행동 범위를 정의합니다.
에이전트는 매 스캔 주기마다 이 문서를 참조하여 감지된 변경 사항에 대해
자율적으로 실행할지, 사용자 승인을 요청할지를 판단합니다.

---

## 상위 목표

- INTERGRATED POWER 계획 점검하고 유지보수하기, 개선하기.

---

## 자율 실행 허가 범위 (Auto-approve)

아래 범위에 해당하는 작업은 사용자 승인 없이 즉시 실행하고 결과만 보고합니다.

- 읽기 전용 분석 및 보고서 작성 (`reports/` 내 파일 생성/수정)
- 코드 품질 스캔 (TODO 추출, 린트 검사, 코드 통계 등)
- 문서 오타 수정 및 포맷 정리 (`docs/` 내 `.md` 파일)
- `task_pipeline.json` 내 태스크 상태 전이 (detected → analyzing → planned)

## 승인 필요 범위 (Require approval)

아래 범위에 해당하는 작업은 구현 계획서를 작성하고 사용자에게 승인을 요청합니다.

- `ai-orchestrator/scripts/` 내 스크립트 로직 변경
- `config/` 설정 파일 수정 (이 문서 자체 포함)
- 신규 기능 구현 또는 아키텍처 변경
- `projects.txt`에 등록된 외부 프로젝트 코드 수정

## 금지 범위 (Never auto-execute)

아래 범위에 해당하는 작업은 어떤 조건에서도 자동 실행하지 않습니다.

- Git commit, push, branch 생성
- 외부 네트워크 API 호출이 필요한 작업
- 파일 삭제 (임시 테스트 파일 제외)
- 사용자 자격 증명(credential) 접근 또는 수정
