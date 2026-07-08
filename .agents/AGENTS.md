# Workspace AI Workflow Rules

## Structural Relationship: Skills, MCP, and Codex

- **No Repo-Wide Raw MCP Reads**: Antigravity MUST NOT ask MCP to bulk-read the whole codebase, broad directories, or large sets of files for general understanding.
- **Direct MCP Limit (Max 10 Files)**: Antigravity may directly use MCP for targeted reads only when the task is local, concrete, and the selected context is 10 files or fewer.
- **Skill Required for Architectural or Ambiguous Work**: If the task involves architecture, debate, feature design, cross-module behavior, or unclear ownership, Antigravity MUST invoke the relevant Skill, especially `codex-transparent-debate` for Codex review.
- **Codex Context Limit**: Codex receives curated paths, not bulk contents, and NEVER more than 10 files at once. Larger investigations must be decomposed into stages.
- **Artifact Generation**: Every delegation must produce an artifact (discussion file, report, checklist, or direct file change summary) to prevent useful reasoning from existing only inside transient agent context.
- **MCP is a Retrieval Primitive, not an Orchestrator**: MCP answers "get this precise thing". Skills answer "run this workflow". Codex answers "reason over this bounded context or perform this bounded implementation".
- **Invoke Entrypoints**: For Codex CLI jobs use `scripts/dispatch/Invoke-CodexJob.ps1`; for repository file-writing local worker jobs use `scripts/dispatch/Invoke-DelegatedAgentTask.ps1 -WorkerBackend Auto`; for local OpenAI-compatible vLLM preprocessing jobs use `scripts/dispatch/Invoke-vLLMJob.ps1`.

## Autonomous Local-Ecosystem & Cloud Intervention Thresholds (The 3 Interrupts)

To prevent the "Eager Assistant Anti-Pattern" where Antigravity wastes expensive cloud tokens orchestrating trivial tasks, Antigravity MUST NOT micromanage the local multi-agent loop. 

1. **Local-Driven Ecosystem**: File-writing coding tasks should be delegated through `scripts/dispatch/Invoke-DelegatedAgentTask.ps1 -WorkerBackend Auto` when the target files are explicit. Small local models handle preprocessing (reading, summarizing), while the local agentic worker can route real edits through Aider/local Ollama with validation and rollback.
2. **Strict Non-Intervention**: Antigravity must step back and remain entirely passive while the local loop executes. Do NOT repeatedly poll, read files, or generate intermediate prompts for the local models.
3. **The 3 Intervention Thresholds (Interrupts)**: Antigravity may ONLY intervene, halt the local loop, and review the structure if one of the following thresholds is triggered:
   - **Event-Driven**: The local loop has successfully completed all milestones, or has encountered a fatal, unrecoverable error (e.g., failing a local 3-retry validation loop).
   - **Resource-Bound**: The local loop exhausts its allocated token budget or Time-to-Live (TTL) limit.
   - **Scope-Bound**: The local loop attempts to modify core architectural files (e.g., `main.ps1`) or introduces new system dependencies/libraries that require human or cloud-level architectural approval.
4. **Verifiability of Cloud Token Savings**: Whenever Antigravity intervenes or concludes a task, it must ensure that the local ecosystem logged the selected backend, elapsed time, local resource risk, model downshift risk, and estimated cloud-token conservation in the `reports/` directory or `dashboard-state.json`. Do not describe local model usage as "local token cost"; local costs are time, electricity, VRAM/RAM occupancy, and context overflow risk.

# AI Workflow Project Rules (Merged from root AGENTS.md)

This repository is the control workspace for managing AI-assisted coding work across Antigravity IDE, Codex, MCP servers, and local GPU preprocessing.

## Operating Principles

- Treat Antigravity IDE as the hands-on coding surface where the user reviews diffs and accepts changes.
- Treat Codex as a delegated worker for bounded implementation, review, debugging, and test-generation tasks.
- Prefer worktrees, branches, or read-only analysis for automated or scheduled jobs.
- Do not modify external repositories, global configuration, credentials, or deployment targets unless the user explicitly asks for that exact action.
- Keep token use intentional: pick queued work that matches the current remaining quota window instead of trying to consume quota for its own sake.
- Always produce an artifact for delegated work: a report, patch summary, test result, or checklist with file paths.

## Verification Expectations

- For code changes, run the relevant tests or explain exactly why they could not be run.
- For UI work, capture or request a browser verification step.
- For read-only audits, include evidence: file paths, commands inspected, and confidence level.
- For automated jobs, write outputs under `reports/` unless the user asks for another destination.

## AI Communication & Skill Priority

