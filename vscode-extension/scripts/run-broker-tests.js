const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
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
  createFirstWaveAdapters,
  listHostIntegrations,
  discoverInstallations,
  registerClaudeLocalMcp,
  saveHostIntegrationConfig,
  createPreferredEventLedger,
  SqlCipherEventLedger,
} = require("../out/broker");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "integrated-power-broker-"));
  try {
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
    const firstKey = loadOrCreateLedgerKey(keyPath);
    const secondKey = loadOrCreateLedgerKey(keyPath);
    assert.strictEqual(firstKey.length, 32);
    assert.strictEqual(firstKey.equals(secondKey), true);
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
    const httpServer = await startBrokerServer(broker, 0);
    try {
      const health = await fetch(`http://127.0.0.1:${httpServer.port}/health`).then((response) => response.json());
      assert.strictEqual(health.ok, true);
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
    } finally {
      await httpServer.close();
    }
    console.log("broker tests passed");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
