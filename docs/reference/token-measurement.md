# Token Measurement

The goal is accurate measurement, not packet interception.

## What Is Actually Accurate

| Layer | Accuracy | What it gives | Notes |
| --- | --- | --- | --- |
| Codex `exec --json` usage | Exact for that Codex turn | input, cached input, output, reasoning output tokens | Best local signal for Codex CLI jobs |
| OpenAI input token count API | Exact input only | input tokens before a request | Useful before spending a real generation |
| Gemini `countTokens` API | Exact input only | input tokens before a Gemini request | Use this for Gemini API requests you build yourself |
| Gemini response usage | Exact for that API response | input, output, thinking, cached, tool tokens | Available when you own the API call/response |
| Antigravity quota view | Authoritative quota, not raw per-turn tokens | remaining quota/usage by model group | Best for Antigravity IDE quota planning |
| Antigravity IDE transcript estimate | Approximate | local transcript size and tool-call text estimate | Useful trend signal only |
| API response `usage` | Exact for API calls you own | input/output/cached/reasoning usage | Best for custom API integrations |
| Codex dashboard or `/status` | Authoritative limit view | remaining limits and credits | Best for quota planning |
| Local heuristic | Approximate | text size estimate | Works offline but low confidence |
| Network packet/port metrics | Not token-accurate | bytes, timings, destinations | TLS hides payloads and tokenization is server/model-specific |

## Why Network Interception Is The Wrong Layer

Packet and port analysis can tell you that a process exchanged bytes with a host. It cannot reliably tell how many model tokens were used because:

- HTTPS/TLS encrypts request and response bodies.
- HTTP/2, compression, retries, and streaming change byte patterns.
- Token counts include server-side message formatting, tool schemas, cached context, reasoning tokens, and sometimes hidden state.
- Model tokenization can change by model and request shape.
- MITM interception of app traffic is fragile and can expose credentials or violate product/security expectations.

Use network telemetry only as a coarse sanity check for "a request happened", not as a token counter.

## Recommended Measurement Stack

1. For Codex CLI jobs, always run with `-JsonLog`.
2. Parse the JSONL usage event into `reports/codex_usage.csv`.
3. For Antigravity IDE, use the built-in quota view for quota planning, not packet capture.
4. For Antigravity IDE local trend estimates, use `scripts/metrics/Measure-AntigravityTranscript.ps1`.
5. For Gemini API prompts, use `scripts/metrics/Count-GeminiInputTokens.ps1` before sending.
6. For Gemini API responses, parse `usageMetadata` or `usage` with `scripts/metrics/Parse-GeminiUsage.ps1`.
7. For prompts you are about to send to the OpenAI API yourself, use `scripts/metrics/Count-OpenAIInputTokens.ps1`.
8. For plain local text estimates, use `scripts/metrics/Track-Tokens.ps1`.
9. For weekly and 5h limit planning, use each product's quota dashboard or CLI status.

## Antigravity-Specific Notes

Antigravity IDE does not currently expose a stable, documented Codex-style JSONL event with exact per-turn token usage in the local transcript files. It typically stores local transcripts under the current user's profile:

```text
%USERPROFILE%\.gemini\antigravity-ide\brain\...\transcript.jsonl
```

Those transcript files include step content and tool calls, but not a stable `usageMetadata` field. The local conversation database has protobuf BLOB metadata, but that is not a public stable contract.

Do not commit raw brain/transcript data to Git. Preserve it through encrypted backup and commit only sanitized incident summaries and aggregate metrics. Use `eggr-telemetry.ko.md` for evidence labels and estimate calibration.

For Antigravity, track two separate things:

- **Quota**: authoritative usage/remaining limits shown by Antigravity or fetched from its local IDE service.
- **Tokens**: exact only when you own the Gemini API request/response; estimated when derived from Antigravity transcript text.

## Commands

Run a Codex job and capture exact Codex turn usage:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dispatch\Invoke-CodexJob.ps1 -PromptFile .\prompts\codex\codex-readonly-audit.md -Sandbox read-only -JsonLog
```

Parse an existing Codex JSONL log:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\metrics\Parse-CodexUsage.ps1 -JsonlPath .\reports\example.jsonl -Model gpt-5.5 -PrintSummary
```

Estimate local text without API access:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\metrics\Track-Tokens.ps1 -FilePath .\ai-work-queue.md -OperationName queue-estimate
```

Count exact input tokens through the official API:

```powershell
$env:OPENAI_API_KEY = "<your api key>"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\metrics\Count-OpenAIInputTokens.ps1 -FilePath .\ai-work-queue.md -Model gpt-5.5
```

Estimate Antigravity IDE local transcript size:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\metrics\Measure-AntigravityTranscript.ps1
```

Count exact Gemini input tokens:

```powershell
$env:GEMINI_API_KEY = "<your api key>"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\metrics\Count-GeminiInputTokens.ps1 -FilePath .\ai-work-queue.md -Model gemini-3.5-flash
```

Parse a saved Gemini API response that contains `usageMetadata` or `usage`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\metrics\Parse-GeminiUsage.ps1 -JsonPath .\reports\gemini-response.json -Model gemini-3.5-flash
```

Optionally fetch Antigravity quota through a third-party local/cloud quota CLI:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\metrics\Invoke-AntigravityUsageTool.ps1 -Method local
```

Review the tool before use. It is useful for quota snapshots, but it is not an official token counter.

## Data Files

| File | Meaning |
| --- | --- |
| `reports/token_usage.csv` | Local estimates and OpenAI input count results |
| `reports/codex_usage.csv` | Exact usage parsed from Codex JSONL events |
| `reports/gemini_token_usage.csv` | Gemini countTokens and response usage results |
| `reports/antigravity_transcript_estimates.csv` | Approximate local Antigravity IDE transcript estimates |
| `reports/antigravity-quota-*.json` | Optional third-party Antigravity quota snapshots |
| `reports/*.jsonl` | Raw Codex event streams from `codex exec --json` |

## Interpretation

- `InputTokens`: tokens sent to the model for that turn.
- `CachedInputTokens`: input tokens served from cache or reduced-rate cached context.
- `OutputTokens`: generated response tokens.
- `ReasoningOutputTokens`: reasoning tokens included in output accounting when reported.
- `TotalTokens`: `InputTokens + OutputTokens` in the local CSV.
- `EstimatedCredits`: approximate Codex credits based on the public rate card. Treat this as planning guidance, not billing truth.

