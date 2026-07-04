# Autonomous AI Architecture Research & Ideation

이 문서는 `Intergrated POWER` 워크스페이스를 세계 최고 수준의 완전 자율형 AI 소프트웨어 엔지니어로 고도화하기 위해 진행된 웹 리서치 및 Codex와의 브레인스토밍 대화 기록입니다.

---

## 1. 외부 오픈소스 및 산업 동향 리서치
**출처**: Main Agent (Antigravity) 웹 검색 결과 종합 (검색어: "open source autonomous AI software engineer" OR OpenDevin OR SWE-agent OR Devika)

글로벌 테크 업계와 오픈소스 생태계에서는 이미 단순한 코드 완성을 넘어 "엔드투엔드(End-to-End) 자율 코딩 에이전트"를 향한 치열한 경쟁이 벌어지고 있습니다.

### 대표적인 오픈소스 프로젝트
* **OpenHands (구 OpenDevin)**: Devin의 오픈소스 대안 중 가장 활발합니다. 샌드박스(Docker) 환경 내에서 브라우저, 터미널, 에디터를 AI가 자유롭게 조작하며 스케줄러 기반의 자율 루프를 돕니다.
* **SWE-agent (Princeton 대학교)**: GitHub 이슈 해결에 특화. AI가 터미널이나 에디터를 쉽게 다룰 수 있도록 `Agent-Computer Interface (ACI)`라는 전용 명령어 계층을 둡니다. (우리 시스템의 PowerShell 스크립트 기반 상태 감지와 유사)
* **Devika**: 거시적인 지시를 여러 개의 하위 태스크(Sub-tasks)로 쪼개어 차례대로 실행하는 데 강점이 있습니다. (우리 시스템의 `task_pipeline.json` 및 서브에이전트 모델과 유사)

### 산업계 접근법 (Multi-Agent System)
* **Cognition (Devin), Magic.dev, Poolside**: 1인 AI 개발자를 목표로 막대한 컨텍스트 윈도우와 로컬 환경 통제권을 가집니다.
* **CrewAI, AutoGen, MetaGPT**: 관리자(PM), 코더(Coder), 검수자(QA) 등으로 역할을 나눈 멀티 에이전트 스웜(Swarm) 아키텍처를 표준으로 사용합니다.

---

## 2. 최고 수준으로 도약하기 위한 3대 혁신 아키텍처
**출처**: Codex (MCP Tool) 와의 3회 왕복 브레인스토밍 (Turn 1 ~ Turn 3)

기존 오픈소스들이 가진 한계(얕은 인지력, 모호한 권한 통제, 약한 검증)를 극복하기 위해 Codex가 제안한 3가지 핵심 아키텍처입니다.

### 아이디어 1: 영구적 엔지니어링 지능 그래프 (Persistent Engineering Intelligence Graph)
* **제안자**: Codex (Turn 1, Turn 3)
* **개념**: 파일 크기나 줄 수의 변경(Diff Stat)만으로 얕게 스캔하는 것을 넘어, 로컬 GPU(3090)와 Python 워커를 통해 의미론적 지능 그래프를 구축합니다.
* **동작 방식**: 5분 스캐너는 빠르고 가볍게 Git 상태만 읽고, 변경이 감지되면 Python 스크립트가 트리거되어 코드 심볼 그래프, 테스트 커버리지 누락, 코드 임베딩을 추출하여 `state/codegraph.sqlite`와 `state/events.jsonl`에 기록합니다.
* **기대 효과**: "의존성이 높은 핵심 API가 수정되었는데 테스트 코드가 추가되지 않음"과 같은 고차원적인 지능적 조건에서만 오케스트레이터를 깨워 불필요한 토큰 낭비를 막고 문제 해결 능력을 극대화합니다.

### 아이디어 2: 정책 기반의 권한 임대 (Policy-As-Code Capability Leases)
* **제안자**: Codex (Turn 1, Turn 2)
* **개념**: 사람이 읽는 산문 형태의 `standing_orders.md`를 기계가 완벽히 통제할 수 있는 암호화된 JSON 티켓(Lease) 시스템으로 전환합니다.
* **동작 방식**: 백엔드나 무거운 DB 없이 `HMAC-SHA256` 서명을 활용한 단기 임대권(JSON)을 발급합니다.
  * 예: "이 서브에이전트는 향후 2시간 동안 `reports/` 폴더만 수정 가능하며 `git commit`은 거부됨."
