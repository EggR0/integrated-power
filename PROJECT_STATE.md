# PROJECT_STATE

Updated: 2026-10-13

## Desktop ↔ IDE integration checkpoint

Backend, desktop and IDE integration, including the user-requested per-model
prewarm buttons and five-hour/weekly gauge divisions, passed isolated runtime
and package verification. The current VSIX and NSIS installer hashes are recorded
below. Shared quota settings/prewarm arbitration and headless telemetry are
implemented in the broker. Installed-version activation still awaits explicit
user approval; no installer was activated.

### Implemented in this checkpoint

- Extracted existing VSIX run normalization/artifact and CSV behavior into
  `shared/telemetry/runState.js`; `RunStore.ts` is the VS Code filesystem adapter.
- Added canonical workspace APIs: `/v1/workspaces`, scoped `/v1/runs`, and
  `/v1/metrics/local-llm`; response compatibility retains top-level `runs` /
  `activeCount` and `metrics` with additive status/error/source fields.
- Added schema/capability metadata to `/health`; incompatible old broker hosts
  remain running and are reported rather than replaced.
- Added typed `BrokerClient` for workspace, run/metric, task, approval, and
  workspace-scoped task detail/event operations. Task events do not currently
  define an artifact-reference contract; artifact IDs come from canonical run
  records and still pass the IDE's `openArtifact` path safety checks.
- New broker ledger uses canonical state root. Existing encrypted JSONL ledger
  migration decrypts with the source key and re-encrypts with the canonical key;
  source is preserved, corrupt keys/data fail explicitly, and divergent history
  is left unchanged for user review. Test key stores are injected in-memory.
- `out/broker/broker-manifest.json` is generated after compile. Its digest is
  sorted broker `.js` files (including the explicit `shared-quota.js` bundle
  and browser ESM `shared-quota-browser.js` bundles built from the existing
  shared settings normalizer) encoded as POSIX relative
  path + NUL + exact bytes, hashed with SHA-256. The manifest is adjacent to
  the entrypoint and records broker version, schema, capabilities, asset root,
  entrypoint and digest. Packaged cold-start passed with source trees absent.
- Added canonical `/v1/settings/quota` revisioned persistence around the
  existing shared normalizer, retaining the IDE master notification switch,
  all eight per-window flags, three prewarm modes and polling interval.
- Added server-owned prewarm arbitration for the existing `/v1/tokens/prewarm`
  route and legacy alias. A two-request same-window HTTP test dispatches once;
  Once resets only after successful process spawn, failed dispatch retains the
  setting, and results do not claim timer confirmation. A separate isolated
  loopback test arms Once and verifies the broker scheduler dispatches it with
  no IDE client connected.
- Headless broker telemetry now consumes the existing TokenManager quota path
  through an injected noninteractive host, honors explicit canonical state
  roots, keeps the manager/cache scoped by resource/state root, and preserves
  source measurement times rather than making cached status appear fresh.
- Workspace, run, metric, and scoped task APIs now resolve against the
  `startBrokerServer({ stateRoot })` authority even when the process-global
  root differs; the HTTP regression intentionally sets a conflicting process
  root and verifies state continuity through the selected root.
- Approval action tokens now use the task revision after the approval-request
  event, while `requestedRevision` remains available for audit. HTTP regression
  exercises create → delegate → approval queue → approve with the queue's
  `expectedRevision`. Root reproduced the prior failure through the real UI
  (task revision 4 at delegation; approval request advanced it to 5 while the
  actionable token remained 4); the IDE UI regression now verifies approval
  succeeds from the queue token and a later intervening task update remains a
  409 conflict.
- Forced token refresh now reports `forced: true` only after the registered
  refresh hook succeeds. Cached token data retains its original `lastSync`;
  reading it no longer fabricates a current timestamp.
- Desktop packaging can now build from an explicit `INTEGRATED_POWER_BROKER_PACKAGE`
  without locating the VSIX source tree. The package carries a browser ESM
  shared-quota bundle for Vite, while the Node bundle remains the broker's
  runtime authority. A clean-source-override build of the packaged broker and
  frontend passed.
- `/v1/tokens/status` honors the injected `tokenStatusReader` test seam for
  ordinary and forced reads. A forced HTTP request with the fake reader returns
  its fixture without calling the IDE refresh hook or the production scanner.
- Mirrored the enhanced workspace/settings/prewarm/notification UI into the
  standalone desktop while retaining its provider read-only explanation. Both
  desktop copies now have narrow-width rules for one-column stats, stacked
  controls, wrapping labels/status tags and settings code.
