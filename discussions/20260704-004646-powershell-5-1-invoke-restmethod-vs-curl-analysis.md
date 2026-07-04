# Durable ADR Debate: powershell-5-1-invoke-restmethod-vs-curl-analysis

---
## Turn 2026-07-04 00:46:46 +09:00
<!-- turn_id: 20260704-004646-108-9599a100-adc2-4e8e-95a6-b2f7294bc9e3 -->
### Status
<!-- status:20260704-004646-108-9599a100-adc2-4e8e-95a6-b2f7294bc9e3 -->
Completed
<!-- /status:20260704-004646-108-9599a100-adc2-4e8e-95a6-b2f7294bc9e3 -->

### Main Agent Prompt
````md
ADR Topic:
PowerShell 5.1 Invoke-RestMethod vs Curl analysis

Prompt file:
We recently encountered a bug in the script `scripts/dispatch/Invoke-LocalLLM.ps1` where `Invoke-RestMethod` hung indefinitely when sending a POST request to a local Ollama server, whereas `curl.exe` with a temporary JSON file succeeded instantly. Additionally, we found that writing the JSON payload using `Out-File -Encoding UTF8` in PowerShell 5.1 caused a JSON parsing error in Ollama (`invalid character 'ï' looking for beginning of value`) because of the UTF-8 BOM, which we fixed by using `[System.IO.File]::WriteAllText`.

Please analyze the file `scripts/dispatch/Invoke-LocalLLM.ps1` (provided in `-ContextFile`) and explain from a systems and PowerShell/Windows architecture perspective:
1. Why did `Invoke-RestMethod` hang in PowerShell 5.1 when sending a POST request to Ollama? (Consider connection keep-alive, chunked transfer encoding, buffering, or HTTP version defaults in .NET Framework / WinINet).
2. Why did `curl.exe` with `Out-File -Encoding UTF8` write a BOM, and why does Ollama reject it?
3. Confirm that our fix of using `curl.exe` with `[System.IO.File]::WriteAllText` is a solid and robust solution.

Write a clean, structured, and deep technical report.

When you are completely finished with all work, output exactly the phrase `CODEX_JOB_DONE status=success` at the very end of your response.




# Attached Context Files:
(Codex, use your sandbox read permissions to directly read and analyze these files. Do NOT ask me to output them.)


- c:\Users\jsp0\Documents\Intergrated POWER\scripts\dispatch\Invoke-LocalLLM.ps1

````
### Codex Response
## Context

`scripts/dispatch/Invoke-LocalLLM.ps1` calls a local Ollama API at `http://localhost:11434`. It still uses `Invoke-RestMethod` for the lightweight `GET /api/version` health check, but the generation call is routed through `curl.exe`:

```powershell
$curlOutput = curl.exe -s -X POST "$ollamaUrl/api/generate" -d "@$tempJsonFile" -H "Content-Type: application/json"
```

The historical failure was specific to the POST body sent to `/api/generate`: `Invoke-RestMethod` in Windows PowerShell 5.1 hung, while `curl.exe` succeeded. A second failure came from writing the temporary JSON file with:

```powershell
$body | Out-File -FilePath $tempJsonFile -Encoding UTF8
```

On Windows PowerShell 5.1, that writes UTF-8 with a BOM. Ollama then rejected the payload with:

```text
invalid character 'ï' looking for beginning of value
```

## Decision

Use `curl.exe` for the Ollama POST request and write the temporary request body with a BOM-less .NET file write, for example:

```powershell
[System.IO.File]::WriteAllText($tempJsonFile, $body, [System.Text.UTF8Encoding]::new($false))
```