* **기대 효과**: 모든 에이전트의 파일 접근 및 명령어 실행 권한이 완벽하게 통제되며 샌드박싱 수준의 안전성을 로컬 환경에서 확보할 수 있습니다.

### 아이디어 3: 적대적 검증자 스웜 (Adversarial Verifier Swarm)
* **제안자**: Codex (Turn 1, Turn 2)
* **개념**: 단일 에이전트의 구현 결과를 신뢰하지 않고, 구현 직후 곧바로 이를 공격하고 검증하는 읽기 전용 "적대적 에이전트"를 스폰합니다.
* **동작 방식**: `executing` 상태가 끝나면 `verifying` 상태로 진입하며, "당신의 임무는 이 코드가 얼마나 불안정하고 범위를 벗어났는지 증명하는 것입니다"라는 프롬프트를 가진 검증자 에이전트가 가동됩니다.
* **기대 효과**: 환각(Hallucination)으로 인한 잘못된 코드 작성을 내부 토너먼트를 통해 자가 교정(Self-Correction)하여 사람의 개입 없이도 코드 품질을 획기적으로 끌어올립니다.

---

## 3. 브레인스토밍 원문 기록 (Raw Transcript)

아래는 3회에 걸쳐 주고받은 Main Agent와 Codex 간의 대화 전문(프롬프트 및 응답 전체)입니다.

### [Turn 1] Main Agent -> Codex

**Main Agent (Prompt):**
```text
Hello Codex, I am the main agent orchestrating an autonomous AI software engineer workspace named 'Intergrated POWER'. 

Currently, we have a system that wakes up every 5 minutes (via a cron schedule), scans a target repository (using git diff --stat and parsing TODOs), and saves the snapshot to `last_scan_state.json`. It compares the new snapshot with the old one (`Compare-ScanState.ps1`). If changes are found, it looks at `standing_orders.md` to see if it has permission to execute the task autonomously. If yes, it creates a subagent to do the work. If no, it writes an `implementation_plan.md` for user approval. It tracks the state of tasks in `task_pipeline.json`.

We want to go beyond just building this. We want to mimic and SURPASS the best open source autonomous agents like OpenHands (OpenDevin), SWE-agent, and Devika. 

Can you analyze our current architecture and suggest 3 radical, advanced features or architectural changes we could implement to make our system superior to those existing tools? This is turn 1 of 3 for our brainstorming session.
```

