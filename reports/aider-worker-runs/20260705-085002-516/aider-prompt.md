Delete the scripts Invoke-AutonomousAgent.ps1 and Invoke-AntigravityCliJob.ps1. Modify Select-AgenticDelegationMode.ps1 to completely remove the AntigravityHigh fallback logic and references to Invoke-AntigravityCliJob. Modify vscode-extension\assets\codex-orchestrator-plugin\skills\codex-orchestrator\SKILL.md so that item 5 (Local Autonomous Loop) points to scripts/dispatch/Invoke-DelegatedAgentTask.ps1 instead of scripts/Invoke-AutonomousAgent.ps1.

Operational constraints:
- Edit only the files explicitly provided to aider for this run.
- Do not commit changes.
- Keep the patch minimal and directly related to the request.