- Added `control-center/scripts/test-desktop-compact-ui.js`, which uses a fake
  ephemeral loopback broker and Chromium to measure all six tabs at 199, 160,
  and 120 pixels. Every visible element, control, page scroll width, and clipped
  control is checked; no model or live broker endpoint is used.
- Portable broker assets include both the Node shared-quota bundle and a browser
  ESM shared-quota bundle. Launcher asset configuration adds package-local
  `node_modules` before loading the broker, so cold packaged starts do not need
  the VSIX source tree.
- The VSIX build emits `out/shared-quota.js` alongside bundled
  `out/extension.js` because the compiled settings store loads the existing
  pure quota normalizer at runtime. `.vscodeignore` includes this dependency
  explicitly and keeps the package smoke-test harness out of the installed
  extension.
- Both desktop launcher builds now use identical broker package manifests and
  digest `2ef46d7c28a48065e2ea5d1e1c44b62dc3837d56e10558ff5e28a3c923c84e50`.
  Packaging helpers, source-independent Vite resolution, verification scripts,
  canonical launcher test, UI assets and the compact UI test are mirrored into
  the standalone checkout. The Tauri launcher explicitly pins its child process
  to the UI/CSP canonical port 37241, ignoring inherited test-port overrides.

### Verification

- TDD RED evidence: missing shared parser, missing `/health` schema, missing
  `BrokerClient`, false-success force refresh, and missing manifest/task-detail
  API tests failed before their corresponding implementations.
- Unpacked VSIX activation smoke passed with a mock VS Code host, test-only
  in-memory Credential Manager, isolated profile/state and ephemeral port. It
  loaded `out/extension.js`, started the packaged broker, read quota settings,
  created a task and confirmed it through the broker read API.
- GREEN: `vscode-extension/.node_modules/.bin/tsc.cmd --noEmit -p .`, emitting
  TypeScript compile, `scripts/run-broker-tests.js`, and
  `scripts/run-reuse-gate.js` pass.
- Additional backend/UI Node checks passed: quota-core parity, headless
  TokenManager collection, dashboard broker HTTP flow, dashboard approval
  revision conflict flow, prewarm, compact UI at narrow widths, runtime token
  manager, visual graph safety guard, and headless regression scripts. The
  desktop compact regression passes all 18 tab/width combinations with zero
  bounds or clipping violations. Stock Windows PowerShell 5.1 and PS7
  LocalLLMInventory pass with isolated fixture environment values; PS7
  OnboardingMigration passes. The fake Ollama suite's original assertions pass
  under an equivalent Node loopback HTTP fixture (version, process listing,
  generate payload, keep-alive/context values, timeout, and artifact
  coalescing); the production runner and protected PowerShell scripts were not
  changed. No selector/runner files were changed as part of this work.
- Broker tests use a fresh ephemeral loopback port and temp state root. They
  verify real HTTP workspace/run/metric/task/approval reads, cross-workspace
  task-detail rejection, canonical ledger restoration after broker
  reconstruction, migration/readback/conflict behavior, CSV/JSONL edge cases,
  token timestamp/force semantics, and manifest digest.
- Existing live `127.0.0.1:37241` was not written to or restarted. No model
  invocation, download, GPU change, external transfer, commit, or push occurred.
- Parent browser QA against ephemeral broker 5415 verified desktop workspace
  selection, scoped run/metric HTTP 200 responses and rendered fixture rows.
  Clicking the actual approval button returned HTTP 200 and showed approval
  confirmation; the former revision conflict is resolved on this path.
- Desktop six-tab browser bounds checks at 199/160/120px found remaining
  settings advice/code and home-summary clipping despite document scrollWidth
  matching the viewport. Responsive CSS was updated, then both the parent's
  live browser and the persistent Chromium test passed all 18 combinations.
- HTTP/MCP desktop canonical migration and packaged cold-start checks passed
  in source-inaccessible temporary copies for both nested and standalone
  launchers. The versioned broker artifact built both desktop frontends with
  `INTEGRATED_POWER_EXTENSION_ROOT` pointing at a nonexistent directory. Both
  copies passed the 18-case Chromium compact UI test. The nested Tauri release
  compiled and its NSIS bundle was produced; after pinning the native child to
  port 37241, the NSIS bundle was rebuilt. No native app launch result or
  installer activation is claimed. A prior isolated-port launch attempt stopped
  before a health response. No broker write was attempted; the later live
  broker read checks still returned 404 for the new settings and notification
  routes, though that does not prove the earlier window made no read requests.