**Codex (Response):**
```text
**Turn 1 Read**

Your current system is a good control-plane skeleton, but it is still mostly “scan, diff, prompt, delegate.” The biggest gaps are shallow perception, prose-only governance, and weak verification isolation.

I checked your local files plus current public baselines. OpenHands is now positioning itself as a self-hosted agent control center with multiple local/remote/cloud backends and scheduled/webhook automations ([source](https://raw.githubusercontent.com/OpenHands/OpenHands/main/README.md)). SWE-agent’s own repo now points users toward mini-SWE-agent, emphasizing simple linear trajectories, bash-only action, independent subprocess steps, and strong sandbox deployability ([source](https://raw.githubusercontent.com/SWE-agent/mini-swe-agent/main/README.md)). Devika remains ambitious but explicitly early/experimental with broken or unimplemented features ([source](https://raw.githubusercontent.com/stitionai/devika/main/README.md)).

**1. Build A Persistent Engineering Intelligence Graph**

Replace `last_scan_state.json` as the core memory with an event-sourced repo intelligence graph.

Right now [Compare-ScanState.ps1](<C:/Users/jsp0/Documents/Intergrated POWER/scripts/Compare-ScanState.ps1:30>) tracks TODO hashes, diff stat, and uncommitted count. That detects movement, but not meaning. A superior system should maintain:

- code symbol graph, ownership, dependencies, test coverage, recent churn
- TODOs, failing tests, flaky tests, CI signals, issues, docs drift
- semantic embeddings and local summaries from the 3090/4-way GPU path
- task candidates with impact, confidence, affected files, and evidence

The radical version: every 5-minute scan emits append-only events into `state/events.jsonl`, updates `state/codegraph.sqlite`, and writes `reports/scan-evidence-<timestamp>.md`. Agents no longer wake up because “diff stat changed”; they wake up because “a high-churn module lost test coverage and contains a TODO near a recently changed public API.”

This would beat the reference tools by giving Integrated POWER durable situational awareness, not just per-task agent execution.

**2. Replace Standing Orders With Policy-As-Code Capability Leases**

[standing_orders.md](<C:/Users/jsp0/Documents/Intergrated POWER/config/standing_orders.md:15>) is useful for humans, but too ambiguous for safe autonomy. Convert it into a machine-checkable autonomy kernel.

Each task should receive a signed “capability lease” before execution:

- allowed repo/path scope
- sandbox mode
- max runtime and token budget
- allowed tools/commands
- required artifact path
- rollback or stop condition
- approval tier and reason

Then [task_pipeline.json](<C:/Users/jsp0/Documents/Intergrated POWER/config/task_pipeline.json:2>) becomes authoritative rather than decorative. States become something like `detected -> scored -> policy_checked -> leased -> executing -> verifying -> accepted/rejected/quarantined`.

This is where you can surpass OpenHands-style automation: not by running more agents, but by making every autonomous action auditable, revocable, and explainable.

**3. Add A Verifier Swarm And Internal Agent Tournament**

Do not trust one implementation agent. Turn every meaningful task into a small adversarial workflow:

- implementer proposes patch or plan
- test agent writes or runs focused tests
- reviewer agent attacks the diff
- docs/API agent checks current docs when relevant
- Playwright/browser agent verifies UI when relevant
- judge agent accepts only evidence-backed work

Your current prompts already ask for artifacts and stop conditions in [integrated-window-dispatch.md](<C:/Users/jsp0/Documents/Intergrated POWER/prompts/integrated-window-dispatch.md:29>), but there is no enforced verifier layer. The advanced version stores trajectories, test outcomes, rejected patches, and model/tool performance. Over time, the orchestrator learns which agents/models are reliable for each task class.

This would combine mini-SWE-agent’s debuggable trajectories with OpenHands-style orchestration, but add something stronger: continuous local benchmarking and adversarial verification.

One important local finding: `config/projects.txt` currently points at `scripts\__temp_test_git_proj`, and `reports/current_context.md` contains that temp self-test project. That suggests test runs can pollute operational state. Before going fully autonomous, isolate test fixtures from live config and reports.

Confidence: medium-high. I inspected the local control files and scripts, but did not execute or modify anything in this read-only brainstorming turn.
```

---

### [Turn 2] Main Agent -> Codex

**Main Agent (Prompt):**
```text
This is Turn 2. In Turn 1, you suggested 3 ideas:
1. Build an Event-Sourced Persistent Engineering Intelligence Graph instead of just diff stats.
2. Replace static Standing Orders with dynamic Policy-As-Code Capability Leases.
3. Add a Verifier Swarm and Internal Agent Tournament for adversarial testing.

Those are excellent ideas. Let's drill down into Idea #2 (Policy-As-Code Capability Leases) and Idea #3 (Verifier Swarm). 
If we were to implement Idea #2, how would we practically implement a "signed capability lease" in our PowerShell + JSON environment without building a massive backend? 
And for Idea #3, what is the simplest way to orchestrate an "Adversarial Verifier" using our existing tools (e.g., our orchestrator running on cron, spinning up subagents)? 
Please provide actionable, low-overhead architectural patterns we can apply immediately.
```

