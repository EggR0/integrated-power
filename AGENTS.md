# Integrated Power implementation contract

This repository follows `docs/reference/multi-ai-broker.ko.md` and the
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
`Invoke-LocalLLM.ps1`/`Invoke-vLLMJob.ps1`. Preserve qwen3.6:27b preference,
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