- Parent verified shared settings persistence and truthful manual prewarm
  behavior on an isolated broker: first dispatch was reported without claiming
  timer confirmation; repeating the same window returned duplicate and the
  dispatcher count remained one. Parent also confirmed the existing live
  37241 service remains on its legacy health response and returns 404 for the
  new settings/notification routes; these were read-only requests.
- The latest VSIX was rebuilt and runtime-smoked with a mock VS Code host,
  isolated profile/state root and ephemeral broker port. Artifact
  `integrated-power-0.9.21-integration.vsix` SHA-256 is now
  `DC84F9A48E771B97AB88A736001FF0645F238D2369A70CB7BCEA97BFF5B8ED22`.
  Runtime smoke read schema v2/settings and created/read back a task; it also
  verified the packaged IDE webview calls the shared 5/7 tick helper.
- Rebuilt the nested NSIS installer from the current UI and broker 0.9.21
  package at `control-center/src-tauri/target/release/bundle/nsis/Integrated
  Power Control Center_0.9.6_x64-setup.exe`, SHA-256
  `6630893B751CF0A814A96BEBD04CC561BB98B4486D60323D5CBD7BA0ECD9F42B`.
  The final bundle includes the latest desktop CSS and broker resources,
  including the Antigravity IDE globalStorage resolver.
  Both desktop workspaces now resolve Tauri API/CLI versions 2.11.1/2.11.4 by
  default. The standalone workspace keeps its validated API copy under its own
  `node_modules/.ignored` cache, while the previous 2.12.1 API directory is
  preserved beside the alias. Its source-isolated Vite build passed with the
  versioned broker package and a nonexistent extension root. The installed
  Tauri CLI rebuilt the nested NSIS target without an SDK override. The release
  executable and installer were generated without launching or installing
  the app.
- After adding the per-model controls, both desktop source copies match at
  `index.html`, `src/main.js`, `src/style.css`, and
  `scripts/test-desktop-compact-ui.js`. Each Vite build and Chromium suite
  passed all 18 tab/width cases at 199, 160 and 120 pixels with zero bounds,
  clipping or label-wrap violations. Synthetic Ready-state button clicks
  reached the fake broker as antigravity, opus and codex; mode selection by
  itself did not dispatch. The ChatGPT reset/status element reports Ready.
- IDE Chromium compact/gauge regression passed at 199, 160 and 120 pixels.
  It verifies separate qualified actions, disabled ineligible actions without
  dispatch, real model-target dispatch when eligible, six actual gauge tick
  overlays with five 5h and seven weekly segments, shared gradient positions,
  full-track tick coverage at partial/Ready/unavailable fills, and honest
  legacy broker messaging. The shared quota test and reuse gate also pass.
- Headless Chromium screenshots and a caption identifying both synthetic test
  fixtures are saved under `docs/verification/desktop-ide-parity/`.
- The latest VSIX runtime smoke also inspects the unpacked package: `webview/main.js`
  contains the five-hour/weekly 5/7 selector and calls the shared tick helper,
  and `webview/quota-core.js` contains that helper.
- Both desktop broker resource trees now have the same source digest
  `6d67acc9f268ae3e5ce3184fdb44a0297193ad5d95d88735d94d9f8b835418c7`.
  The standalone source-override package build, broker package verifier/tests,
  and 18-case compact suite passed. The nested verifier reports the same
  broker digest and its compact suite passed after NSIS packaging.
- The accidentally overwritten original
  `vscode-extension/integrated-power-0.9.21.vsix` was recovered from the
  official v0.9.21 GitHub release asset. The recovered release matches the
  previously recorded original size (972,940 bytes); its SHA-256
  (`D736C82CD58CAE43B32469F7F1AA9AF84C7449AD10216B9B4FB45FE413974DAD`)
  matches the official asset digest. No pre-overwrite local hash was recorded.
  The rebuilt integration VSIX remains a
  separate file at `integrated-power-0.9.21-integration.vsix` with SHA-256
  `DC84F9A48E771B97AB88A736001FF0645F238D2369A70CB7BCEA97BFF5B8ED22`.
- A prior `pnpm run tauri:build` attempt invoked a dependency bootstrap and hit
  pnpm's ignored `esbuild` script gate, moving the existing Tauri 2.11 packages
  into `node_modules/.ignored` and installing the newer 2.12 tree. API/CLI
  defaults have since been persistently aligned to the existing 2.11.1 and
  2.11.4 SDKs in both desktop workspaces. The standalone workspace has a local
  validated API copy and no cross-repository API link. Its source-isolated
  build, compact UI and broker package checks pass. The standard installed
  Tauri CLI then built the final NSIS target. An all-target attempt encountered
  a WiX `light.exe` failure, so the verified Windows installer target is NSIS.