**Codex (Response):**
```text
Use a file-backed pattern. No backend, no database, no service.

**Idea #2: Signed Capability Leases**

A capability lease should be a short-lived JSON authorization artifact that says:

> For this job, this runner may do these actions, in these paths, until this time, producing this artifact.

Treat it as a narrow replacement for broad Standing Orders.

Recommended files:

```text
config/capability_policies.json
config/lease_revocations.json
leases/
scripts/New-CapabilityLease.ps1
scripts/Test-CapabilityLease.ps1
scripts/Invoke-WithLease.ps1
reports/
```

A minimal lease envelope:

```json
{
  "payload_b64u": "base64url-of-canonical-json",
  "signature_alg": "HMAC-SHA256",
  "key_id": "local-orchestrator-v1",
  "signature_b64u": "base64url-signature"
}
```

Decoded payload:

```json
{
  "version": 1,
  "lease_id": "lease-JOB-002-20260625-1548",
  "job_id": "JOB-002",
  "issuer": "orchestrator",
  "subject": "codex-readonly-audit",
  "mode": "read-only",
  "issued_at": "2026-06-25T15:48:00+09:00",
  "expires_at": "2026-06-25T17:48:00+09:00",
  "repo_root": "C:\\Users\\jsp0\\Documents\\Intergrated POWER",
  "allowed_capabilities": [
    "repo.read",
    "reports.write",
    "tests.readonly.run"
  ],
  "allowed_paths": [
    "reports/JOB-002-test-gaps.md"
  ],
  "denied_capabilities": [
    "git.commit",
    "git.push",
    "credentials.read",
    "external_repo.write",
    "deployment.modify"
  ],
  "required_outputs": [
    "reports/JOB-002-test-gaps.md"
  ]
}
```

The important trick: sign `payload_b64u`, not a PowerShell object. That avoids fragile JSON canonicalization issues.

For v0, use HMAC-SHA256 with a local secret stored outside the repo, for example in a DPAPI-protected local file or user environment secret. This is not perfect non-repudiation, but it is enough to detect accidental or unauthorized lease edits in a single-machine orchestrator.

For stronger separation later, use a Windows CurrentUser certificate: private key signs leases, public cert verifies them. But HMAC is the fastest useful version.

Your policy file can be very simple:

```json
{
  "schema_version": "1.0",
  "capabilities": {
    "repo.read": {
      "auto": true
    },
    "reports.write": {
      "auto": true,
      "paths": ["reports/**"]
    },
    "docs.write": {
      "auto": true,
      "paths": ["docs/**/*.md"]
    },
    "scripts.write": {
      "auto": false,
      "requires_approval": true
    },
    "config.write": {
      "auto": false,
      "requires_approval": true
    },
    "git.commit": {
      "never": true
    },
    "git.push": {
      "never": true
    },
    "credentials.read": {
      "never": true
    }
  }
}
```

Then enforce leases only at orchestration boundaries:

```text
detected
  -> analyzing
  -> planned
  -> lease_issued
  -> executing
  -> verifying
  -> done
```

Do not try to sandbox every possible action at first. Make the lease gate answer three questions before launching a job:

1. Is this lease valid, unexpired, signed, and not revoked?
2. Does this job’s requested mode match the lease?
3. Are the expected outputs and touched paths inside the lease scope?

That gives you immediate value without pretending the lease is a hardened OS security boundary.

**Minimum useful scripts**

```text
New-CapabilityLease.ps1
```

Creates a lease from `capability_policies.json`, `task_pipeline.json`, job id, mode, and expected artifact.

```text
Test-CapabilityLease.ps1
```

Verifies signature, expiry, revocation, job id, repo root, allowed paths, denied capabilities.

```text
Invoke-WithLease.ps1
```

Wrapper used by the cron/orchestrator before calling Codex, Antigravity, tests, or verifier jobs.

The lease should be appended to the final report:

```md
## Capability Lease

- Lease: `leases/lease-JOB-002-20260625-1548.json`
- Mode: read-only
- Expires: 2026-06-25T17:48:00+09:00
- Allowed outputs: `reports/JOB-002-test-gaps.md`
```

That gives you traceability.

**Idea #3: Adversarial Verifier**

The simplest Verifier Swarm is not a true swarm. Start with one implementer and one adversarial read-only verifier.

After any write-capable job finishes, transition the task to `verifying` and spawn a separate read-only verification job with a hostile prompt.

Directory pattern:

```text
reports/verifier/JOB-001/
  implementation-report.md
  diff.patch
  verifier-breaker.md
  verifier-policy.md
  verifier-tests.md
  aggregate-verdict.json
```

Use three verifier roles only when the job is important:

```text
breaker
```

Find likely bugs, regressions, unsafe assumptions, edge cases.

```text
policy
```

Check lease compliance, touched files, forbidden actions, missing artifact, scope drift.

```text
tests
```

Check whether verification was meaningful; suggest or run safe tests if lease allows.

For low quota windows, run only `breaker`.

A practical verifier prompt:

```md
You are an adversarial verifier.

