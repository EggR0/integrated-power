# Antigravity CLI Fatal Analysis - 2026-07-03

## Summary

The `fatal`/uncaught error observed after `antigravity-ide.cmd --install-extension ... --force` does not currently indicate that the dashboard VSIX failed to install. The install completes and the extension is registered afterward.

The most likely cause is an Antigravity IDE CLI bug in the post-install event/analytics path.

## Evidence

- Command target:
  - `C:\Users\jsp0\Documents\Intergrated POWER\vscode-extension\antigravity-ide-dashboard-0.1.0.vsix`
- Latest detailed CLI log:
  - `C:\Users\jsp0\AppData\Roaming\Antigravity IDE\logs\20260703T192444\cli.log`
- Installed extension path:
  - `C:\Users\jsp0\.antigravity-ide\extensions\integratedpower.antigravity-ide-dashboard-0.1.0`
- Extension list verification:
  - `integratedpower.antigravity-ide-dashboard@0.1.0`

The relevant log order is:

1. `Installing extension: integratedpower.antigravity-ide-dashboard`
2. `Deleted existing extension from disk ...`
3. `Extracted extension ...`
4. `Renamed to ...`
5. `Extension installed successfully: integratedpower.antigravity-ide-dashboard ...`
6. `[uncaught exception in CLI]: Cannot read properties of undefined (reading 'fireEvent')`

The stack is inside Antigravity IDE's CLI bundle:

- `resources/app/out/vs/code/node/cliProcessMain.js`
- `Kf.installExtensions`
- `Kf.install`
- `installVSIX`

The normal `--list-extensions --show-versions` command also emits:

- `[createInstance] extensionManagementService depends on antigravityAnalytics which is NOT registered.`

That message matches the failing symbol: the install service appears to try to call `fireEvent` on an analytics/event dependency that is missing in the CLI process.

## Repetition

The same pattern appears in multiple install logs:

- `20260703T192444`
- `20260703T191428`
- `20260703T191159`
- `20260703T191045`
- `20260703T190852`
- `20260629T180223`
- `20260629T175824`

All matching logs show `Extension installed successfully` before the `fireEvent` exception.

## Current Interpretation

Confidence: high.

This is probably not extension activation code crashing, because the stack is in the CLI installer path and the extension is listed as installed afterward.

This is probably not a failed extraction or malformed VSIX, because the extension directory exists, `package.json` is present, and the extension is registered in:

- `C:\Users\jsp0\.antigravity-ide\extensions\extensions.json`

The lower-level `FATAL ERROR: v8::ToLocalChecked Empty MaybeLocal` seen at the terminal is likely a secondary Node/Electron process crash after the uncaught JavaScript exception, not the primary semantic cause.

## Impact

- The VSIX install appears to succeed.
- The CLI process exits noisily and should not be treated as clean automation.
- Re-running install commands during development may create scary terminal output even when the extension is actually updated.

## Recommended Handling

1. Do not use `antigravity-ide.cmd --install-extension` as a routine smoke-test signal.
2. Treat the reliable success check as:
   - extension appears in `--list-extensions --show-versions`
   - installed directory exists under `C:\Users\jsp0\.antigravity-ide\extensions\...`
   - Antigravity IDE loads the dashboard view
3. Use headless project tests for the normal development loop:
   - `npm test`
4. Use the Antigravity CLI install command only for final packaging/install checks, and expect the post-install CLI crash until Antigravity fixes the missing analytics/event dependency.