or, on older syntax-compatible PowerShell 5.1 code:

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tempJsonFile, $body, $utf8NoBom)
```

This is a solid fix for PowerShell 5.1 on Windows because it avoids both the legacy HTTP client behavior of `Invoke-RestMethod` and the BOM-producing behavior of `Out-File -Encoding UTF8`.

## Options

### Option A: `Invoke-RestMethod` POST directly

A typical direct implementation would be:

```powershell
Invoke-RestMethod `
  -Uri "$ollamaUrl/api/generate" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

This is clean in modern PowerShell, but in Windows PowerShell 5.1 it sits on the older .NET Framework HTTP stack. That matters.

Windows PowerShell 5.1 uses .NET Framework `HttpWebRequest` / `WebRequest` behavior rather than the newer `HttpClient` stack used by modern PowerShell 7+. That older path has several behaviors that can interact badly with local HTTP servers:

- HTTP/1.1 persistent connections are enabled by default.
- Connection pooling is managed through .NET `ServicePoint`.
- `Expect: 100-continue` behavior may be involved for POST requests unless disabled globally or per request.
- Request buffering and request stream handling can differ depending on body type.
- Chunked transfer may be used in some request paths when the client does not precompute or assign a fixed `Content-Length`.
- Response parsing waits for the full response body before returning the deserialized object.

For a local Ollama generation request, that means `Invoke-RestMethod` can block at several layers: waiting to send the body, waiting for the server to finish reading the body, waiting for a response terminator, or waiting for the full JSON response before deserialization.

The most plausible architecture-level explanation is not that Ollama itself needs special handling, but that the Windows PowerShell 5.1 HTTP client and Ollama’s Go HTTP server disagreed about request/response framing or connection lifecycle. Common failure modes include:

- Client sends or expects HTTP/1.1 keep-alive semantics, while the server waits for a definite end-of-body condition.
- Client sends a chunked request body or uses buffering behavior that the server path does not handle as expected.
- Client waits for `100 Continue` or otherwise delays body transmission.
- Client keeps the connection open and waits for a response framing condition that never arrives from its perspective.
- `Invoke-RestMethod` waits to fully buffer and JSON-parse the response before returning, so any ambiguity in stream completion appears as a hang.

Even if the server is local and healthy, this kind of mismatch can look like an indefinite hang because there is no process crash, no TCP connection refusal, and no immediate HTTP error.

### Option B: `Invoke-WebRequest` or `Invoke-RestMethod` with mitigations

Possible mitigations would include:

```powershell
Invoke-RestMethod `
  -Uri "$ollamaUrl/api/generate" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $body `
  -TimeoutSec 300 `
  -DisableKeepAlive
```

Potential global mitigations:

```powershell
[System.Net.ServicePointManager]::Expect100Continue = $false
```

These may work, but they are less robust because they still depend on the legacy .NET Framework client stack and PowerShell 5.1’s body encoding/framing behavior. They also introduce global process-level HTTP behavior if `ServicePointManager` settings are changed.

This option is acceptable for controlled scripts, but it is not the strongest choice when the known-good path is already available through `curl.exe`.

### Option C: `curl.exe` with a temporary JSON file

This sends a concrete byte stream from a file:

```powershell
curl.exe -s -X POST "$ollamaUrl/api/generate" `
  -d "@$tempJsonFile" `
  -H "Content-Type: application/json"
```

This has several practical advantages:

- `curl.exe` uses libcurl, not .NET Framework `HttpWebRequest`.
- `curl -d @file` sends a fixed request body with predictable framing.
- The payload bytes are exactly the file bytes.
- The command is easy to reproduce outside PowerShell.
- It avoids PowerShell object serialization and request-body conversion edge cases.
- It avoids Windows PowerShell 5.1’s legacy HTTP behavior for the critical long-running POST.

This is the best option for this repository’s current script, provided the temp file is written as UTF-8 without BOM.

## Constraints

Windows PowerShell 5.1 has different defaults from PowerShell 7+.

The most important difference for the JSON file bug is this:

```powershell
Out-File -Encoding UTF8
```

In Windows PowerShell 5.1, `UTF8` means UTF-8 with BOM. The first three bytes of the file are:

```text
EF BB BF
```

When those bytes are interpreted incorrectly, they appear as the visible characters:

