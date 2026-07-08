Fix the bug in DashboardController.ts where errors are duplicated in the UI. 

Context:
In `readDashboardState()`, the `combinedSystemErrors` is constructed by combining `this.state.systemErrors`, `resolvedTokenStatus?.errors`, and `backgroundJobErrors`. 
Because the result is assigned back to `this.state.systemErrors` (via the returned state object in `refresh()`), the `backgroundJobErrors` and `tokenStatus.errors` are appended over and over again on every refresh, leading to infinite duplication.

Please fix this by deduplicating the `combinedSystemErrors` array. You can use `Array.from(new Set(combinedSystemErrors))` to eliminate duplicate error strings, ensuring the UI doesn't show the exact same error message multiple times.


Operational constraints:
- Edit only the files explicitly provided to aider for this run.
- Do not commit changes.
- Keep the patch minimal and directly related to the request.
