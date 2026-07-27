# EggR 작업·토큰 계측 규약 1.0

## 목적

모델이 “이번 작업이 얼마나 큰가”를 시작 전에 추정하고, 종료 후 실제 제공자 사용량과 결과 품질을 비교해 다음 추정을 보정한다. 비용 절감은 성공한 결과의 품질을 유지할 때만 개선으로 인정한다.

이 규약은 OpenTelemetry GenAI semantic conventions와 호환되는 필드 매핑을 제공하지만 EggR 자체 버전 스키마를 기준으로 삼는다. OpenTelemetry GenAI 규약은 현재도 Development 상태로 변경될 수 있기 때문이다.

## 작업 시작과 종료 판정

### `task_started`

다음 조건이 모두 만족된 최초 시점이다.

- 사용자의 요청과 작업 범위를 이해했다.
- OS, 저장소 루트, 브랜치와 기존 변경을 확인했다.
- 실행 경로(Main Agent, Codex, Antigravity, Local LLM)를 선택했다.
- 파일 수정, 외부 호출, 장시간 분석 등 비용이 발생하는 첫 승인된 행동을 시작한다.

단순히 대화를 열거나 상태를 조회한 것만으로 별도 작업을 만들지 않는다. 하나의 사용자 목표 안에서 연속된 검사·수정·검증은 같은 `task_id`를 유지하고, 독립적으로 재시도하거나 다른 모델에 위임한 실행은 별도 `attempt_id`를 사용한다.

### `task_completed`

다음 조건이 모두 만족된 시점이다.

- 요청한 산출물이 생성되었다.
- 위험에 비례한 테스트나 근거 확인이 끝났다.
- 실제 변경, 실패, 남은 위험과 다음 행동이 정리되었다.
- 필수 worklog/audit가 기록되었다.
- 사용자의 추가 권한이나 외부 상태 변경 없이는 할 수 없는 필수 작업이 남지 않았다.

실패는 `task_failed`, 사용자가 중단하면 `task_cancelled`, 외부 응답을 정상적으로 기다리는 동안은 `task_waiting`을 사용한다. “응답 문장을 작성했다”는 사실만으로 완료 처리하지 않는다.

## 시작 전 추정

각 작업은 다음을 기록한다.

- `estimated_total_tokens.low`, `point`, `high`
- `confidence`: 0~1
- `task_class`: 예: inspection, documentation, small_fix, feature, migration, incident
- `route`: main_agent, codex, antigravity, local_llm, hybrid
- 예상 도구 호출 수와 재시도 위험
- 성공 조건

점 추정값 하나만 기록하면 불확실성을 숨기므로 범위를 필수로 한다. 과거 자료가 없으면 넓은 범위와 낮은 confidence를 사용한다.

## 종료 후 실제 사용량

토큰 수의 증거 등급을 섞지 않는다.

1. `provider_reported`: API 또는 CLI의 공식 usage 응답. 실제값 비교의 우선 기준이다.
2. `calculated`: 공개된 tokenizer나 제공자의 count endpoint로 계산한 값. 모델 처리 방식 때문에 청구값과 다를 수 있다.
3. `estimated`: 문자수, 과거 평균, 모델 자기평가로 추정한 값.
4. `unavailable`: 신뢰할 수 있는 값을 얻지 못했다. 이때 0을 쓰지 않는다.

입력·출력·캐시·reasoning/thoughts·도구 토큰을 제공자가 구분하면 원본 필드를 보존하고 `total_tokens`를 함께 기록한다. 제공자별 대표 필드는 다음과 같이 매핑한다.

| 제공자/표준 | 공식 필드 예 | EggR |
|---|---|---|
| OpenTelemetry | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | `usage.input_tokens`, `usage.output_tokens` |
| OpenAI | 응답 usage의 input/output/total 계열 | 같은 의미의 EggR usage |
| Anthropic | `usage.input_tokens`, `usage.output_tokens` | 같은 의미의 EggR usage |
| Gemini | `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `totalTokenCount` | input/output/reasoning/total |

사용량 %는 `used_tokens`와 같은 기간·제품의 `capacity_tokens`가 모두 공식적으로 알려졌을 때만 계산한다. 한도 자체가 요청 수, 시간, 가중치 또는 동적 정책이면 토큰 %로 바꾸지 않고 별도 quota 단위와 근거를 기록한다.

## 보정

provider-reported 실제 총량이 있을 때만 정확도 지표를 계산한다.

- `ratio = actual_total / estimated_point`
- `absolute_percentage_error = abs(actual_total - estimated_point) / actual_total`
- 범위 적중 여부: `low <= actual_total <= high`

0으로 나누는 경우에는 지표를 비워 둔다. 최근 결과는 제공자·모델·task_class·route·agent_surface별로 분리하고 지수가중이동평균(EWMA)을 사용한다. 표본 수와 성공률을 함께 표시하며 작은 표본을 일반 규칙으로 승격하지 않는다.

다음 조건을 모두 만족해야 “더 효율적”이라고 판정한다.

- 성공 조건 통과
- 품질 점수나 검증 결과가 기준 이상
- 총 토큰, 지연, 비용, 호출/재시도 중 적어도 하나가 감소
- 다른 중요한 자원이 허용 범위 안

## 프라이버시와 보존

기본 이벤트에는 프롬프트·응답 전문·도구 인자·환경 변수를 넣지 않는다. `content_recorded` 기본값은 `false`다. 실행 원문이 필요하면 암호화 백업에 두고, Git에는 식별자·집계·정제 요약만 기록한다.

## 공식 근거

- OpenTelemetry GenAI observability: <https://opentelemetry.io/blog/2026/genai-observability/>
- OpenTelemetry GenAI metrics: <https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-metrics.md>
- OpenTelemetry semantic conventions releases: <https://github.com/open-telemetry/semantic-conventions/releases>
- OpenAI model 선택·평가 지침: <https://developers.openai.com/api/docs/guides/latest-model>
- Anthropic Messages usage: <https://platform.claude.com/docs/en/build-with-claude/working-with-messages>
- Anthropic token counting: <https://platform.claude.com/docs/en/build-with-claude/token-counting>
- Anthropic Usage and Cost API: <https://platform.claude.com/docs/en/manage-claude/usage-cost-api>
- Gemini token usage metadata: <https://ai.google.dev/gemini-api/docs/generate-content/tokens>

## 파일 형식

이벤트는 EggR workspace state의 `telemetry/events.jsonl`에 한 줄 JSON으로 추가한다. 스키마는 `config/eggr.telemetry.schema.json`을 사용한다. 향후 OpenTelemetry exporter는 이 원본 이벤트를 span/metric으로 변환하되, 스키마 버전과 증거 등급을 잃지 않아야 한다.

workspace에서는 `scripts/metrics/Write-EggRTelemetryEvent.ps1`, 설치된 하네스에서는 skill의 `scripts/Write-EggRTelemetryEvent.ps1`을 사용한다.

```powershell
.\scripts\metrics\Write-EggRTelemetryEvent.ps1 `
  -EventType task_started -TaskId "eggr-example" `
  -TaskClass feature -Route codex `
  -EstimatedLow 4000 -EstimatedPoint 7000 -EstimatedHigh 12000 -Confidence 0.55

.\scripts\metrics\Write-EggRTelemetryEvent.ps1 `
  -EventType calibration -TaskId "eggr-example" `
  -EstimatedLow 4000 -EstimatedPoint 7000 -EstimatedHigh 12000 -ActualTotal 8200
```
