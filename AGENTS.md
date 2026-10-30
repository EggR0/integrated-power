# Integrated Power implementation contract

## Pre-Task Documentation Search (필수 선행 원칙)
모든 작업(코드 수정, 빌드, 배포, 릴리스, 리팩토링, 디버깅 등)을 시작하기 전, 에이전트는 반드시 `docs/` 디렉터리에 관련 명세서, 아키텍처 문서, 릴리스/배포 가이드가 이미 존재하는지 먼저 검색하고 숙지한 후 작업을 수행해야 한다.
- 예: 배포/릴리스 작업 시 `docs/distribution/release-and-deployment-guide.ko.md` 필수 확인 및 준수 (태그 생성, 릴리스 에셋 첨부 등 절차 생략 금지)
- 예: UI 수정 시 `docs/reference/compact-ui-overflow-prevention.ko.md` 필수 확인
- 기존 문서에 명시된 워크플로, 파이프라인, 설계 규칙을 임의로 생략하거나 다른 방식으로 우회하지 않는다.

This repository follows `docs/reference/multi-ai-broker.ko.md`,
`docs/reference/compact-ui-overflow-prevention.ko.md`, and the
Integrated Power plan. Before changing code, the implementation agent must
read that plan, this file, the relevant skill and references, the existing
VSIX scripts/configuration/tests, package manifests/lockfiles, and the dirty
worktree. A `docs/reuse-map.md` entry is required before a new module or
replacement is written.

Reuse order is mandatory: validated VSIX implementation, shared extraction,
official SDK or verified library, thin adapter, then new code only with an ADR
that records rejected candidates, compatibility/licence evidence, and a
regression test. Do not reset or delete existing user changes.

The authoritative local path is `Select-LocalLLMModel.ps1` followed by
`Invoke-LocalLLM.ps1`/`Invoke-vLLMJob.ps1`. Preserve qwen3.8:27b preference,
VRAM reservation, compute capability, CPU offload, install consent,
cold-load timeout, metrics, artifact coalescing, GPU index/UUID, and privacy
boundaries. Never silently restart a server on a different GPU.

Only the Luna High implementation agent writes production code. Agy and local
LLM runs are read-only review/test inputs unless an explicitly named worktree
and source paths are supplied. Completion requires runtime evidence, not
capability stubs or CI configuration alone. Merge, external transfer, budget
overage, model download, and server restart require user approval.

CI must fail when a reuse map is missing, a duplicate selector/transport/
executable finder is added, or dynamic `innerHTML` is introduced.

All webview and sidebar UI changes must follow `docs/reference/compact-ui-overflow-prevention.ko.md`
without exception: all controls must render cleanly under narrow widths (< 200px)
with zero horizontal overflow, no breaking multi-line labels, and mandatory
`test-compact-ui.js` regression verification.