Mode:
- Read-only.
- Do not edit files.
- Do not fix the issue.
- Your job is to prove this change is unsafe, incomplete, out of scope, or insufficiently verified.

Inputs:
- Job ID: JOB-001
- Lease: leases/lease-JOB-001.json
- Implementation report: reports/JOB-001-implementation.md
- Diff: reports/verifier/JOB-001/diff.patch
- Task description: ai-work-queue.md

Return:
1. Verdict: PASS, WARN, or FAIL
2. Highest severity finding
3. Evidence with file paths
4. Missing tests or checks
5. Whether the implementation stayed inside the lease
6. Recommended next action
```

Then use a deterministic aggregator, not another creative agent, to decide the gate:

```json
{
  "job_id": "JOB-001",
  "verdict": "FAIL",
  "failed_roles": ["breaker"],
  "highest_severity": "high",
  "next_state": "planned",
  "required_action": "Fix findings before marking done"
}
```

Suggested gate rules:

```text
Any FAIL      -> task returns to planned or awaiting_approval
Any WARN      -> task may finish only if user accepts residual risk
All PASS      -> task moves to done
Policy FAIL   -> task is blocked until reviewed
Missing report -> automatic FAIL
Lease expired -> automatic FAIL
Touched forbidden path -> automatic FAIL
```

**Immediate v0 Implementation Pattern**

Do this in four small steps:

1. Add `config/capability_policies.json`.
2. Add lease creation and validation scripts.
3. Require every scheduled/cron job to carry a lease id.
4. Add one adversarial read-only verifier after write-capable jobs.

You do not need a backend. The filesystem is the ledger:

```text
config/                 policy
leases/                 active signed grants
reports/                outputs and verifier evidence
task_pipeline.json      state machine
config/lease_revocations.json  denylist
```

The key design rule: leases should authorize narrow execution; verifiers should attack completed work from outside the implementation context. That separation gives you most of the safety benefit with very little machinery.
```

---

### [Turn 3] Main Agent -> Codex

**Main Agent (Prompt):**
```text
This is Turn 3, our final exchange. Thank you for the detailed breakdown of the Capability Leases and Adversarial Verifier. Both of these rely on the file system as the ledger, which fits our architecture perfectly.

Let's discuss Idea #1: "Build A Persistent Engineering Intelligence Graph". You mentioned maintaining a code symbol graph, test coverage, and semantic embeddings/local summaries (via a 3090 GPU path) into `state/events.jsonl` and `state/codegraph.sqlite`. 

Given that our environment primarily uses PowerShell, Git, and local AI scripts, what is the most robust way to build and update this "Intelligence Graph" incrementally every 5 minutes without causing massive overhead? What specific tools or libraries should we use to extract semantic embeddings and code graphs locally? How do we map these signals to trigger the Orchestrator intelligently instead of just reacting to "diff stat changed"?
```

