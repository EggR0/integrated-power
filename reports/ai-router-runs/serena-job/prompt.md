Create `scripts/dispatch/Invoke-SerenaBackgroundJob.ps1` implementing Phase 2 and Phase 3 of `reports/serena-background-local-llm-design-2026-07-05.md`.

The script should:
1. Use `serena project index` to get the structure.
2. Since we don't have a complex lock or git comparison yet, implement a simplified "One-Shot" version that just:
   - Queries `serena project health-check`
   - Runs `serena project index` (this indexes the project).
   - We need raw observations. If `serena project index` just populates the cache, maybe we can run `serena context export` or similar to get a summary? Look at the available serena CLI commands. (For this implementation, let's just create a dummy "serena-observations.json" or use `serena context` or `serena print-system-prompt` output as the observation).
   - Use `scripts/dispatch/Invoke-LocalLLM.ps1` (or directly query the local LLM via `ollama run qwen2.5-coder:32b`) to summarize the observations into `reports/serena-background/repo-map.md`.
3. Save the result to `reports/serena-background/repo-map.md`.
4. Ensure the output directory `reports/serena-background/runs/` exists.

Please implement a basic functional version that invokes Serena, captures output, and uses the local LLM to write the summary.