- **Startup Awareness**: At the start of any conversation, recognize that you have active access to the Codex model and a local vLLM server. You can freely initiate debates, code reviews, or architectural planning with them.
- **Skill over MCP**: When the user asks to brainstorm, debate, or review code with Codex, **DO NOT** use the raw `codex` MCP tool by default. You MUST use the `ai-delegation` skill. This leaves a visible Markdown trace in `discussions/` so the user can follow along transparently.
- **vLLM Integration**: For offline preprocessing, summarization, or local model execution, use `scripts/dispatch/Invoke-vLLMJob.ps1` to invoke the OpenAI-compatible local endpoint.
- **Feature Implementation Rule (CCW v3)**: For new features or ambiguous structural changes, initiate the `ai-delegation` workflow (`scripts/dispatch/Invoke-CodexDebate.ps1`). Pass relevant repository paths via `-ContextFile` (do NOT embed file contents). In the initial debate turn, instruct Codex to focus on architectural review without generating full code. Once consensus is reached, implement the feature.
- **Codex Delegation & Code Generation Judgment**: Do not permanently restrict Codex from writing code. Antigravity MUST use its own judgment to determine when Codex should generate full code:
  1. **Post-Debate Implementation**: After consensus, Antigravity can delegate heavy coding tasks to Codex.
  2. **Direct Delegation (Heavy)**: If a task requires writing large boilerplate, massive refactoring, or extensive test generation, Antigravity may bypass the "No Code" debate and instruct Codex to write the full code immediately.
  3. **FastTrack (Trivial)**: For obvious bug fixes or single-file edits, bypass CCW and implement directly or ask Codex for the patch.
  Always balance token economy with the necessity of Codex's raw coding power.
- **Main Agent Token Conservation (50/50 Balance)**: Antigravity MUST aggressively conserve its own output tokens. Do not write lengthy conversational replies or summaries to the user. Shift the heavy generation burden to Codex.
- **Zero-Token Direct Edit Protocol (Codex Implementation)**: To achieve absolute zero output token consumption during heavy implementation, instruct Codex to **directly overwrite target files using its own write permissions** (e.g., via `Invoke-CodexJob.ps1`). You must ensure strict file-level boundaries (e.g., "Antigravity edits backend files, Codex edits frontend files") to prevent overlapping write conflicts. Do NOT ask Codex to output code blocks into the discussion file if the goal is final implementation; tell it to modify the files directly. Use `scripts/util/Extract-CodeBlock.ps1` ONLY as a safe fallback if Codex accidentally prints code instead of writing it.

------
## 사용자 요구사항 (User Requirements)

빠뜨리지 않고 점검해야 하는 세부사항:

1. ai-delegation (구 codex-orchestrator)라는 명칭, 안티그래비티 ide의 스킬에 기재된 방식 때문에 orchestration을 진행하는 모델이 자꾸 codex에게만 작업을 위임하는 문제 방지.
2. serena의 구현과 .md 파일에 명시하기.
3. 현재 로컬 llm, codex들은 백그라운드 터미널에서 작동하도록 되어있으며, 파일을 직접 읽게는 하지만, 출력은 특정한 파일에 작성하라고 함. 이 경우 orchestrator가 다시 그 파일들의 내용을 입력 받아야 하거나, 특정 파일의 출력 내용을 두 번 중복으로 출력하게 됨. (설명용 출력.md, 실제 파일) 이런 비효율적인 구조가 왜 내재하는지 판단. -> **해결됨: Direct Edit Only 룰 적용**
4. 확장 프로그램과 터미널ps1 코드로 구현하는 이유는, 다른 환경에서도 이식 가능하게하기 위해서 .js나 터미널 명령을 이용하는 것. 그런데 이 중점적인 사항(최대한 간단하고 이식 가능하게, 파일 경로와 절차를 어지럽히지 않게)이 자꾸 구현에서 누락됨. 아래는 대표적인 문제들
- codex나 로컬 llm과 작업한 내용들을 로컬 작업 경로에 남김, 너무 많은 폴더, 파일들이 생기므로 repository를 어지럽힘.
  >해결 방법: 이미 안티그래비티 ide의 작업 방식과 경로(아마도 brain)를 찾아서, 그 곳에 기록을 남기게 함.
- 작업의 경로가 섞이는 문제. 이전의 대화 기록을 orchestrator인 "너"가 안티그래비티 ide의 모델이 인식하는 문제가 있음.
- Gemini.md와 agents.md 파일이 중복 생성되어 안티그래비티 ide에 인식되는 문제. -> **해결됨: 루트 AGENTS.md 제거 및 병합**
- 중복된 기능 개발과 정리의 부재. 사용자의 기억이 불완전하다는 것을 알고 개발한 도구가 있으면 좋겠음 (Serena 등을 통해 머메이드 차트로 시각화하는 방안 등).

원하는 새로운 구현 사항.
1. codex나 로컬 llm과 작업하기 위해 skill md 파일을 "너(안티그래비티 ide 내장 모델)"에게 읽게 하고, 
2. 확장 프로그램을 설치할 때 skill이 제대로 등록되는지, 파워쉘 스크립트 등 내장되어야 할 파일들이 제대로 내장되는지 여부가 중요함. 그리고 이식성을 검토해서 다른 플랫폼 예) codex, cursor, vsc(내장 기본 모델이 없는데 어떻게:?), agy(안티그래비티 cli), claude code, 클로드, 안티그래비티(ide와 다름) 또는 다른 os 예) mac, linux, 안드로이드, iphone 등에 이식할 수 있는지 판단해야 함.
-----
