const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { parseRunJsonl, parseLocalLlmMetricsCsv } = require("../../shared/telemetry/runState");
const { BrokerClient } = require("../out/broker/client");
const { scanLiveTokenStatus } = require("../out/broker/tokenScanner");
const { findExecutableOnPath } = require("../out/broker/executable");
const {
  EncryptedEventLedger,
  IntegratedPowerBroker,
  createTaskId,
  shouldEscalate,
  chooseProvider,
  selectPreferredLocalModel,
  buildWorkspaceContext,
  JsonRpcStdioClient,
  processMcpRequest,
  startBrokerServer,
  loadOrCreateLedgerKey,
  loadExistingLedgerKey,
  createFirstWaveAdapters,
  listHostIntegrations,
  discoverInstallations,
  registerClaudeLocalMcp,
  saveHostIntegrationConfig,
  createPreferredEventLedger,
  SqlCipherEventLedger,
  migrateBrokerLedgers,
  migrateEncryptedLedger,
} = require("../out/broker");

async function main() {
  {
    const measuredAt = "2026-10-13T04:00:00.000Z";
    const tokenManager = {
      async getStatus(fileUri, options) {
        assert.strictEqual(fileUri, undefined);
        assert.deepStrictEqual(options, { refreshQuota: true, forceRefresh: true });
        return {
          antigravityTokensLeft: 40, antigravityMax: 100, antigravityPercentage: 40,
          antigravityWeeklyTokensLeft: 70, antigravityWeeklyMax: 200,
          opusTokensLeft: 10, opusMax: 50, opusWeeklyTokensLeft: 20, opusWeeklyMax: 80,
          codexTokensLeft: 60, codexMax: 100, codexWeeklyTokensLeft: 120, codexWeeklyMax: 200,
          codexStatus: "Measured", recommendedTaskWeight: "degraded", activity: [],
          errors: ["synthetic provider warning"],
          quotaPools: [{ id: "codex.5h", provider: "codex", remainingPercentage: 60, source: "official-api", confidence: "reported-quota" }],
          localComputeStatus: { endpointHealth: "ok", loadedModels: ["qwen3.8:27b"], gpus: [{ id: 0, name: "Synthetic GPU", utilizationPercentage: 12, vramUsedMb: 1024, vramTotalMb: 8192 }] },
          claudeDirectUsage: { status: "measured", sources: ["synthetic"], lastMeasuredAt: measuredAt, today: { totalTokens: 11, billableTokens: 9, reasoningOutputTokens: 2, eventCount: 1 }, sevenDays: { totalTokens: 21, billableTokens: 18, reasoningOutputTokens: 3, eventCount: 2 } },
        };
      },
    };
    const collected = await scanLiveTokenStatus({ force: true, tokenManager, now: () => new Date(measuredAt) });
    assert.strictEqual(collected.lastSync, measuredAt, "cold-start collection reports completion time");
    assert.strictEqual(collected.codexTokensLeft, 60);
    assert.strictEqual(collected.taskRouting, "degraded");
    assert.strictEqual(collected.quotaPools[0].source, "official-api");
    assert.strictEqual(collected.localComputeStatus.loadedModels[0], "qwen3.8:27b");
    assert.strictEqual(collected.directUsage.lastMeasuredAt, measuredAt);
    assert.deepStrictEqual(collected.errors, ["synthetic provider warning"]);
    const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "integrated-power-stale-token-"));
    try {
      const staleFile = path.join(staleRoot, "token_status.json");
      fs.writeFileSync(staleFile, JSON.stringify({ lastSync: "2020-01-01T00:00:00.000Z", codexPercentage: 100 }));
      let staleCollectionCalls = 0;
      const staleResult = await scanLiveTokenStatus({
        tokenStatusPath: staleFile,
        now: () => new Date(measuredAt),
        tokenManager: { async getStatus(_uri, options) { staleCollectionCalls++; assert.deepStrictEqual(options, { refreshQuota: true, forceRefresh: false }); return { codexPercentage: 33, codexTokensLeft: 33, codexMax: 100, codexWeeklyTokensLeft: 50, codexWeeklyMax: 100, antigravityTokensLeft: 0, antigravityMax: 0, antigravityWeeklyTokensLeft: 0, antigravityWeeklyMax: 0, opusTokensLeft: 0, opusMax: 0, opusWeeklyTokensLeft: 0, opusWeeklyMax: 0, codexStatus: "fresh", llmStatus: "offline", recommendedTaskWeight: "normal", activity: [] }; } },
      });
      assert.strictEqual(staleCollectionCalls, 1, "stale file triggers the shared collector exactly once");
      assert.strictEqual(staleResult.codexPercentage, 33);
      assert.strictEqual(staleResult.lastSync, measuredAt);
    } finally {
      fs.rmSync(staleRoot, { recursive: true, force: true });
    }
  }

  const manifestPath = path.join(__dirname, "..", "out", "broker", "broker-manifest.json");
  execFileSync(process.execPath, [path.join(__dirname, "build-broker-package.js")], { stdio: "inherit" });
  execFileSync(process.execPath, [path.join(__dirname, "write-broker-manifest.js")], { stdio: "pipe" });
  const brokerManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.strictEqual(brokerManifest.entrypoint, "index.js");
  assert.strictEqual(brokerManifest.schemaVersion, 2);
  assert.ok(brokerManifest.capabilities.includes("runs.read"));
  const brokerRoot = path.dirname(manifestPath);
  assert.strictEqual(brokerManifest.assetRoot, "../..");
  const brokerAssets = path.resolve(brokerRoot, brokerManifest.assetRoot);
  assert.ok(fs.existsSync(path.join(brokerAssets, "scripts", "read-agy-credential.ps1")), "manifest resource root includes existing credential authority");
  assert.ok(fs.existsSync(path.join(brokerAssets, "assets", "ip-orchestrator-plugin", "skills", "ip-orchestrator", "scripts", "Select-LocalLLMModel.ps1")), "manifest resource root includes existing selector authority");
  const sourceHash = crypto.createHash("sha256");
  const runtimeFiles = fs.readdirSync(brokerRoot, { recursive: true }).filter((entry) => typeof entry === "string" && entry.endsWith(".js")).sort();
  for (const relativePath of runtimeFiles) {
    sourceHash.update(relativePath.replace(/\\/g, "/"));
    sourceHash.update(Buffer.from([0]));
    sourceHash.update(fs.readFileSync(path.join(brokerRoot, relativePath)));
  }
  assert.strictEqual(brokerManifest.sourceDigest, sourceHash.digest("hex"), "manifest digest covers the sorted broker runtime tree");
  const isolatedPackage = fs.mkdtempSync(path.join(__dirname, "..", ".broker-isolated-"));
  try {
    fs.cpSync(brokerRoot, path.join(isolatedPackage, "broker"), { recursive: true });
    const packagedRuntimeScript = String.raw`
const fs = require('fs');
const path = require('path');
const { IntegratedPowerBroker, EncryptedEventLedger, startBrokerServer } = require('./broker/index.js');
const stateRoot = process.env.BROKER_TEST_STATE_ROOT;
const workspaceId = 'packaged-fixture';
const workspaceRoot = path.join(stateRoot, 'workspaces', workspaceId);
fs.mkdirSync(path.join(workspaceRoot, '.agent-runs'), { recursive: true });
fs.mkdirSync(path.join(workspaceRoot, 'reports'), { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, '.agent-runs', 'runs.jsonl'), JSON.stringify({ id: 'cold-run', status: 'completed' }) + '\n');
fs.writeFileSync(path.join(workspaceRoot, 'reports', 'local_llm_metrics.csv'), 'Timestamp,TaskTitle,Model,TaskScale,ActualElapsedSeconds,TotalTokens,TaskType,Provider,Success,OutputChars,TokensPerSecond,SelectedBy,SelectionReason,ErrorMessage\n2026-10-13T00:00:00Z,cold,qwen3.8:27b,small,1,2,inference,ollama,true,3,2,selector,fixture,\n');
(async () => {
  const key = Buffer.alloc(32, 31);
  const ledgerPath = path.join(stateRoot, 'broker', 'events.enc.jsonl');
  let broker = new IntegratedPowerBroker(new EncryptedEventLedger(ledgerPath, key), []);
  await broker.initialize();
  let server = await startBrokerServer(broker, 0);
  const base = 'http://127.0.0.1:' + server.port;
  const health = await fetch(base + '/health').then((response) => response.json());
  const quotaSettings = await fetch(base + '/v1/settings/quota').then((response) => response.json());
  const runs = await fetch(base + '/v1/runs?workspaceId=' + workspaceId).then((response) => response.json());
  const metrics = await fetch(base + '/v1/metrics/local-llm?workspaceId=' + workspaceId).then((response) => response.json());
  const created = await fetch(base + '/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'cold-start continuity', goal: 'persist state', originProvider: 'local.openai-compatible' }) }).then((response) => response.json());
  await server.close();
  broker = new IntegratedPowerBroker(new EncryptedEventLedger(ledgerPath, key), []);
  await broker.initialize();
  server = await startBrokerServer(broker, 0);
  const tasks = await fetch('http://127.0.0.1:' + server.port + '/v1/tasks').then((response) => response.json());
  await server.close();
  if (health.schemaVersion !== 2 || quotaSettings.initialized !== false || runs.runs[0]?.id !== 'cold-run' || metrics.metrics[0]?.taskTitle !== 'cold' || !tasks.tasks.some((task) => task.id === created.task.id)) throw new Error('packaged cold-start HTTP/state continuity failed');
  process.stdout.write(JSON.stringify({ schemaVersion: health.schemaVersion, runId: runs.runs[0].id, metricTask: metrics.metrics[0].taskTitle, taskId: created.task.id, settingsInitialized: quotaSettings.initialized }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;
    const packagedEvidence = execFileSync(process.execPath, ["-e", packagedRuntimeScript], {
      cwd: isolatedPackage,
      env: { ...process.env, USERPROFILE: isolatedPackage, HOME: isolatedPackage, LOCALAPPDATA: isolatedPackage, INTEGRATED_POWER_STATE_ROOT: path.join(isolatedPackage, "state"), BROKER_TEST_STATE_ROOT: path.join(isolatedPackage, "state") },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.deepStrictEqual(JSON.parse(packagedEvidence), { schemaVersion: 2, runId: "cold-run", metricTask: "cold", taskId: JSON.parse(packagedEvidence).taskId, settingsInitialized: false });
  } finally {
    fs.rmSync(isolatedPackage, { recursive: true, force: true });
  }
  {
    const notificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "integrated-power-notifications-"));
    const notificationBroker = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(notificationRoot, "broker", "events.enc.jsonl"), Buffer.alloc(32, 77)), []);
    await notificationBroker.initialize();
    let authoritativeStatus;
    const notificationServerOptions = { stateRoot: notificationRoot, autoSchedule: false, tokenStatusReader: async () => authoritativeStatus };
    let notificationServer = await startBrokerServer(notificationBroker, 0, notificationServerOptions);
    const notificationUrl = () => `http://127.0.0.1:${notificationServer.port}/v1/notifications/quota-refill`;
    const settingsUrl = () => `http://127.0.0.1:${notificationServer.port}/v1/settings/quota`;
    const sample = (value) => ({
      antigravityPercentage: value, antigravityWeeklyPercentage: value,
      opusPercentage: value, opusWeeklyPercentage: value,
      codexPercentage: value, codexWeeklyPercentage: value,
      claudePercentage: value, claudeWeeklyPercentage: value,
    });
    const postStatus = async (status, requestId) => fetch(notificationUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: requestId }) });
    try {
      const initial = await fetch(settingsUrl()).then((response) => response.json());
      const initialize = await fetch(settingsUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: initial.revision, initializeFrom: "desktop", idempotencyKey: "notify-settings", settings: { notifyOnFull: true } }) });
      assert.strictEqual(initialize.status, 200);
      authoritativeStatus = sample(20);
      const baseline = await postStatus(sample(20), "notify-baseline");
      assert.strictEqual(baseline.status, 200, "broker exposes the canonical refill claim API");
      assert.deepStrictEqual((await baseline.json()).notifications, []);
      authoritativeStatus = sample(100);
      const [firstClaim, secondClaim] = await Promise.all([postStatus(sample(100), "notify-refill-client-a"), postStatus(sample(100), "notify-refill-client-b")]);
      const claims = await Promise.all([firstClaim.json(), secondClaim.json()]);
      assert.deepStrictEqual(claims.map((claim) => claim.notifications.length).sort(), [0, 8], "competing UI clients receive one shared set of eight refill events");
      assert.strictEqual(claims.flatMap((claim) => claim.notifications).filter((item) => item.configKey === "notifications.antigravityGemini5h").length, 1);
      const staleOutOfOrder = await postStatus(sample(20), "notify-stale-client").then((response) => response.json());
      assert.deepStrictEqual(staleOutOfOrder.notifications, [], "an out-of-order stale client payload cannot rewind the authoritative shared snapshot");
      await notificationServer.close();
      notificationServer = await startBrokerServer(notificationBroker, 0, notificationServerOptions);
      const afterRestart = await fetch(notificationUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((response) => response.json());
      assert.deepStrictEqual(afterRestart.notifications, [], "restart preserves the shared baseline and notified window IDs");
      const unchanged = await postStatus(sample(100), "notify-still-full").then((response) => response.json());
      assert.deepStrictEqual(unchanged.notifications, [], "repeated full snapshots do not duplicate notifications");
      authoritativeStatus = sample(30);
      const reset = await postStatus(sample(30), "notify-reset").then((response) => response.json());
      assert.deepStrictEqual(reset.notifications, []);
      authoritativeStatus = sample(100);
      const refillAgain = await postStatus(sample(100), "notify-refill-again").then((response) => response.json());
      assert.strictEqual(refillAgain.notifications.length, 8, "dropping below 100 resets notification claims for the next refill");
      const saved = await fetch(settingsUrl()).then((response) => response.json());
      const perWindowOff = await fetch(settingsUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: saved.revision, idempotencyKey: "notify-window-off", settings: { notifications: { antigravityGemini5h: false } } }) }).then((response) => response.json());
      authoritativeStatus = sample(20);
      await postStatus(sample(20), "notify-reset-window-off");
      authoritativeStatus = sample(100);
      const windowGated = await postStatus(sample(100), "notify-window-off-refill").then((response) => response.json());
      assert.strictEqual(windowGated.notifications.length, 7, "per-window setting filters only that shared event");
      const masterOff = await fetch(settingsUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: perWindowOff.revision, idempotencyKey: "notify-master-off", settings: { notifyOnFull: false } }) }).then((response) => response.json());
      authoritativeStatus = sample(20);
      await postStatus(sample(20), "notify-reset-master-off");
      authoritativeStatus = sample(100);
      const masterGated = await postStatus(sample(100), "notify-master-off-refill").then((response) => response.json());
      assert.strictEqual(masterGated.notifications.length, 0, "master setting gates all eight shared events");
      assert.strictEqual(masterOff.revision, perWindowOff.revision + 1);
    } finally {
      await notificationServer.close();
      fs.rmSync(notificationRoot, { recursive: true, force: true });
    }
  }
  const parsedRuns = parseRunJsonl([
    JSON.stringify({ id: "run-shared", title: "Quoted, title", status: "running", startedAt: "2026-10-13T01:00:00Z", artifacts: ["src/a.ts"] }),
    "{ malformed",
    JSON.stringify({ id: "run-shared", status: "completed", updatedAt: "2026-10-13T01:02:00Z", contextFiles: ["src/a.ts", "src/b.ts"] }),
  ].join("\n"), { normalizeArtifactPath: (value) => value });
  assert.strictEqual(parsedRuns.runs.length, 1, "shared run parser merges event deltas by id");
  assert.strictEqual(parsedRuns.runs[0].status, "completed");
  assert.strictEqual(parsedRuns.runs[0].active, false);
  assert.strictEqual(parsedRuns.runs[0].title, "Quoted, title");
  assert.strictEqual(parsedRuns.runs[0].contextFiles.length, 2);
  assert.strictEqual(parsedRuns.parseErrors.length, 1, "malformed JSONL is reported while valid records survive");
  const parsedMetrics = parseLocalLlmMetricsCsv('Timestamp,TaskTitle,Model,TaskScale,ActualElapsedSeconds,TotalTokens,TaskType,Provider,Success,OutputChars,TokensPerSecond,SelectedBy,SelectionReason,ErrorMessage\n2026-10-13T01:00:00Z,"task, one","qwen3.8:27b",large,4.5,28,inference,ollama,true,95,6.2,selector,"reason: ""selected""",');
  assert.strictEqual(parsedMetrics.metrics.length, 1, "shared CSV reader handles quoted commas and escaped quotes");
  assert.strictEqual(parsedMetrics.metrics[0].taskTitle, "task, one");
  assert.strictEqual(parsedMetrics.metrics[0].selectionReason, 'reason: "selected"');
  const multilineMetrics = parseLocalLlmMetricsCsv('Timestamp,TaskTitle,Model,TaskScale,ActualElapsedSeconds,TotalTokens,TaskType,Provider,Success,OutputChars,TokensPerSecond,SelectedBy,SelectionReason,ErrorMessage\n2026-10-13T01:00:00Z,"task\ncontinued",qwen3.8:27b,large,4.5,28,inference,ollama,true,95,6.2,selector,"line one\nline two",\n');
  assert.strictEqual(multilineMetrics.metrics[0].taskTitle, "task\ncontinued", "quoted CSV fields may span lines");
  assert.strictEqual(multilineMetrics.metrics[0].selectionReason, "line one\nline two");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "integrated-power-broker-"));
  try {
    const customAgyRoot = path.join(temp, "custom-antigravity", "bin");
    fs.mkdirSync(customAgyRoot, { recursive: true });
    const customAgyPath = path.join(customAgyRoot, process.platform === "win32" ? "agy.cmd" : "agy");
    fs.writeFileSync(customAgyPath, "fixture only; not executed");
    assert.strictEqual(findExecutableOnPath(process.platform === "win32" ? ["agy.exe", "agy.cmd", "agy.bat", "agy"] : ["agy"], { PATH: customAgyRoot }), customAgyPath, "prewarm resolves the installed CLI through existing PATH authority, including custom install roots");
    const ledger = new EncryptedEventLedger(path.join(temp, "events.enc.jsonl"), Buffer.alloc(32, 7));
    const adapters = [{
      provider: "google.antigravity.ide",
      async discover() { return { provider: this.provider, label: "Agy", available: true, mode: "gui", capabilities: ["leader", "executor", "streaming"] }; },
      async connectConversation() {},
      async submit() { return { provider: this.provider, text: "proposal" }; },
      async cancel() {},
    }];
    const broker = new IntegratedPowerBroker(ledger, adapters);
    await broker.initialize();
    const concurrentCreateInput = { title: "concurrent create", goal: "deduplicate", originProvider: "google.antigravity.ide", idempotencyKey: "create-same" };
    const [createdA, createdB] = await Promise.all([broker.createTask(concurrentCreateInput), broker.createTask(concurrentCreateInput)]);
    assert.strictEqual(createdA.id, createdB.id);
    assert.strictEqual((await broker.events(createdA.id)).filter((event) => event.type === "task.created").length, 1);
    const task = await broker.createTask({ title: "test", goal: "verify", originProvider: "google.antigravity.ide" });
    assert.strictEqual(task.revision, 1);
    await assert.rejects(() => broker.delegate({ taskId: task.id, provider: "google.antigravity.ide", prompt: "x", expectedRevision: 0 }), /revision conflict/i);
    await broker.delegate({ taskId: task.id, provider: "google.antigravity.ide", prompt: "x", expectedRevision: 1, idempotencyKey: "same" });
    const events = await broker.events(task.id);
    const duplicate = await broker.delegate({ taskId: task.id, provider: "google.antigravity.ide", prompt: "different", expectedRevision: 0, idempotencyKey: "same" });
    assert.strictEqual(duplicate.id, events.find((item) => item.type === "task.delegated").id);
    assert.ok(events.some((event) => event.type === "task.proposal"));
    assert.ok(events.some((event) => event.type === "task.completed"));
    assert.strictEqual(broker.getTask(task.id).status, "completed");
    assert.deepStrictEqual(broker.getTask(task.id).participants, ["google.antigravity.ide"]);

    // Concurrent GUI commands must serialize revision changes without
    // blocking cancellation of a provider that is still running.
    let releaseSlow;
    let slowCancelled = false;
    const slowAdapter = {
      provider: "local.openai-compatible",
      async discover() { return { provider: this.provider, label: "slow local", available: true, mode: "local", capabilities: ["executor", "cancel"] }; },
      async connectConversation() {},
      async submit() { await new Promise((resolve) => { releaseSlow = resolve; }); return { provider: this.provider, text: "slow proposal" }; },
      async cancel() { slowCancelled = true; releaseSlow?.(); },
    };
    const concurrentBroker = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(temp, "concurrent.enc.jsonl"), Buffer.alloc(32, 12)), [slowAdapter]);
    await concurrentBroker.initialize();
    const concurrentTask = await concurrentBroker.createTask({ title: "concurrency", goal: "serialize", originProvider: slowAdapter.provider });
    const firstDelegation = concurrentBroker.delegate({ taskId: concurrentTask.id, provider: slowAdapter.provider, prompt: "slow", expectedRevision: concurrentTask.revision, idempotencyKey: "slow-delegation" });
    for (let attempt = 0; attempt < 20 && !(await concurrentBroker.events(concurrentTask.id)).some((item) => item.type === "task.delegated"); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(() => concurrentBroker.delegate({ taskId: concurrentTask.id, provider: slowAdapter.provider, prompt: "stale", expectedRevision: 0, idempotencyKey: "stale-delegation" }), /revision conflict/i);
    await concurrentBroker.cancel(concurrentTask.id, concurrentBroker.getTask(concurrentTask.id).revision, "cancel-slow");
    await firstDelegation;
    assert.strictEqual(slowCancelled, true);
    assert.strictEqual(concurrentBroker.getTask(concurrentTask.id).status, "cancelled");
    assert.ok(!(await concurrentBroker.events(concurrentTask.id)).some((item) => item.type === "task.completed"));

    let releaseFirst;
    let releaseSecond;
    const parallelAdapter = (provider, release) => ({
      provider,
      async discover() { return { provider: this.provider, label: provider, available: true, mode: "local", capabilities: ["executor"] }; },
      async connectConversation() {},
      async submit() { await new Promise((resolve) => { release.resolve = resolve; }); return { provider: this.provider, text: provider }; },
      async cancel() {},
    });
    const firstGate = {};
    const secondGate = {};
    const parallelBroker = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(temp, "parallel.enc.jsonl"), Buffer.alloc(32, 13)), [
      parallelAdapter("local.openai-compatible", firstGate),
      parallelAdapter("google.antigravity.ide", secondGate),
    ]);
    await parallelBroker.initialize();
    const parallelTask = await parallelBroker.createTask({ title: "parallel", goal: "wait for all", originProvider: "local.openai-compatible" });
    const firstParallel = parallelBroker.delegate({ taskId: parallelTask.id, provider: "local.openai-compatible", prompt: "first", expectedRevision: parallelTask.revision, idempotencyKey: "parallel-first" });
    for (let attempt = 0; attempt < 20 && !(await parallelBroker.events(parallelTask.id)).some((item) => item.type === "task.delegated"); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    const secondParallel = parallelBroker.delegate({ taskId: parallelTask.id, provider: "google.antigravity.ide", prompt: "second", expectedRevision: parallelBroker.getTask(parallelTask.id).revision, idempotencyKey: "parallel-second" });
    for (let attempt = 0; attempt < 20 && (await parallelBroker.events(parallelTask.id)).filter((item) => item.type === "task.delegated").length < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    firstGate.resolve();
    await firstParallel;
    assert.strictEqual(parallelBroker.getTask(parallelTask.id).status, "running");
    assert.ok(!(await parallelBroker.events(parallelTask.id)).some((item) => item.type === "task.completed"));
    secondGate.resolve();
    await secondParallel;
    assert.strictEqual(parallelBroker.getTask(parallelTask.id).status, "completed");
    assert.strictEqual((await parallelBroker.events(parallelTask.id)).filter((item) => item.type === "task.completed").length, 1);

    const proposal = (await broker.listProposals(task.id))[0];
    const evaluationEvent = await broker.recordEvaluation({ taskId: task.id, proposalId: proposal.id, evaluator: "google.antigravity.ide", score: 0.9, rationale: "verified proposal", expectedRevision: task.revision, idempotencyKey: "evaluation-key" });
    const evidenceEvent = await broker.recordEvidence({ taskId: task.id, kind: "test", label: "broker test", passed: true, details: "automated verification", expectedRevision: broker.getTask(task.id).revision, idempotencyKey: "evidence-key" });
    const synthesisEvent = await broker.synthesize({ taskId: task.id, provider: "google.antigravity.ide", content: "synthesized result", confidence: 0.9, evidenceIds: [evidenceEvent.payload.id], expectedRevision: broker.getTask(task.id).revision, idempotencyKey: "synthesis-key" });
    assert.strictEqual(evaluationEvent.type, "task.evaluation");
    assert.strictEqual(synthesisEvent.type, "task.synthesis");
    assert.strictEqual((await broker.listEvaluations(task.id)).length, 1);
    assert.strictEqual(shouldEscalate(task, [{ passed: false }]), true);
    const decision = chooseProvider({ task, capabilities: await broker.discover() });
    assert.strictEqual(decision.provider, "google.antigravity.ide");
    assert.strictEqual(selectPreferredLocalModel(["qwen2.5:7b", "qwen2.5-coder:32b", "qwen3.6:27b", "qwen3.8:27b", "gpt-oss:20b"]), "qwen3.8:27b");
    const contextRoot = path.join(temp, "context");
    fs.mkdirSync(contextRoot, { recursive: true });
    fs.writeFileSync(path.join(contextRoot, "new.ts"), "const token = secret-value;", "utf8");
    const context = buildWorkspaceContext(contextRoot, ["new.ts"], 2000);
    assert.ok(context.text.includes("new.ts"));
    assert.ok(context.text.includes("token=[redacted]"));
    assert.ok(!context.text.includes("secret-value"));
    fs.writeFileSync(path.join(contextRoot, "secrets.ts"), "const auth = 'Bearer abc.def.ghi'; const key = 'sk-12345678901234567890';", "utf8");
    const redactedContext = buildWorkspaceContext(contextRoot, ["secrets.ts"], 2000);
    assert.ok(redactedContext.text.includes("Bearer [redacted]"));
    assert.ok(redactedContext.text.includes("sk-[redacted]"));
    assert.ok(!redactedContext.text.includes("abc.def.ghi"));
    fs.writeFileSync(path.join(contextRoot, "second.ts"), `${"const second = true;\n".repeat(100)}`, "utf8");
    const truncatedContext = buildWorkspaceContext(contextRoot, ["new.ts", "second.ts"], 1000);
    assert.strictEqual(new Set(truncatedContext.files).size, truncatedContext.files.length);
    assert.strictEqual(new Set(truncatedContext.omittedFiles).size, truncatedContext.omittedFiles.length);
    assert.ok(!truncatedContext.omittedFiles.includes("new.ts"));
    assert.ok(!truncatedContext.omittedFiles.includes("second.ts"));
    const restored = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(temp, "events.enc.jsonl"), Buffer.alloc(32, 7)), adapters);
    await restored.initialize();
    assert.strictEqual(restored.getTask(task.id).revision, task.revision);
    assert.strictEqual(restored.getTask(task.id).delegationDepth, 1);
    assert.strictEqual(restored.getTask(task.id).status, "completed");
    const sourceLedgerPath = path.join(temp, "legacy", "events.enc.jsonl");
    const canonicalLedgerPath = path.join(temp, "canonical", "events.enc.jsonl");
    const legacyKey = Buffer.alloc(32, 41);
    const canonicalKey = Buffer.alloc(32, 42);
    const legacyEvent = (await broker.events(task.id))[0];
    await new EncryptedEventLedger(sourceLedgerPath, legacyKey).append(legacyEvent);
    assert.strictEqual(await migrateEncryptedLedger(sourceLedgerPath, canonicalLedgerPath, legacyKey, canonicalKey), "migrated");
    assert.deepStrictEqual(await new EncryptedEventLedger(canonicalLedgerPath, canonicalKey).list(), [legacyEvent]);
    assert.strictEqual(await migrateEncryptedLedger(sourceLedgerPath, canonicalLedgerPath, legacyKey, canonicalKey), "destination-current");
    const sqlLegacyPath = path.join(temp, "sql-legacy", "events.enc.jsonl");
    const sqlLegacy = new SqlCipherEventLedger(sqlLegacyPath, legacyKey);
    await sqlLegacy.append(legacyEvent);
    sqlLegacy.close();
    const sqlMigrationTarget = path.join(temp, "sql-migration-target", "events.enc.jsonl");
    await migrateBrokerLedgers([{ path: sqlLegacyPath, key: legacyKey }], sqlMigrationTarget, () => canonicalKey);
    assert.deepStrictEqual(await new EncryptedEventLedger(sqlMigrationTarget, canonicalKey).list(), [legacyEvent], "legacy SQLCipher history is re-encrypted without deleting its source");
    assert.strictEqual(fs.existsSync(sqlLegacyPath), true);
    const divergedSourcePath = path.join(temp, "legacy-diverged", "events.enc.jsonl");
    const divergedEvent = { ...legacyEvent, id: `${legacyEvent.id}-other` };
    await new EncryptedEventLedger(divergedSourcePath, legacyKey).append(divergedEvent);
    const pairConflictTarget = path.join(temp, "pair-conflict", "events.enc.jsonl");
    await assert.rejects(() => migrateBrokerLedgers([
      { path: sourceLedgerPath, key: legacyKey },
      { path: divergedSourcePath, key: legacyKey },
    ], pairConflictTarget, () => canonicalKey), /histories diverge/);
    assert.strictEqual(fs.existsSync(pairConflictTarget), false, "all legacy histories are preflighted before destination writes");
    const fallbackCanonicalPath = path.join(temp, "fallback-canonical", "events.enc.jsonl");
    const fallbackCanonicalEvent = { ...legacyEvent, id: `${legacyEvent.id}-fallback` };
    await new EncryptedEventLedger(`${fallbackCanonicalPath}.jsonl`, canonicalKey).append(fallbackCanonicalEvent);
    const selectedFallback = createPreferredEventLedger(fallbackCanonicalPath, canonicalKey);
    assert.deepStrictEqual(await selectedFallback.list(), [fallbackCanonicalEvent], "existing encrypted fallback remains the selected canonical ledger");
    const corruptSource = path.join(temp, "corrupt", "events.enc.jsonl");
    fs.mkdirSync(path.dirname(corruptSource), { recursive: true });
    fs.writeFileSync(corruptSource, '{"version":1,"iv":"bad","tag":"bad","ciphertext":"bad"}\n', "utf8");
    await assert.rejects(() => migrateEncryptedLedger(corruptSource, path.join(temp, "corrupt-target", "events.enc.jsonl"), legacyKey, canonicalKey), /Unable to read encrypted ledger record/);
    assert.strictEqual(fs.existsSync(path.join(temp, "corrupt-target", "events.enc.jsonl")), false);
    const conflictPath = path.join(temp, "conflict", "events.enc.jsonl");
    const conflictingEvent = { ...legacyEvent, id: `${legacyEvent.id}-divergent`, revision: legacyEvent.revision + 100 };
    await new EncryptedEventLedger(conflictPath, canonicalKey).append(conflictingEvent);
    const conflictingBefore = fs.readFileSync(conflictPath);
    await assert.rejects(() => migrateEncryptedLedger(sourceLedgerPath, conflictPath, legacyKey, canonicalKey), /histories diverge/);
    assert.deepStrictEqual(fs.readFileSync(conflictPath), conflictingBefore, "conflicting target history is preserved for user review");
    const approval = await restored.requestApproval(task.id, "merge", "Merge reviewed work", "google.antigravity.ide");
    const approvalRestored = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(temp, "events.enc.jsonl"), Buffer.alloc(32, 7)), adapters);
    await approvalRestored.initialize();
    assert.strictEqual(approvalRestored.getApprovals().some((item) => item.id === approval.id), true);
    await approvalRestored.approve(approval.id);
    const approvalFinal = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(temp, "events.enc.jsonl"), Buffer.alloc(32, 7)), adapters);
    await approvalFinal.initialize();
    assert.strictEqual(approvalFinal.getApprovals().some((item) => item.id === approval.id), false);

    const failingAdapter = {
      provider: "google.antigravity.ide",
      async discover() { return { provider: this.provider, label: "Agy", available: true, mode: "cli", capabilities: ["executor"] }; },
      async connectConversation() {},
      async submit() { throw new Error("simulated adapter failure"); },
      async cancel() {},
    };
    const failingBroker = new IntegratedPowerBroker(
      new EncryptedEventLedger(path.join(temp, "failure.enc.jsonl"), Buffer.alloc(32, 9)),
      [failingAdapter],
    );
    await failingBroker.initialize();
    const failingTask = await failingBroker.createTask({ title: "failure", goal: "propagate", originProvider: "google.antigravity.ide" });
    await assert.rejects(
      () => failingBroker.delegate({ taskId: failingTask.id, provider: "google.antigravity.ide", prompt: "fail", expectedRevision: failingTask.revision }),
      /simulated adapter failure/,
    );
    assert.strictEqual(failingBroker.getTask(failingTask.id).status, "failed");

    const apiAdapter = {
      provider: "xai.grok",
      async discover() { return { provider: this.provider, label: "API test", available: true, mode: "api", capabilities: ["executor"] }; },
      async connectConversation() {},
      async submit() { return { provider: this.provider, text: "api proposal" }; },
      async cancel() {},
    };
    const apiBroker = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(temp, "api.enc.jsonl"), Buffer.alloc(32, 6)), [apiAdapter]);
    await apiBroker.initialize();
    const apiTask = await apiBroker.createTask({ title: "api budget", goal: "gate spend", originProvider: "xai.grok" });
    await assert.rejects(() => apiBroker.delegate({ taskId: apiTask.id, provider: "xai.grok", prompt: "blocked", expectedRevision: apiTask.revision }), /budget/i);
    const budgetApproval = await apiBroker.requestApproval(apiTask.id, "budget-overage", "Allow one approved API execution", "user", apiTask.revision, "budget-key");
    await apiBroker.approve(budgetApproval.id, apiBroker.getTask(apiTask.id).revision, "approve-budget-key");
    const externalApproval = await apiBroker.requestApproval(apiTask.id, "external-send", "Allow approved external task transfer", "user", apiBroker.getTask(apiTask.id).revision, "external-key");
    await apiBroker.approve(externalApproval.id, apiBroker.getTask(apiTask.id).revision, "approve-external-key");
    await apiBroker.delegate({ taskId: apiTask.id, provider: "xai.grok", prompt: "approved", expectedRevision: apiBroker.getTask(apiTask.id).revision });

    const gitRoot = path.join(temp, "git-workspace");
    fs.mkdirSync(gitRoot, { recursive: true });
    require("child_process").execFileSync("git", ["-C", gitRoot, "init", "-q"]);
    fs.writeFileSync(path.join(gitRoot, "README.md"), "isolated\n", "utf8");
    require("child_process").execFileSync("git", ["-C", gitRoot, "add", "."]);
    require("child_process").execFileSync("git", ["-C", gitRoot, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "init"]);
    const isolatedAdapter = {
      provider: "google.antigravity.ide",
      async discover() { return { provider: this.provider, label: "Agy", available: true, mode: "cli", capabilities: ["executor", "code-write"] }; },
      async connectConversation() {},
      async submit(task) { assert.ok(task.isolatedWorkspacePath); assert.notStrictEqual(task.workspacePath, gitRoot); fs.writeFileSync(path.join(task.workspacePath, "CHANGE.md"), "approved change\n", "utf8"); require("child_process").execFileSync("git", ["-C", task.workspacePath, "add", "."]); require("child_process").execFileSync("git", ["-C", task.workspacePath, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "change"]); return { provider: this.provider, text: "isolated" }; },
      async cancel() {},
    };
    const isolatedAdapter2 = {
      provider: "openai.codex.app",
      async discover() { return { provider: this.provider, label: "Codex", available: true, mode: "app-server", capabilities: ["executor", "code-write"] }; },
      async connectConversation() {},
      async submit(task) { assert.ok(task.isolatedWorkspacePath); fs.writeFileSync(path.join(task.workspacePath, "CODEX.md"), "second isolated change\n", "utf8"); require("child_process").execFileSync("git", ["-C", task.workspacePath, "add", "."]); require("child_process").execFileSync("git", ["-C", task.workspacePath, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "codex change"]); return { provider: this.provider, text: "second isolated" }; },
      async cancel() {},
    };
    const isolatedBroker = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(temp, "isolated.enc.jsonl"), Buffer.alloc(32, 8)), [isolatedAdapter, isolatedAdapter2]);
    await isolatedBroker.initialize();
    const isolatedTask = await isolatedBroker.createTask({ title: "isolation", goal: "write safely", originProvider: isolatedAdapter.provider, workspacePath: gitRoot });
    await isolatedBroker.delegate({ taskId: isolatedTask.id, provider: isolatedAdapter.provider, prompt: "write", expectedRevision: isolatedTask.revision });
    assert.ok(isolatedBroker.getTask(isolatedTask.id).isolatedWorkspacePath);
    const firstWorkspace = isolatedBroker.getTask(isolatedTask.id).isolatedWorkspacePath;
    await isolatedBroker.delegate({ taskId: isolatedTask.id, provider: isolatedAdapter2.provider, prompt: "write second", expectedRevision: isolatedBroker.getTask(isolatedTask.id).revision });
    assert.notStrictEqual(isolatedBroker.getTask(isolatedTask.id).isolatedWorkspacePath, firstWorkspace);
    const mergeApproval = await isolatedBroker.requestApproval(isolatedTask.id, "merge", "merge", "user");
    await isolatedBroker.approve(mergeApproval.id);
    const mergeCommit = await isolatedBroker.mergeTask(isolatedTask.id, isolatedBroker.getTask(isolatedTask.id).revision);
    assert.match(mergeCommit, /^[0-9a-f]{7,}$/);
    assert.ok(fs.existsSync(path.join(gitRoot, "CHANGE.md")));
    const isolatedRestored = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(temp, "isolated.enc.jsonl"), Buffer.alloc(32, 8)), [isolatedAdapter, isolatedAdapter2]);
    await isolatedRestored.initialize();
    const restoredIsolatedTask = isolatedRestored.getTask(isolatedTask.id);
    assert.strictEqual(restoredIsolatedTask.status, "completed");
    assert.deepStrictEqual(restoredIsolatedTask.isolatedWorkspaces, []);
    assert.strictEqual(restoredIsolatedTask.workspacePath, gitRoot);

    // Stable Codex app-server JSONL handshake/event parsing with an in-memory transport.
    const { PassThrough } = require("stream");
    const fakeStdin = new PassThrough();
    const fakeStdout = new PassThrough();
    const fakeChild = {
      stdin: fakeStdin,
      stdout: fakeStdout,
      killed: false,
      kill() { this.killed = true; },
      on() { return this; },
    };
    fakeStdin.on("data", (chunk) => {
      const request = JSON.parse(String(chunk).trim());
      if (request.method === "initialize") fakeStdout.write(JSON.stringify({ id: request.id, result: {} }) + "\n");
      if (request.method === "thread/start") fakeStdout.write(JSON.stringify({ id: request.id, result: { thread: { id: "thr_test" } } }) + "\n");
      if (request.method === "turn/start") {
        fakeStdout.write(JSON.stringify({ id: request.id, result: { turn: { id: "turn_test", status: "inProgress" } } }) + "\n");
        fakeStdout.write(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "thr_test", delta: "READY" } }) + "\n");
        fakeStdout.write(JSON.stringify({ method: "turn/completed", params: { turn: { id: "turn_test", status: "completed" } } }) + "\n");
      }
    });
    const rpc = new JsonRpcStdioClient(fakeChild);
    await rpc.request("initialize", { clientInfo: { name: "test" } });
    rpc.notify("initialized", {});
    const started = await rpc.request("thread/start", {});
    const startedTurn = await rpc.request("turn/start", { threadId: started.thread.id, input: [{ type: "text", text: "test" }] });
    assert.strictEqual(await rpc.collectTurn(started.thread.id, startedTurn.turn.id), "READY");
    rpc.close();
    const hangingStdin = new PassThrough();
    const hangingStdout = new PassThrough();
    const hangingChild = { stdin: hangingStdin, stdout: hangingStdout, killed: false, kill() { this.killed = true; }, on(event, handler) { if (event === "close") this._close = handler; return this; } };
    const hangingRpc = new JsonRpcStdioClient(hangingChild);
    const hangingTurn = hangingRpc.collectTurn("thr_hanging");
    hangingRpc.close();
    await assert.rejects(hangingTurn, /closed/i);
    const mcpInit = await processMcpRequest(broker, { jsonrpc: "2.0", id: 11, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    const mcpTools = await processMcpRequest(broker, { jsonrpc: "2.0", id: 12, method: "tools/list", params: {} });
    assert.strictEqual(mcpInit.result.protocolVersion, "2025-06-18");
    assert.ok(mcpTools.result.tools.length >= 10);
    assert.ok(mcpTools.result.tools.some((tool) => tool.name === "integrated_power_cancel"));
    assert.ok(mcpTools.result.tools.some((tool) => tool.name === "integrated_power_merge"));
    const keyPath = path.join(temp, "secure", "events.key");
    const keyring = new Map();
    const testKeyStore = {
      read(target) { return keyring.get(target); },
      write(target, value) { keyring.set(target, Buffer.from(value)); return true; },
      readFallback(target) { return keyring.get(`fallback:${target}`); },
      writeFallback(target, value) { keyring.set(`fallback:${target}`, Buffer.from(value)); return true; },
    };
    const firstKey = loadOrCreateLedgerKey(keyPath, testKeyStore);
    const secondKey = loadOrCreateLedgerKey(keyPath, testKeyStore);
    assert.strictEqual(firstKey.length, 32);
    assert.strictEqual(firstKey.equals(secondKey), true);
    const legacyKeyPath = path.join(temp, "legacy-key", "events.key");
    fs.mkdirSync(path.dirname(legacyKeyPath), { recursive: true });
    fs.writeFileSync(legacyKeyPath, Buffer.alloc(32, 91));
    const fallbackKeyring = new Map();
    const unavailableKeyStore = {
      read() { return undefined; }, write() { return false; },
      readFallback(target) { return fallbackKeyring.get(target); },
      writeFallback(target, value) { fallbackKeyring.set(target, Buffer.from(value)); return true; },
    };
    const preservedKey = loadOrCreateLedgerKey(legacyKeyPath, unavailableKeyStore);
    assert.deepStrictEqual(preservedKey, Buffer.alloc(32, 91), "an existing legacy key is never replaced with random bytes");
    assert.deepStrictEqual(loadExistingLedgerKey(legacyKeyPath, unavailableKeyStore), Buffer.alloc(32, 91));
    const providers = createFirstWaveAdapters().map((adapter) => adapter.provider);
    for (const provider of ["openai.chatgpt.app", "anthropic.claude.desktop", "anthropic.cowork", "xai.grok"]) assert.ok(providers.includes(provider));
    const hostIntegrations = listHostIntegrations();
    assert.strictEqual(hostIntegrations.length, 3);
    assert.ok(hostIntegrations.every((item) => item.capabilities.includes("leader")));
    assert.ok(!hostIntegrations.find((item) => item.provider === "openai.chatgpt.app").capabilities.includes("executor"));
    const installation = discoverInstallations();
    assert.ok(installation.some((item) => item.provider === "google.antigravity.ide"));
    assert.ok(installation.some((item) => item.provider === "anthropic.claude.desktop"));
    const originalChatGptUrl = process.env.INTEGRATED_POWER_CHATGPT_MCP_URL;
    const originalAppData = process.env.APPDATA;
    process.env.INTEGRATED_POWER_CHATGPT_MCP_URL = "https://tunnel.invalid/integrated-power/mcp";
    assert.strictEqual(listHostIntegrations().find((item) => item.provider === "openai.chatgpt.app").available, true);
    const claudeAppData = path.join(temp, "claude-appdata");
    fs.mkdirSync(path.join(claudeAppData, "Claude"), { recursive: true });
    fs.writeFileSync(path.join(claudeAppData, "Claude", "claude_desktop_config.json"), JSON.stringify({ mcpServers: { "integrated-power": { command: "node" } } }), "utf8");
    process.env.APPDATA = claudeAppData;
    assert.strictEqual(listHostIntegrations().find((item) => item.provider === "anthropic.claude.desktop").available, true);
    const claudeConfigPath = path.join(claudeAppData, "Claude", "claude_desktop_config.json");
    assert.throws(() => registerClaudeLocalMcp(false, claudeConfigPath), /confirmation/);
    const registration = registerClaudeLocalMcp(true, claudeConfigPath);
    assert.strictEqual(registration.changed, true);
    assert.ok(registration.backupPath && fs.existsSync(registration.backupPath));
    assert.ok(JSON.parse(fs.readFileSync(claudeConfigPath, "utf8")).mcpServers["integrated-power"]);
    if (originalChatGptUrl === undefined) delete process.env.INTEGRATED_POWER_CHATGPT_MCP_URL; else process.env.INTEGRATED_POWER_CHATGPT_MCP_URL = originalChatGptUrl;
    if (originalAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppData;
    const originalStateRoot = process.env.INTEGRATED_POWER_STATE_ROOT;
    process.env.INTEGRATED_POWER_STATE_ROOT = path.join(temp, "host-integrations");
    saveHostIntegrationConfig({ chatgptMcpUrl: "https://tunnel.invalid/mcp" }, true);
    assert.strictEqual(listHostIntegrations().find((item) => item.provider === "openai.chatgpt.app").available, true);
    assert.throws(() => saveHostIntegrationConfig({ chatgptMcpUrl: "http://127.0.0.1/mcp" }, true), /HTTPS/);
    if (originalStateRoot === undefined) delete process.env.INTEGRATED_POWER_STATE_ROOT; else process.env.INTEGRATED_POWER_STATE_ROOT = originalStateRoot;
    const sqlCipherPath = path.join(temp, "sqlcipher", "events.enc.jsonl");
    const sqlLedger = createPreferredEventLedger(sqlCipherPath, Buffer.alloc(32, 5));
    const sqlEvent = (await broker.events(task.id))[0];
    await sqlLedger.append(sqlEvent);
    assert.strictEqual((await sqlLedger.list(task.id)).length, 1);
    assert.strictEqual(sqlLedger instanceof SqlCipherEventLedger, true);
    assert.strictEqual(fs.readFileSync(sqlCipherPath).includes(Buffer.from("task.created")), false);
    sqlLedger.close?.();
    const telemetryRoot = path.join(temp, "telemetry-state");
    const workspaceId = "path-sharedfixture";
    const workspaceState = path.join(telemetryRoot, "workspaces", workspaceId);
    fs.mkdirSync(path.join(workspaceState, ".agent-runs"), { recursive: true });
    fs.mkdirSync(path.join(workspaceState, "reports"), { recursive: true });
    fs.writeFileSync(path.join(workspaceState, ".agent-runs", "runs.jsonl"), [
      JSON.stringify({ id: "shared-api-run", title: "Shared state", status: "running" }),
      "{ malformed",
      JSON.stringify({ id: "shared-api-run", status: "completed" }),
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(workspaceState, "reports", "local_llm_metrics.csv"), 'Timestamp,TaskTitle,Model,TaskScale,ActualElapsedSeconds,TotalTokens,TaskType,Provider,Success,OutputChars,TokensPerSecond,SelectedBy,SelectionReason,ErrorMessage\n2026-10-13T01:00:00Z,"task, one","qwen3.8:27b",large,4.5,28,inference,ollama,true,95,6.2,selector,"selected, preferred",\n', "utf8");
    const previousTelemetryRoot = process.env.INTEGRATED_POWER_STATE_ROOT;
    process.env.INTEGRATED_POWER_STATE_ROOT = telemetryRoot;
    let persistedTaskId;
    let dispatchCount = 0;
    let allowDispatch = true;
    const fakeQuota = {
      antigravityPercentage: 100, antigravityWeeklyPercentage: 80, antigravityResetTime: "2026-10-12T00:00:00.000Z",
      opusPercentage: 100, opusWeeklyPercentage: 80, opusResetTime: "2026-10-12T00:00:00.000Z",
      codexPercentage: 100, codexWeeklyPercentage: 80, codexResetTime: "2026-10-12T00:00:00.000Z",
      lastSync: new Date().toISOString(),
    };
    const httpServer = await startBrokerServer(broker, 0, {
      stateRoot: telemetryRoot,
      autoSchedule: false,
      tokenStatusReader: async () => fakeQuota,
      prewarmDispatcher: async () => { dispatchCount++; return { spawned: allowDispatch }; },
    });
    try {
      const health = await fetch(`http://127.0.0.1:${httpServer.port}/health`).then((response) => response.json());
      assert.strictEqual(health.ok, true);
      assert.strictEqual(health.schemaVersion, 2);
      assert.ok(health.capabilities.includes("runs.read"));
      const quotaSettingsUrl = `http://127.0.0.1:${httpServer.port}/v1/settings/quota`;
      const initialSettings = await fetch(quotaSettingsUrl).then((response) => response.json());
      assert.strictEqual(initialSettings.initialized, false);
      const seededSettings = {
        pollIntervalMs: 7000,
        notifyOnFull: false,
        prewarmModes: { antigravity: "once", opus: "click", codex: "always" },
        notifications: { antigravityGemini5h: false, claudeWeekly: false },
      };
      const settingsWrite = { expectedRevision: 0, initializeFrom: "ide", idempotencyKey: "settings-seed-1", settings: seededSettings };
      const settingsSaved = await fetch(quotaSettingsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(settingsWrite) });
      assert.strictEqual(settingsSaved.status, 200);
      const settingsSnapshot = await settingsSaved.json();
      assert.strictEqual(settingsSnapshot.settings.notifyOnFull, false);
      assert.strictEqual(settingsSnapshot.settings.notifications.antigravityGemini5h, false);
      assert.strictEqual(settingsSnapshot.settings.notifications.chatgptWeekly, true);
      const settingsRetry = await fetch(quotaSettingsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(settingsWrite) });
      assert.deepStrictEqual(await settingsRetry.json(), settingsSnapshot, "idempotent settings retry returns the original save result");
      const prewarmBody = { model: "antigravity", manual: false, expectedSettingsRevision: 1, idempotencyKey: "auto-once-window-a" };
      const [prewarmResponseA, prewarmResponseB] = await Promise.all([
        fetch(`http://127.0.0.1:${httpServer.port}/v1/tokens/prewarm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(prewarmBody) }),
        fetch(`http://127.0.0.1:${httpServer.port}/v1/tokens/prewarm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...prewarmBody, idempotencyKey: "auto-once-window-b" }) }),
      ]);
      const prewarmResults = await Promise.all([prewarmResponseA.json(), prewarmResponseB.json()]);
      assert.deepStrictEqual(prewarmResults.map((item) => item.status).sort(), ["dispatched", "duplicate"]);
      assert.strictEqual(prewarmResults.every((item) => item.timerConfirmed === false), true);
      assert.strictEqual(dispatchCount, 1, "two clients in one quota window cause one prewarm dispatch");
      const afterOnce = await fetch(quotaSettingsUrl).then((response) => response.json());
      assert.strictEqual(afterOnce.settings.prewarmModes.antigravity, "click", "successful Once dispatch resets the shared mode");
      assert.strictEqual(afterOnce.revision, 2);
      const armFailedOnce = await fetch(quotaSettingsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 2, idempotencyKey: "settings-opus-once", settings: { ...afterOnce.settings, prewarmModes: { ...afterOnce.settings.prewarmModes, opus: "once" } } }) });
      assert.strictEqual(armFailedOnce.status, 200);
      allowDispatch = false;
      const failedPrewarm = await fetch(`http://127.0.0.1:${httpServer.port}/v1/tokens/prewarm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "opus", manual: false, expectedSettingsRevision: 3, idempotencyKey: "opus-once-failed" }) }).then((response) => response.json());
      assert.strictEqual(failedPrewarm.status, "failed");
      assert.strictEqual((await fetch(quotaSettingsUrl).then((response) => response.json())).settings.prewarmModes.opus, "once", "failed dispatch leaves Once armed");
      const staleSettings = await fetch(quotaSettingsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settingsWrite, idempotencyKey: "settings-stale-1", settings: { ...seededSettings, pollIntervalMs: 9000 } }) });
      assert.strictEqual(staleSettings.status, 409);
      const staleSettingsBody = await staleSettings.json();
      assert.strictEqual(staleSettingsBody.revision, 3);
      assert.strictEqual(staleSettingsBody.settings.pollIntervalMs, 7000);
      const partialSettings = await fetch(quotaSettingsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 3, idempotencyKey: "settings-partial-notify", settings: { notifyOnFull: true } }) }).then((response) => response.json());
      assert.strictEqual(partialSettings.settings.notifyOnFull, true);
      assert.strictEqual(partialSettings.settings.notifications.antigravityGemini5h, false, "partial save preserves another target's disabled notification");
      assert.strictEqual(partialSettings.settings.notifications.claudeWeekly, false, "partial save preserves an unrelated disabled notification");
      assert.strictEqual(partialSettings.settings.prewarmModes.opus, "once", "partial save preserves an armed prewarm mode");
      assert.strictEqual(partialSettings.settings.pollIntervalMs, 7000);
      process.env.INTEGRATED_POWER_STATE_ROOT = path.join(temp, "different-process-default");
      const workspaces = await fetch(`http://127.0.0.1:${httpServer.port}/v1/workspaces`).then((response) => response.json());
      assert.deepStrictEqual(workspaces.workspaces.map((item) => item.workspaceId), [workspaceId]);
      const runsResponse = await fetch(`http://127.0.0.1:${httpServer.port}/v1/runs?workspaceId=${workspaceId}`);
      assert.strictEqual(runsResponse.status, 200);
      const runsBody = await runsResponse.json();
      assert.strictEqual(runsBody.ok, true);
      assert.strictEqual(runsBody.activeCount, 0);
      assert.strictEqual(runsBody.runs[0].status, "completed");
      assert.strictEqual(runsBody.errors.length, 1);
      assert.strictEqual(runsBody.workspaceId, workspaceId);
      const metricsResponse = await fetch(`http://127.0.0.1:${httpServer.port}/v1/metrics/local-llm?workspaceId=${workspaceId}`);
      assert.strictEqual(metricsResponse.status, 200);
      const metricsBody = await metricsResponse.json();
      assert.strictEqual(metricsBody.metrics[0].taskTitle, "task, one");
      assert.strictEqual(metricsBody.ok, true);
      const missingMetrics = await fetch(`http://127.0.0.1:${httpServer.port}/v1/metrics/local-llm?workspaceId=path-missingfixture`);
      assert.strictEqual(missingMetrics.status, 404);
      assert.strictEqual((await missingMetrics.json()).ok, false, "missing metrics must not be reported as an empty success");
      process.env.INTEGRATED_POWER_STATE_ROOT = telemetryRoot;
      const client = new BrokerClient(() => httpServer.port);
      const clientHealth = await client.health();
      assert.ok(clientHealth.capabilities.includes("approvals.userDecision"));
      const clientWorkspaces = await client.listWorkspaces();
      assert.strictEqual(clientWorkspaces.workspaces[0].workspaceId, workspaceId);
      const scopedTask = await client.createTask({ title: "scoped UI task", goal: "verify workspace scoping", originProvider: "google.antigravity.ide", workspacePath: temp });
      persistedTaskId = scopedTask.id;
      const scopedTaskDetails = await client.getTaskDetails(scopedTask.id, { workspacePath: temp });
      assert.strictEqual(scopedTaskDetails.task.id, scopedTask.id);
      assert.ok(scopedTaskDetails.events.some((event) => event.type === "task.created"));
      const clientWorkspacesAfterTask = await client.listWorkspaces();
      assert.ok(clientWorkspacesAfterTask.workspaces.some((item) => item.workspaceId === scopedTaskDetails.workspaceId), "task workspaces appear even before a telemetry directory exists");
      assert.ok(clientWorkspacesAfterTask.workspaces.every((item) => !("workspacePath" in item)), "workspace discovery does not disclose paths");
      await assert.rejects(client.getTaskDetails(scopedTask.id, { workspaceId }), /404.*task_not_found/i, "task detail must not leak across workspace scopes");
      assert.strictEqual((await client.listTasks({ workspacePath: temp })).tasks.some((item) => item.id === scopedTask.id), true);
      assert.strictEqual((await client.listTasks({ workspaceId })).tasks.some((item) => item.id === scopedTask.id), false);
      const delegated = await client.delegateTask({ taskId: scopedTask.id, provider: "google.antigravity.ide", prompt: "review", expectedRevision: scopedTask.revision, idempotencyKey: "http-approval-delegate" });
      assert.strictEqual(delegated.type, "task.delegated");
      const delegatedTask = (await client.listTasks({ workspacePath: temp })).tasks.find((item) => item.id === scopedTask.id);
      const approval = await client.requestApproval({ taskId: scopedTask.id, action: "merge", description: "user review", requestedBy: "user", expectedRevision: delegatedTask.revision });
      assert.strictEqual((await client.listApprovals({ workspacePath: temp })).approvals.some((item) => item.id === approval.id), true);
      const queuedApproval = (await client.listApprovals({ workspacePath: temp })).approvals.find((item) => item.id === approval.id);
      assert.strictEqual(approval.requestedRevision, delegatedTask.revision);
      assert.strictEqual(queuedApproval.expectedRevision, delegatedTask.revision + 1);
      assert.strictEqual((await client.getTaskDetails(scopedTask.id, { workspacePath: temp })).task.revision, queuedApproval.expectedRevision);
      await client.approve(approval.id, queuedApproval.expectedRevision);
      assert.strictEqual((await client.listApprovals({ workspacePath: temp })).approvals.some((item) => item.id === approval.id), false);
      const card = await fetch(`http://127.0.0.1:${httpServer.port}/.well-known/agent-card.json`).then((response) => response.json());
      assert.strictEqual(card.supportedInterfaces[0].protocolBinding, "HTTP+JSON");
      const integrations = await fetch(`http://127.0.0.1:${httpServer.port}/v1/integrations`).then((response) => response.json());
      assert.strictEqual(integrations.integrations.length, 3);
      const chatgptSpec = await fetch(`http://127.0.0.1:${httpServer.port}/v1/integrations/chatgpt/spec`).then((response) => response.json());
      assert.ok(chatgptSpec.spec && chatgptSpec.snippet && chatgptSpec.snippet.mcpServers["integrated-power"]);
      const mcpSpec = await fetch(`http://127.0.0.1:${httpServer.port}/v1/integrations/mcp/spec`).then((response) => response.json());
      assert.ok(mcpSpec.spec && mcpSpec.snippet);
      const installationResponse = await fetch(`http://127.0.0.1:${httpServer.port}/v1/installation`).then((response) => response.json());
      assert.ok(installationResponse.installations.length >= 5);
      const mcpResponse = await fetch(`http://127.0.0.1:${httpServer.port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) }).then((response) => response.json());
      assert.strictEqual(mcpResponse.result.protocolVersion, "2025-06-18");
      const stream = await fetch(`http://127.0.0.1:${httpServer.port}/v1/tasks/${encodeURIComponent(task.id)}/stream`);
      assert.strictEqual(stream.headers.get("x-ag-ui-version"), "1");
      const streamText = await stream.text();
      assert.ok(streamText.includes("RUN_STARTED") && streamText.includes("RUN_FINISHED"));

      // --- /v1/providers/external: broker-side fetch of a user-registered URL ---
      // The UI registers arbitrary http(s) endpoints; the broker fetches them
      // server-side so the browser's CORS never applies. We point it at a local
      // upstream that speaks the external quota wire format.
      const upstream = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/usage") {
          res.end(JSON.stringify({ windows: [{ label: "5Hours", remainingPercentage: 82 }, { label: "Weekly", usedPercentage: 30 }] }));
        } else if (req.url === "/plain") {
          res.end("not json at all");
        } else {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "boom" }));
        }
      });
      await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
      const upPort = upstream.address().port;
      try {
        const okRes = await fetch(`http://127.0.0.1:${httpServer.port}/v1/providers/external?url=${encodeURIComponent(`http://127.0.0.1:${upPort}/usage`)}`);
        assert.strictEqual(okRes.status, 200);
        const okJson = await okRes.json();
        assert.strictEqual(okJson.upstreamStatus, 200);
        assert.strictEqual(okJson.payload.windows[0].remainingPercentage, 82);

        const textRes = await fetch(`http://127.0.0.1:${httpServer.port}/v1/providers/external?url=${encodeURIComponent(`http://127.0.0.1:${upPort}/plain`)}`);
        assert.strictEqual(textRes.status, 200);
        const textJson = await textRes.json();
        assert.strictEqual(textJson.payload.raw, "not json at all");

        const upstreamErr = await fetch(`http://127.0.0.1:${httpServer.port}/v1/providers/external?url=${encodeURIComponent(`http://127.0.0.1:${upPort}/bad`)}`);
        assert.strictEqual(upstreamErr.status, 502);

        const badProtocol = await fetch(`http://127.0.0.1:${httpServer.port}/v1/providers/external?url=${encodeURIComponent("ftp://nope/x")}`);
        assert.strictEqual(badProtocol.status, 400);

        const noUrl = await fetch(`http://127.0.0.1:${httpServer.port}/v1/providers/external`);
        assert.strictEqual(noUrl.status, 400);
      } finally {
        await new Promise((resolve) => upstream.close(resolve));
      }
    } finally {
      await httpServer.close();
      if (previousTelemetryRoot === undefined) delete process.env.INTEGRATED_POWER_STATE_ROOT; else process.env.INTEGRATED_POWER_STATE_ROOT = previousTelemetryRoot;
    }
    {
      const schedulerRoot = path.join(temp, "broker-owned-scheduler");
      const scheduledBroker = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(schedulerRoot, "broker", "events.enc.jsonl"), Buffer.alloc(32, 44)), []);
      await scheduledBroker.initialize();
      let scheduledDispatches = 0;
      const schedulerServer = await startBrokerServer(scheduledBroker, 0, {
        stateRoot: schedulerRoot,
        tokenStatusReader: async () => fakeQuota,
        prewarmDispatcher: async () => { scheduledDispatches++; return { spawned: true }; },
      });
      try {
        const schedulerBase = `http://127.0.0.1:${schedulerServer.port}`;
        const schedulerSettings = await fetch(`${schedulerBase}/v1/settings/quota`).then((response) => response.json());
        const schedulerSave = await fetch(`${schedulerBase}/v1/settings/quota`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: schedulerSettings.revision, initializeFrom: "ide", idempotencyKey: "scheduler-once-seed", settings: { pollIntervalMs: 1000, prewarmModes: { antigravity: "once", opus: "click", codex: "click" } } }) });
        assert.strictEqual(schedulerSave.status, 200);
        const deadline = Date.now() + 3500;
        while (!scheduledDispatches && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
        assert.strictEqual(scheduledDispatches, 1, "broker-owned scheduler dispatches an armed Once window without an IDE client");
        const schedulerAfter = await fetch(`${schedulerBase}/v1/settings/quota`).then((response) => response.json());
        assert.strictEqual(schedulerAfter.settings.prewarmModes.antigravity, "click", "headless scheduler consumes Once only after spawn");
      } finally {
        await schedulerServer.close();
      }
    }
    const afterHttpRestart = new IntegratedPowerBroker(new EncryptedEventLedger(path.join(temp, "events.enc.jsonl"), Buffer.alloc(32, 7)), createFirstWaveAdapters());
    await afterHttpRestart.initialize();
    assert.strictEqual(afterHttpRestart.getTask(persistedTaskId).title, "scoped UI task", "HTTP-created task state survives broker reconstruction from the same ledger");

    // --- /v1/tokens/status: schema passthrough + ?force=1 -------------------
    // The broker must surface the original token_status.json fields (absolute
    // token counts, quota pools with source/confidence, endpoint health, Claude
    // direct-usage status/sources, errors) instead of collapsing them. And
    // ?force=1 must trigger the in-process live IDE refresh hook before
    // re-reading the state file.
    const stateRoot = path.join(temp, "token-state");
    const stateDir = path.join(stateRoot, "IntegratedPower", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const tokenFile = path.join(stateDir, "token_status.json");
    const baseFixture = {
      antigravityTokensLeft: 12345,
      antigravityMax: 50000,
      antigravityWeeklyTokensLeft: 999,
      antigravityWeeklyMax: 1000,
      antigravityEstimatedAbsolute: 4321,
      opusEstimatedAbsolute: 777,
      opusWeeklyEstimatedAbsolute: 888,
      codexTokensLeft: 111,
      codexMax: 500,
      codexWeeklyTokensLeft: 222,
      codexWeeklyMax: 500,
      codexEstimatedAbsolute: 333,
      codexWeeklyEstimatedAbsolute: 444,
      codexStatus: "working",
      lastSync: new Date().toISOString(),
      errors: ["telemetry hiccup"],
      quotaPools: [
        { id: "codex.5h", provider: "codex", remainingPercentage: 100, resetTime: "2026-09-01T14:41:19.000Z", source: "cli-json", confidence: "reported-quota" },
        { id: "antigravity.default", provider: "antigravity", remainingPercentage: 91.3, resetTime: "2026-09-02T06:09:28Z", source: "cli-text", confidence: "reported-quota" },
      ],
      localComputeStatus: {
        endpointHealth: "ok",
        programName: "Ollama",
        loadedModels: ["qwen3.8:27b"],
        gpus: [{ id: 0, name: "Test GPU", utilizationPercentage: 5, vramUsedMb: 1000, vramTotalMb: 8000 }],
      },
      claudeDirectUsage: {
        status: "measured",
        today: { totalTokens: 10, billableTokens: 4, eventCount: 1 },
        sevenDays: { totalTokens: 20, billableTokens: 8, eventCount: 2 },
        sources: ["claude-cli"],
        lastMeasuredAt: "2026-09-02T01:29:30.260Z",
        errors: [],
      },
      activity: ["Token manager initialized."],
    };
    fs.writeFileSync(tokenFile, JSON.stringify(baseFixture), "utf8");
    const savedLocalAppData = process.env.LOCALAPPDATA;
    const savedStateRootEnv = process.env.INTEGRATED_POWER_STATE_ROOT;
    process.env.LOCALAPPDATA = stateRoot;
    process.env.INTEGRATED_POWER_STATE_ROOT = stateDir;
    let forceHandlerCalls = 0;
    try {
      const { setForceRefreshHandler, startBrokerServer: startTokenServer } = require("../out/broker");
      const standaloneTokenServer = await startTokenServer(broker, 0);
      try {
        const standaloneForce = await fetch(`http://127.0.0.1:${standaloneTokenServer.port}/v1/tokens/status?force=1`).then((r) => r.json());
        assert.strictEqual(standaloneForce.forced, false, "an unavailable in-process refresh must not be reported as successful");
        assert.strictEqual(standaloneForce.tokenStatus.lastSync, baseFixture.lastSync, "reading fresh token state must preserve its source measurement timestamp");
      } finally {
        await standaloneTokenServer.close();
      }
      let injectedReaderCalls = 0;
      const injectedTokenServer = await startTokenServer(broker, 0, {
        stateRoot: path.join(stateRoot, "injected-reader"),
        tokenStatusReader: async () => { injectedReaderCalls++; return { marker: "injected-fake-status" }; },
      });
      try {
        const injected = await fetch(`http://127.0.0.1:${injectedTokenServer.port}/v1/tokens/status?force=1`).then((r) => r.json());
        assert.deepStrictEqual(injected.tokenStatus, { marker: "injected-fake-status" }, "HTTP token status must use the injected reader instead of the production scanner");
        assert.strictEqual(injectedReaderCalls, 1, "HTTP force reads should use the injected fake provider exactly once");
        assert.strictEqual(forceHandlerCalls, 0, "injected readers must not invoke the IDE force-refresh hook");
      } finally {
        await injectedTokenServer.close();
      }
      setForceRefreshHandler(async () => {
        forceHandlerCalls++;
        // Simulate the live IDE re-probing and rewriting the state file. Codex
        // percentage is derived from quotaPools, so rewrite that pool too.
        fs.writeFileSync(
          tokenFile,
          JSON.stringify({
            ...baseFixture,
            lastSync: new Date().toISOString(),
            codexPercentage: 55,
            codexTokensLeft: 777,
            quotaPools: baseFixture.quotaPools.map((p) =>
              p.id === "codex.5h" ? { ...p, remainingPercentage: 55 } : p,
            ),
          }),
          "utf8",
        );
      });
      const tokenServer = await startTokenServer(broker, 0);
      try {
        const normal = await fetch(`http://127.0.0.1:${tokenServer.port}/v1/tokens/status`).then((r) => r.json());
        assert.strictEqual(normal.ok, true);
        assert.strictEqual(normal.forced, false);
        assert.strictEqual(normal.tokenStatus.lastSync, baseFixture.lastSync);
        const ts = normal.tokenStatus;
        // Absolute token passthrough
        assert.strictEqual(ts.antigravityTokensLeft, 12345);
        assert.strictEqual(ts.antigravityMax, 50000);
        assert.strictEqual(ts.antigravityEstimatedAbsolute, 4321);
        assert.strictEqual(ts.opusEstimatedAbsolute, 777);
        assert.strictEqual(ts.codexTokensLeft, 111);
        assert.strictEqual(ts.codexWeeklyEstimatedAbsolute, 444);
        // codexStatus passthrough
        assert.strictEqual(ts.codexStatus, "working");
        // quota pools keep source/confidence
        assert.ok(Array.isArray(ts.quotaPools));
        const agyPool = ts.quotaPools.find((p) => p.id === "antigravity.default");
        assert.strictEqual(agyPool.source, "cli-text");
        assert.strictEqual(agyPool.confidence, "reported-quota");
        // endpoint health / loaded models / program name
        assert.strictEqual(ts.localComputeStatus.endpointHealth, "ok");
        assert.deepStrictEqual(ts.localComputeStatus.loadedModels, ["qwen3.8:27b"]);
        assert.strictEqual(ts.localComputeStatus.programName, "Ollama");
        // Claude direct usage status/sources
        assert.strictEqual(ts.directUsage.status, "measured");
        assert.deepStrictEqual(ts.directUsage.sources, ["claude-cli"]);
        assert.strictEqual(ts.directUsage.lastMeasuredAt, "2026-09-02T01:29:30.260Z");
        // top-level errors passthrough
        assert.deepStrictEqual(ts.errors, ["telemetry hiccup"]);

        const forced = await fetch(`http://127.0.0.1:${tokenServer.port}/v1/tokens/status?force=1`).then((r) => r.json());
        assert.strictEqual(forced.ok, true);
        assert.strictEqual(forced.forced, true);
        assert.strictEqual(forceHandlerCalls, 1);
        // The handler rewrote the file; the broker re-read it (codex now 55/777).
        assert.strictEqual(forced.tokenStatus.codexPercentage, 55);
        assert.strictEqual(forced.tokenStatus.codexTokensLeft, 777);
        assert.ok(Date.parse(forced.tokenStatus.lastSync) >= Date.parse(baseFixture.lastSync));
      } finally {
        await tokenServer.close();
        setForceRefreshHandler(undefined);
      }
    } finally {
      if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = savedLocalAppData;
      if (savedStateRootEnv === undefined) delete process.env.INTEGRATED_POWER_STATE_ROOT; else process.env.INTEGRATED_POWER_STATE_ROOT = savedStateRootEnv;
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
    console.log("broker tests passed");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