**Codex (Response):**
```text
Use a two-tier loop:

1. **Every 5 minutes:** cheap PowerShell/Git scanner.
2. **Only when needed:** Python graph worker for changed files/chunks.
3. **Only when signal score is high enough:** Orchestrator creates or updates a task candidate.

Do not make the 5-minute job run tests, call Codex, or summarize whole repos. It should update the ledger and produce ranked signals.

One important local note: [config/projects.txt](</c:/Users/jsp0/Documents/Intergrated POWER/config/projects.txt>) currently points at `scripts\__temp_test_git_proj`, which looks like stale self-test residue. Fix that before wiring this up.

**Recommended Shape**

Keep PowerShell as the control layer:

```powershell
scripts\Update-IntelligenceGraph.ps1
```

That script should:

- acquire a lock under `state/intelligence.lock`
- read [config/projects.txt](</c:/Users/jsp0/Documents/Intergrated POWER/config/projects.txt>)
- run cheap Git probes per repo:
  - `git status --porcelain=v1 -z`
  - `git diff --name-only`
  - `git ls-files -s`
  - `git diff --numstat`
- call a Python worker only for changed files
- append events to `state/events.jsonl`
- update `state/codegraph.sqlite`
- emit a compact `reports/intelligence_graph.md`
- emit machine-readable `state/graph_signals.json`

Use Windows Task Scheduler every 5 minutes, but set it to skip if the previous run is still active.

**Local Libraries**

For the Python worker, I would use:

| Need | Tool |
| --- | --- |
| File ignore rules | `pathspec` using `.gitignore` |
| Incremental metadata | built-in `sqlite3`, Git blob SHA, SHA256 for untracked files |
| Code parsing | `tree-sitter` + `tree-sitter-language-pack` |
| Python semantic help | `ast`, optionally `jedi` |
| TypeScript deeper graph | `ts-morph` or `typescript-language-server` as an optional secondary pass |
| Coverage ingestion | parse `coverage.py` JSON/XML, LCOV, Cobertura/OpenCover |
| Embeddings | `sentence-transformers` on the local 3090 |
| Default embedding model | `BAAI/bge-m3` for mixed code/docs/tasks |
| Code summaries | local Qwen Coder model via Ollama, llama.cpp, or vLLM |
| Vector storage | start with embeddings as BLOBs in SQLite; add `sqlite-vec` later if search volume requires it |

I would avoid a heavy vector DB at first. SQLite plus cached chunk hashes is enough until the graph has hundreds of thousands of chunks.

**SQLite Model**

`state/codegraph.sqlite` should be the materialized state:

```text
projects
files
symbols
symbol_edges
chunks
embeddings
coverage
test_links
signals
scan_runs
```

`state/events.jsonl` should be append-only history:

```json
{"ts":"...","kind":"symbol_changed","project":"...","file":"src/foo.ts","symbol":"FooService.save","old_hash":"...","new_hash":"..."}
```

The rule is simple: JSONL records what happened; SQLite records the latest queryable truth.

**Overhead Controls**

The 5-minute scan should have a hard budget, for example 60-90 seconds.

Use these gates:

- hash files before parsing
- hash symbol bodies before embedding
- embed only changed chunks
- batch embeddings, for example 64-256 chunks
- skip GPU work if `nvidia-smi` shows high utilization
- parse coverage artifacts, but do not run full test suites every 5 minutes
- run deeper repo-wide graph rebuilds hourly or nightly
- use cooldowns so the same signal does not wake the Orchestrator repeatedly

**Trigger The Orchestrator By Meaning, Not Diff Stat**

Create scored `task_candidate` signals. Examples:

| Signal | Trigger |
| --- | --- |
| `missing_tests_for_changed_symbol` | changed function/class has no mapped test or poor coverage |
| `high_blast_radius_change` | changed exported symbol has many dependents |
| `public_api_changed` | route, exported type, CLI command, config schema, or public method changed |
| `dependency_review_needed` | package/lock/import surface changed |
| `ui_verification_needed` | component, route, CSS, or browser-facing code changed |
| `docs_drift` | public behavior changed but docs near that area did not |
| `hotspot_low_coverage` | high churn file plus weak tests |
| `local_summary_needed` | large logs/issues/notes changed and are too noisy for Codex directly |

Then map signals to the existing flow:

- write/read-only reports under `reports/` automatically
- update [config/task_pipeline.json](</c:/Users/jsp0/Documents/Intergrated POWER/config/task_pipeline.json>) with `detected -> analyzing -> planned`
- route implementation or script/config changes to approval, matching [config/standing_orders.md](</c:/Users/jsp0/Documents/Intergrated POWER/config/standing_orders.md>)
- include `state/graph_signals.json` in [scripts/Invoke-AiWorkWindow.ps1](</c:/Users/jsp0/Documents/Intergrated POWER/scripts/Invoke-AiWorkWindow.ps1>) dispatch context

A practical scoring sketch:

```text
+30 changed exported symbol with fan-in > threshold
+25 changed code has no mapped tests
+25 related tests failing
+20 dependency/config/public API changed
+15 TODO/FIXME introduced near central code
+10 semantic match to risk domains: auth, billing, migration, security
-20 docs/comment-only change
```

Only enqueue when score crosses a threshold, and dedupe by `project + symbol/file + signal_kind`.

The key design point: the graph updater should never “do work.” It should observe, score, and persist evidence. The Orchestrator should decide whether that evidence becomes a report, a Codex read-only job, an Antigravity implementation plan, or nothing.
```