- Legacy prewarm responses without a `status` now report only that the older
  broker accepted the request, while stating execution and timer start remain
  unconfirmed. The Chromium test clicks an eligible control against that
  legacy response and checks the message; both desktop copies pass it.

- Parent's browser inspection confirms all three Windows action buttons are
  visible, enabled for the synthetic Ready fixture and properly labeled.
- At 900px, the provider hide control and status labels now stay on one line,
  and the Korean token heading keeps words intact while the banner groups wrap
  responsively. The extended 18-case regression also checks those controls at
  desktop widths in both mirrored copies; all six tabs at 199/160/120px and
  wide-label checks pass with zero overflow or wrapped labels.
- Canonical broker startup now recognizes the actual Antigravity IDE product
  folder under `APPDATA/Antigravity IDE/User/globalStorage` while preserving
  explicit IDE storage overrides and existing Antigravity/VS Code roots ahead
  of it. The regression was observed RED before the resolver change and GREEN
  afterward in both desktop workspaces. It seeds only temporary product data
  and injected keys, then verifies canonical migration, task readback after
  HTTP restart, and MCP startup. The source and all three packaged resolver
  copies match at SHA-256
  `5BBF81D430E4CC1C3BBCAE15C314E7C2259139904044E3D65E65AFA41A438B03`;
  the nested Tauri release resources contain the same resolver before the
  NSIS-only rebuild. No installed user state or live broker was accessed.
### Remaining activation and evidence limits

- Do not activate the NSIS installer or replace/restart the live 37241 broker
  until the user explicitly approves that external state change.
- Native GUI interaction was not verified; the Tauri child now pins 37241 to
  match its fixed frontend/CSP endpoint, so any future native GUI test must use
  an explicitly isolated app profile or a launch-only frontend endpoint seam.
- Parent owns final review of all worktree changes and any activation request.

## 2026-10-13 0.9.22 release verification (latest)

- Both Control Center workspaces now report version `0.9.22` consistently in
  `package.json`, both npm lockfile version fields, Tauri config, Cargo.toml,
  and the application crate entry in Cargo.lock. Their installed Tauri SDKs
  resolve locally to API `2.11.1` and CLI `2.11.4`; no dependency install or
  framework upgrade was run.
- The nested Control Center NSIS build completed through the existing local
  Tauri CLI and cached Rust dependencies. The current artifact is
  `control-center/src-tauri/target/release/bundle/nsis/Integrated Power
  Control Center_0.9.22_x64-setup.exe`, 35,421,614 bytes, SHA-256
  `BE947302D579B776DEDFCC25EC5F30FCCD9819AA2AC4BB7C4698F4D868B6D882`.
  NSIS was built without launching or installing the app. Other older MSI/NSIS
  files in the bundle directory are historical artifacts and are not the
  0.9.22 release target.
- The standalone packaged broker's `index.js` and manifest were aligned to the
  nested validated 0.9.22 broker while preserving its standalone-only packaged
  Python asset. Both packaged runtime trees verify broker version `0.9.22`,
  schema 2, digest `f82df3d0ea1a6d71470dca7ab4888d1606e555b232f6ff3eddc19e77b724ef86`.
  Both desktop broker-package checks, HTTP restart continuity, MCP startup,
  package verification, and 18-case compact UI suites pass. The UI suites cover
  all six tabs at 199, 160, and 120 pixels with zero violations.
- The explicit `integrated-power-0.9.22.vsix` runtime smoke passed using a mock
  VS Code host, isolated state root, and ephemeral broker. It read settings and
  created/read back a task. IDE compact UI, prewarm, and quota-core regressions
  also pass. The VSIX remains unchanged at 1,037,127 bytes, SHA-256
  `CE5DC3F94898802D38D2C1FEDA76938DDB2EDB7609CBC0CB35578A5100D3B351`.
- The release guide now documents Windows build prerequisites, pinned Tauri
  package versions, the bundled Node runtime, and default WebView2 bootstrapper
  behavior. Its GitHub CLI command uses a generic release-notes filename
  placeholder rather than the stale 0.9.5 notes path.
- Parent's final VSIX source gates also passed: quota-core, prewarm, compact UI,
  reuse, runtime-background-token, visual-graph-safety, headless, broker, and
  TypeScript no-emit. These are synthetic/unit/runtime-fixture checks; they do
  not claim live model or GPU execution.
- No commit or push was made by the implementation agent. The live broker on
  port 37241, installed application, and user IDE state were not accessed;
  native GUI activation remains unverified.