```text
ï»¿
```

Ollama’s JSON parser expects the first significant byte of a JSON document to be something like `{`, `[`, `"`, a digit, or a valid JSON literal start. Instead, it sees the UTF-8 BOM bytes before the `{`.

JSON parsers vary in whether they tolerate a UTF-8 BOM. Ollama’s parser rejected it, producing:

```text
invalid character 'ï' looking for beginning of value
```

That error is consistent with a BOM at the beginning of the request body being decoded or surfaced as `ï»¿` before JSON parsing.

PowerShell 7 changed many encoding defaults and provides better BOM-less UTF-8 behavior. But this repository is explicitly dealing with Windows PowerShell 5.1 compatibility, so relying on `Out-File -Encoding UTF8` is unsafe.

## Risks

The current context file still shows:

```powershell
$body | Out-File -FilePath $tempJsonFile -Encoding UTF8
```

If that is the live version, the BOM bug is not actually fixed in this file yet. The robust implementation should replace that line with a BOM-less write.

There is also a smaller cleanup risk: the temp file is removed after `curl.exe` succeeds. If `curl.exe` throws or returns unusable output before `Remove-Item`, the temp file may be left behind. That is usually minor, but a `finally` block would be cleaner.

Another practical risk is that `curl.exe` can refer to different commands depending on shell context. In Windows PowerShell, `curl` alone aliases to `Invoke-WebRequest`, but `curl.exe` explicitly calls the native executable. The script correctly uses `curl.exe`, which avoids that alias trap.

Finally, `curl.exe -s` suppresses progress and most diagnostics. If debugging failures matters, consider `-sS` instead of `-s` so curl still prints errors:

```powershell
curl.exe -sS -X POST ...
```

## Recommendation

Keep `Invoke-RestMethod` for the simple `GET /api/version` health check. That call is small, bounded by `-TimeoutSec 2`, and does not involve a large JSON POST body.

For `/api/generate`, keep using `curl.exe` because it avoids the Windows PowerShell 5.1/.NET Framework HTTP edge cases around keep-alive, buffering, chunked transfer, `Expect: 100-continue`, and full-response buffering.

Replace the temp JSON write with an explicit BOM-less UTF-8 write:

```powershell
$tempJsonFile = [System.IO.Path]::GetTempFileName()
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tempJsonFile, $body, $utf8NoBom)

try {
    $curlOutput = curl.exe -sS -X POST "$ollamaUrl/api/generate" -d "@$tempJsonFile" -H "Content-Type: application/json"
    $response = $curlOutput | ConvertFrom-Json
}
finally {
    Remove-Item $tempJsonFile -ErrorAction SilentlyContinue
}
```

This is the most robust PowerShell 5.1-compatible solution: `curl.exe` provides predictable HTTP behavior, and `[System.IO.File]::WriteAllText` with `UTF8Encoding($false)` provides predictable JSON bytes.

CODEX_JOB_DONE status=success

### Turn Metadata
- Status: Completed
- Mode: NativeCli
- Protocol: durable-adr-v1
- Model: gpt-5.5
- Reasoning effort: high
- Sandbox: read-only
- Turn ID: 20260704-004646-108-9599a100-adc2-4e8e-95a6-b2f7294bc9e3
- Raw stdout log: C:\Users\jsp0\Documents\Intergrated POWER\.system_generated\codex-debate\20260704-004646-108-9599a100-adc2-4e8e-95a6-b2f7294bc9e3\stdout.log
- Raw stderr log: C:\Users\jsp0\Documents\Intergrated POWER\.system_generated\codex-debate\20260704-004646-108-9599a100-adc2-4e8e-95a6-b2f7294bc9e3\stderr.log
- Run manifest: C:\Users\jsp0\Documents\Intergrated POWER\.system_generated\codex-debate\20260704-004646-108-9599a100-adc2-4e8e-95a6-b2f7294bc9e3\run-manifest.json
