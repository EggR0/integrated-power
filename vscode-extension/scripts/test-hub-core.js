// test-hub-core.js - Comprehensive Hub Core Integration Test Suite
// Verifies:
// 1. startBrokerServer with isolated temp stateRoot
// 2. All /v1/hub/* HTTP endpoints
// 3. All 4 Hub MCP tools via processMcpRequest
// 4. Guard 1: Clarification required guard before dispatch
// 5. Guard 2: Strictly local privacy firewall -> local.openai-compatible
// 6. Guard 3: Manual GCP credit lock -> no agya without allowManualCredit
// 7. Guard 4: Quota cascading (<15%) and playbook context injection
// 8. Bidirectional Markdown sync checklist states and ^tsk-xxxx block IDs

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const {
  EncryptedEventLedger,
  IntegratedPowerBroker,
  loadOrCreateLedgerKey,
  startBrokerServer,
  processMcpRequest,
} = require("../out/broker");

async function run() {
  console.log("=== Leaf Alpha-3: Hub Core Integration Tests ===");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ip-hub-test-"));
  console.log(`Using isolated state root: ${tempDir}`);

  const mockAdapters = [
    {
      provider: "local.openai-compatible",
      async discover() {
        return {
          provider: "local.openai-compatible",
          available: true,
          mode: "local",
          capabilities: ["code-write", "plan"],
        };
      },
      async submit(task, prompt) {
        return { provider: "local.openai-compatible", text: "local executed: " + prompt };
      },
      async cancel() {},
    },
    {
      provider: "openai.codex.app",
      async discover() {
        return {
          provider: "openai.codex.app",
          available: true,
          mode: "cli",
          capabilities: ["code-write", "plan"],
        };
      },
      async submit(task, prompt) {
        return { provider: "openai.codex.app", text: "codex executed: " + prompt };
      },
      async cancel() {},
    },
    {
      provider: "google.antigravity.ide",
      async discover() {
        return {
          provider: "google.antigravity.ide",
          available: true,
          mode: "cli",
          capabilities: ["code-write", "plan"],
        };
      },
      async submit(task, prompt) {
        return { provider: "google.antigravity.ide", text: "agy executed: " + prompt };
      },
      async cancel() {},
    },
  ];

  const ledgerKey = loadOrCreateLedgerKey(path.join(tempDir, "ledger.key"));
  const ledger = new EncryptedEventLedger(path.join(tempDir, "ledger.db"), ledgerKey);
  const broker = new IntegratedPowerBroker(ledger, mockAdapters);
  await broker.initialize();

  let liveQuota = {
    codexPercentage: 80,
    antigravityPercentage: 80,
  };

  const server = await startBrokerServer(broker, 0, {
    stateRoot: tempDir,
    autoSchedule: false,
    tokenStatusReader: async () => liveQuota,
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;
  console.log(`Ephemeral Broker Server listening on: ${baseUrl}`);

  try {
    // -----------------------------------------------------------------------
    // Test 1: Broker capabilities include hub features
    // -----------------------------------------------------------------------
    console.log("\n[Test 1] Verifying Broker Capabilities...");
    const health = await fetch(`${baseUrl}/health`).then((r) => r.json());
    assert.strictEqual(health.ok, true, "Health endpoint should return ok");
    assert.ok(health.capabilities.includes("hub.read"), "Capabilities must include hub.read");
    assert.ok(health.capabilities.includes("hub.write"), "Capabilities must include hub.write");
    assert.ok(health.capabilities.includes("hub.dispatch"), "Capabilities must include hub.dispatch");
    console.log("  ✓ Capabilities verified: hub.read, hub.write, hub.dispatch present.");

    // -----------------------------------------------------------------------
    // Test 2: HTTP Endpoints: /v1/hub/overview, /v1/hub/ecosystem, /v1/hub/config
    // -----------------------------------------------------------------------
    console.log("\n[Test 2] Testing /v1/hub/overview, /ecosystem, /config...");
    const overview = await fetch(`${baseUrl}/v1/hub/overview`).then((r) => r.json());
    assert.strictEqual(overview.schemaVersion, 1, "Overview schemaVersion must be 1");
    assert.ok(overview.config, "Overview must have config");
    assert.ok(overview.ecosystem, "Overview must have ecosystem");
    assert.ok(Array.isArray(overview.todos), "Overview must have todos array");
    assert.ok(Array.isArray(overview.playbooks), "Overview must have playbooks array");

    const ecosystem = await fetch(`${baseUrl}/v1/hub/ecosystem`).then((r) => r.json());
    assert.ok(Array.isArray(ecosystem.connectors), "Ecosystem must have connectors list");
    assert.ok(Array.isArray(ecosystem.vaults), "Ecosystem must have vaults list");

    const config = await fetch(`${baseUrl}/v1/hub/config`).then((r) => r.json());
    assert.strictEqual(typeof config.autoSyncMarkdown, "boolean");

    // Update config via PUT
    const updatedConfig = await fetch(`${baseUrl}/v1/hub/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoSyncMarkdown: true }),
    }).then((r) => r.json());
    assert.strictEqual(updatedConfig.autoSyncMarkdown, true, "autoSyncMarkdown should be updated");
    console.log("  ✓ /v1/hub/overview, /ecosystem, /config endpoints responding correctly.");

    // -----------------------------------------------------------------------
    // Test 3: HTTP Endpoints: /v1/hub/playbooks (GET & POST)
    // -----------------------------------------------------------------------
    console.log("\n[Test 3] Testing /v1/hub/playbooks...");
    const playbooksRes = await fetch(`${baseUrl}/v1/hub/playbooks`).then((r) => r.json());
    assert.ok(Array.isArray(playbooksRes.playbooks), "Playbooks array required");

    const savedPlaybookRes = await fetch(`${baseUrl}/v1/hub/playbooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "architecture",
        label: "Architecture & Systems Design",
        episodic: [],
        semantic: [{ id: "sem-1", preference: "Prefer modular controllers", rationale: "Clean cohesion", recordedAt: new Date().toISOString() }],
        procedural: [{ id: "pro-1", trigger: "Adding new route", rule: "Mount under /v1 namespace", recordedAt: new Date().toISOString() }],
        updatedAt: new Date().toISOString(),
      }),
    }).then((r) => r.json());
    assert.strictEqual(savedPlaybookRes.ok, true);
    assert.strictEqual(savedPlaybookRes.playbook.category, "architecture");
    console.log("  ✓ /v1/hub/playbooks GET & POST verified.");

    // -----------------------------------------------------------------------
    // Test 4: HTTP Endpoints: /v1/hub/ingest, /v1/hub/todos, /v1/hub/todos/sync
    // -----------------------------------------------------------------------
    console.log("\n[Test 4] Testing /v1/hub/ingest & /v1/hub/todos/sync...");
    const ingestRes = await fetch(`${baseUrl}/v1/hub/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Optimize SQLite ledger write performance #performance",
        categoryOverride: "performance",
      }),
    });
    assert.strictEqual(ingestRes.status, 201);
    const ingestBody = await ingestRes.json();
    assert.strictEqual(ingestBody.ok, true);
    assert.ok(ingestBody.todo.id);
    assert.ok(ingestBody.todo.blockId);
    assert.strictEqual(ingestBody.todo.category, "performance");

    const todosList = await fetch(`${baseUrl}/v1/hub/todos`).then((r) => r.json());
    assert.ok(todosList.todos.some((t) => t.id === ingestBody.todo.id), "Ingested todo must appear in /v1/hub/todos");

    const syncRes = await fetch(`${baseUrl}/v1/hub/todos/sync`, { method: "POST" }).then((r) => r.json());
    assert.strictEqual(syncRes.ok, true, "Sync endpoint must return ok: true");
    console.log("  ✓ /v1/hub/ingest & /todos/sync verified.");

    // -----------------------------------------------------------------------
    // Test 5: All 4 MCP Tools via processMcpRequest
    // -----------------------------------------------------------------------
    console.log("\n[Test 5] Testing all 4 Hub MCP Tools via processMcpRequest...");

    // Tool 1: integrated_power_hub_overview
    const mcpOverview = await processMcpRequest(broker, {
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: { name: "integrated_power_hub_overview", arguments: { forceRefresh: true } },
    });
    assert.strictEqual(mcpOverview.jsonrpc, "2.0");
    assert.strictEqual(mcpOverview.result.structuredContent.schemaVersion, 1);
    console.log("  ✓ MCP integrated_power_hub_overview succeeded.");

    // Tool 2: integrated_power_hub_ingest
    const mcpIngest = await processMcpRequest(broker, {
      jsonrpc: "2.0",
      id: 102,
      method: "tools/call",
      params: {
        name: "integrated_power_hub_ingest",
        arguments: { text: "Audit memory usage in long-running broker #core", categoryOverride: "core" },
      },
    });
    const ingestedViaMcp = mcpIngest.result.structuredContent;
    assert.ok(ingestedViaMcp.id);
    assert.strictEqual(ingestedViaMcp.category, "core");
    console.log("  ✓ MCP integrated_power_hub_ingest succeeded.");

    // Tool 3: integrated_power_hub_clarify
    const mcpClarify = await processMcpRequest(broker, {
      jsonrpc: "2.0",
      id: 103,
      method: "tools/call",
      params: {
        name: "integrated_power_hub_clarify",
        arguments: {
          id: ingestedViaMcp.id,
          answers: [{ question: "Which metrics?", answer: "VRAM and Heap RSS" }],
          learnedPreference: "Always track RSS and VRAM together",
        },
      },
    });
    const clarifiedViaMcp = mcpClarify.result.structuredContent;
    assert.strictEqual(clarifiedViaMcp.id, ingestedViaMcp.id);
    assert.strictEqual(clarifiedViaMcp.status, "ready");
    console.log("  ✓ MCP integrated_power_hub_clarify succeeded.");

    // Tool 4: integrated_power_hub_dispatch
    const mcpDispatch = await processMcpRequest(broker, {
      jsonrpc: "2.0",
      id: 104,
      method: "tools/call",
      params: {
        name: "integrated_power_hub_dispatch",
        arguments: { id: clarifiedViaMcp.id, preferredProvider: "openai.codex.app" },
      },
    });
    const dispatchedViaMcp = mcpDispatch.result.structuredContent;
    assert.strictEqual(dispatchedViaMcp.todo.id, clarifiedViaMcp.id);
    assert.strictEqual(dispatchedViaMcp.todo.status, "in_progress");
    assert.ok(dispatchedViaMcp.task, "Broker task should be created on dispatch");
    console.log("  ✓ MCP integrated_power_hub_dispatch succeeded.");

    // -----------------------------------------------------------------------
    // Test 6: Guard 1: Clarification Required Before Dispatch
    // -----------------------------------------------------------------------
    console.log("\n[Test 6] Testing Guard 1 (Clarification Required Guard)...");
    const ambiguousTodo = await broker.hubController.ingestTodo({
      text: "Do some stuff soon",
      categoryOverride: "general",
    });
    // Set status to needs_clarification
    ambiguousTodo.status = "needs_clarification";

    let guard1Caught = false;
    try {
      await fetch(`${baseUrl}/v1/hub/todos/${encodeURIComponent(ambiguousTodo.id)}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredProvider: "openai.codex.app" }),
      }).then(async (r) => {
        const data = await r.json();
        if (r.status >= 400 || data.error) {
          throw new Error(data.error || "Clarification required error");
        }
      });
    } catch (err) {
      guard1Caught = true;
      assert.ok(err.message.includes("clarification"), `Error must mention clarification: ${err.message}`);
    }
    assert.strictEqual(guard1Caught, true, "Dispatching a needs_clarification item MUST fail");
    console.log("  ✓ Guard 1 passed: Disallow dispatch when clarification is required.");

    // -----------------------------------------------------------------------
    // Test 7: Guard 2: Strictly Local Privacy Firewall
    // -----------------------------------------------------------------------
    console.log("\n[Test 7] Testing Guard 2 (Privacy Firewall: strictly_local -> local.openai-compatible)...");
    const privateTodo = await broker.hubController.ingestTodo({
      text: "Migrate private secret credentials",
      categoryOverride: "private",
    });
    privateTodo.privacyTier = "strictly_local";
    privateTodo.status = "ready";

    const guard2Res = await fetch(`${baseUrl}/v1/hub/todos/${encodeURIComponent(privateTodo.id)}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredProvider: "openai.codex.app" }),
    }).then((r) => r.json());

    assert.strictEqual(guard2Res.ok, true);
    assert.strictEqual(
      guard2Res.todo.assignedRoute,
      "local.openai-compatible",
      "strictly_local item MUST be assigned to local.openai-compatible regardless of preferredProvider"
    );
    assert.strictEqual(
      guard2Res.task.recommendedProvider,
      "local.openai-compatible",
      "Task recommendedProvider must be strictly local"
    );
    console.log("  ✓ Guard 2 passed: strictly_local privacy tier routed strictly to local model.");

    // -----------------------------------------------------------------------
    // Test 8: Guard 3: Manual GCP Credit Lock (Never agya without allowManualCredit)
    // -----------------------------------------------------------------------
    console.log("\n[Test 8] Testing Guard 3 (Manual GCP Credit Lock)...");
    const gcpTodo = await broker.hubController.ingestTodo({
      text: "Heavy lifting code migration task",
      categoryOverride: "core",
      allowManualCredit: false,
    });
    gcpTodo.status = "ready";

    // Request google.antigravity.ide without manual credit allowance
    const guard3Res = await fetch(`${baseUrl}/v1/hub/todos/${encodeURIComponent(gcpTodo.id)}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredProvider: "google.antigravity.ide" }),
    }).then((r) => r.json());

    assert.strictEqual(guard3Res.ok, true);
    assert.strictEqual(
      guard3Res.todo.assignedRoute,
      "openai.codex.app",
      "Requesting google.antigravity.ide without allowManualCredit must redirect away from agya (to codex)"
    );

    // Now permit manual credit and verify agya is allowed
    const gcpAllowedTodo = await broker.hubController.ingestTodo({
      text: "Heavy lifting code migration with explicit credit allowance",
      categoryOverride: "core",
      allowManualCredit: true,
    });
    gcpAllowedTodo.status = "ready";

    const guard3AllowedRes = await fetch(`${baseUrl}/v1/hub/todos/${encodeURIComponent(gcpAllowedTodo.id)}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredProvider: "google.antigravity.ide" }),
    }).then((r) => r.json());

    assert.strictEqual(guard3AllowedRes.ok, true);
    assert.strictEqual(
      guard3AllowedRes.todo.assignedRoute,
      "google.antigravity.ide",
      "Requesting google.antigravity.ide with allowManualCredit: true must be honored"
    );
    console.log("  ✓ Guard 3 passed: Manual GCP Credit Lock strictly enforced.");

    // -----------------------------------------------------------------------
    // Test 9: Guard 4: Quota Cascading (<15%) & Playbook Context Injection
    // -----------------------------------------------------------------------
    console.log("\n[Test 9] Testing Guard 4 (Quota Cascading & Playbook Context Injection)...");
    const playStore = broker.hubController.getPlaybookStore();
    playStore.savePlaybook({
      category: "testing",
      label: "Automated Testing Playbook",
      episodic: [],
      semantic: [
        { id: "sem-test-1", preference: "Always use assert.strictEqual", rationale: "Prevents subtle coercion bugs", recordedAt: new Date().toISOString() }
      ],
      procedural: [
        { id: "pro-test-1", trigger: "Writing tests", rule: "Isolate temporary state directories", recordedAt: new Date().toISOString() }
      ],
      updatedAt: new Date().toISOString(),
    });

    const cascadingTodo = await broker.hubController.ingestTodo({
      text: "Write unit tests for authentication module",
      categoryOverride: "testing",
      allowManualCredit: false,
    });
    cascadingTodo.status = "ready";

    // Simulate depleted Codex quota (< 15%) and depleted Antigravity quota
    const lowQuotaSnapshot = {
      codexPercentage: 8, // 8% remaining (< 15%)
      antigravityPercentage: 5, // 5% remaining (< 15%)
    };

    const guard4Res = await fetch(`${baseUrl}/v1/hub/todos/${encodeURIComponent(cascadingTodo.id)}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferredProvider: "openai.codex.app",
        tokenSnapshot: lowQuotaSnapshot,
      }),
    }).then((r) => r.json());

    assert.strictEqual(guard4Res.ok, true);
    assert.strictEqual(
      guard4Res.todo.assignedRoute,
      "local.openai-compatible",
      "Exhausted quota (<15%) must cascade down to local.openai-compatible"
    );

    // Verify Playbook context injection into task.goal
    assert.ok(guard4Res.task.goal.includes("--- [Playbook Context: Automated Testing Playbook] ---"));
    assert.ok(guard4Res.task.goal.includes("Always use assert.strictEqual"));
    assert.ok(guard4Res.task.goal.includes("Isolate temporary state directories"));
    console.log("  ✓ Guard 4 passed: Quota cascaded to local LLM and playbook context injected.");

    // -----------------------------------------------------------------------
    // Test 10: Bidirectional Markdown Sync Checklists and Block IDs
    // -----------------------------------------------------------------------
    console.log("\n[Test 10] Testing Bidirectional Markdown Sync (Todo.md)...");
    const testTodoMdPath = path.join(tempDir, "Todo.md");
    const initialMdContent = [
      "# Todos",
      "- [ ] Clean up and document the database connection pooling configuration for 100 concurrent workers #core ^tsk-a001",
      "- [?] Ambiguous task item ^tsk-b002",
      "- [/] Run active data migration for user accounts in batch 42 ^tsk-c003",
      "- [x] Deploy staging artifacts to canary server 1 #devops ^tsk-d004",
      "",
    ].join("\n");
    fs.writeFileSync(testTodoMdPath, initialMdContent, "utf8");

    // Point customTodoFilePath to testTodoMdPath
    broker.hubController.getConfigStore().updateConfig({
      customTodoFilePath: testTodoMdPath,
      autoSyncMarkdown: true,
    });

    // Run sync
    const mdSyncRes = await broker.hubController.syncTodos();
    assert.strictEqual(mdSyncRes.ok, true);

    const syncedTodos = broker.hubController.getTodos();
    const item1 = syncedTodos.find((t) => t.blockId === "tsk-a001");
    const item2 = syncedTodos.find((t) => t.blockId === "tsk-b002");
    const item3 = syncedTodos.find((t) => t.blockId === "tsk-c003");
    const item4 = syncedTodos.find((t) => t.blockId === "tsk-d004");

    assert.ok(item1 && item1.status === "ready", "Checkbox [ ] with detailed spec maps to ready");
    assert.ok(item2 && item2.status === "needs_clarification", "Checkbox [?] maps to needs_clarification");
    assert.ok(item3 && item3.status === "in_progress", "Checkbox [/] maps to in_progress");
    assert.ok(item4 && item4.status === "done", "Checkbox [x] maps to done");

    // Ingest a new todo through controller and verify it is appended to Todo.md with block ID
    const newIngested = await broker.hubController.ingestTodo({
      text: "Comprehensive end-to-end integration checklist for wave 1 dispatch #core",
      categoryOverride: "core",
    });
    const updatedMd = fs.readFileSync(testTodoMdPath, "utf8");
    assert.ok(updatedMd.includes(newIngested.title), "New todo must be synced into Markdown");
    assert.ok(updatedMd.includes(`^${newIngested.blockId}`), "Markdown must contain ^tsk-xxxx block ID");
    console.log("  ✓ Markdown sync verified: Checklist symbols and block IDs preserved bidirectionally.");

    console.log("\n=== ALL 10 TEST SUITES PASSED SUCCESSFULLY (100%) ===");
  } finally {
    await server.close();
    console.log("Broker server closed cleanly.");
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp dir cleanup errors
    }
  }
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
