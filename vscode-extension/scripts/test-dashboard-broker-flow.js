const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");
const Module = require("module");
const vm = require("vm");

const extensionRoot = path.resolve(__dirname, "..");
const workspacePath = path.join(extensionRoot, ".synthetic-workspace");
const tempRoot = fs.mkdtempSync(path.join(extensionRoot, ".dashboard-broker-flow-"));
const requests = [];
const informationMessages = [];
let quotaRefillCapability = true;
let quotaRefillFailure = false;
let quotaRefillResult = {
  ok: true,
  notifications: [{ id: "antigravity-gemini-5h", configKey: "notifications.antigravityGemini5h", window: "5h", model: "Antigravity", title: "Antigravity (5시간)", message: "quota refilled", previousPercent: 99, currentPercent: 100 }],
  source: "canonical-broker",
  errors: [],
};
let quotaSettings = {
  ok: true, revision: 0, initialized: false,
  settings: {
    pollIntervalMs: 5000, notifyOnFull: true, prewarmMode: "click",
    prewarmModes: { antigravity: "click", opus: "click", codex: "click" },
    notifications: {
      antigravityGemini5h: true, antigravityGeminiWeekly: true,
      antigravityClaude5h: true, antigravityClaudeWeekly: true,
      chatgpt5h: true, chatgptWeekly: true, claude5h: true, claudeWeekly: true,
    },
  }, source: "synthetic", errors: [],
};
const tasks = [{
  id: "task-existing", title: "Existing scoped task", goal: "Synthetic task goal", workspacePath,
  contextFiles: [], originProvider: "local.openai-compatible", privacy: "private", status: "running",
  revision: 4, delegationDepth: 0, participants: ["local.openai-compatible"],
  budget: { maxParticipants: 1, allowApiSpend: false }, createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z",
}, ...["completed", "cancelled", "failed", "merged"].map((status, index) => ({
  id: `task-history-${index}`, title: `Past task ${index + 1}`, goal: "Preserved historical record.", workspacePath,
  contextFiles: [], originProvider: "local.openai-compatible", privacy: "private", status,
  revision: 4, delegationDepth: 0, participants: ["local.openai-compatible"],
  budget: { maxParticipants: 1, allowApiSpend: false }, createdAt: "2026-08-15T12:34:00Z", updatedAt: "2026-08-15T12:34:00Z",
}))];
const approvals = [
  { id: "approval-approve", taskId: "task-existing", action: "merge", description: "Allow merge", requestedBy: "broker", expectedRevision: 4, createdAt: "2026-10-13T00:00:00Z" },
  { id: "approval-reject", taskId: "task-existing", action: "external-send", description: "Reject external send", requestedBy: "broker", expectedRevision: 4, createdAt: "2026-10-13T00:00:00Z" },
];

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.value = "";
    this.disabled = false;
  }
  set textContent(value) { this._textContent = String(value); this.children = []; }
  get textContent() { return this._textContent ?? this.children.map((child) => child.textContent).join(""); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  dispatch(name) { for (const callback of this.listeners[name] || []) callback({ target: this, preventDefault() {} }); }
  click() { if (!this.disabled) this.dispatch("click"); }
}

function makeWebviewControls() {
  const document = { createElement: (tag) => new FakeElement(tag) };
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(extensionRoot, "webview", "broker-controls.js"), "utf8"), { window, document });
  const container = new FakeElement("main");
  const sent = [];
  const render = (state) => window.IPBrokerControls.render(container, state, (message) => sent.push(message));
  const findAll = (node, predicate, found = []) => {
    if (predicate(node)) found.push(node);
    node.children.forEach((child) => findAll(child, predicate, found));
    return found;
  };
  return { container, sent, render, findAll };
}

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body = {};
    if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ method: request.method, pathname: url.pathname, search: url.searchParams, body });
    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, {
        ok: true, service: "integrated-power-broker", schemaVersion: 2, brokerVersion: "synthetic-test",
        capabilities: ["tasks.read", "tasks.write", "approvals.read", "approvals.userDecision", "quota.settings.read", "quota.settings.write", "quota.prewarm", ...(quotaRefillCapability ? ["quota.notifications.claim"] : [])],
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/notifications/quota-refill") {
      if (quotaRefillFailure) return send(response, 503, { error: "synthetic unavailable" });
      return send(response, 200, quotaRefillResult);
    }
    if (request.method === "GET" && url.pathname === "/v1/settings/quota") return send(response, 200, quotaSettings);
    if (request.method === "POST" && url.pathname === "/v1/settings/quota") {
      if (body.expectedRevision !== quotaSettings.revision) return send(response, 409, { ...quotaSettings, conflict: true });
      quotaSettings = {
        ...quotaSettings, revision: quotaSettings.revision + 1, initialized: true,
        settings: { ...quotaSettings.settings, ...body.settings }, source: body.initializeFrom || "synthetic",
      };
      return send(response, 200, quotaSettings);
    }
    if (request.method === "POST" && url.pathname === "/v1/tokens/prewarm") {
      return send(response, 200, { ok: true, status: "dispatched", timerConfirmed: false, claimId: "synthetic-claim" });
    }
    if (request.method === "GET" && url.pathname === "/v1/tasks") {
      return send(response, 200, { ok: true, tasks, activeCount: tasks.filter((task) => task.status === "running").length, errors: [], source: "synthetic", workspaceId: "workspace-test" });
    }
    if (request.method === "GET" && url.pathname === "/v1/approvals") {
      return send(response, 200, { ok: true, approvals, errors: [], source: "synthetic", workspaceId: "workspace-test" });
    }
    if (request.method === "POST" && url.pathname === "/v1/tasks") {
      const task = { ...body, id: "task-created", status: "created", revision: 1, contextFiles: [], delegationDepth: 0, participants: [body.originProvider], budget: { maxParticipants: 1, allowApiSpend: false }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      tasks.push(task);
      return send(response, 201, { task });
    }
    if (request.method === "POST" && url.pathname === "/v1/tasks/delegate") {
      const task = tasks.find((candidate) => candidate.id === body.taskId);
      if (!task || task.revision !== body.expectedRevision) return send(response, 409, { error: "revision_conflict" });
      task.revision++;
      return send(response, 202, { event: { id: "event-delegate", taskId: task.id, type: "task.delegated", revision: task.revision } });
    }
    if (request.method === "POST" && url.pathname.startsWith("/v1/tasks/") && url.pathname.endsWith("/cancel")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/tasks/".length, -"/cancel".length));
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task || task.revision !== body.expectedRevision) return send(response, 409, { error: "revision_conflict" });
      task.revision++;
      task.status = "cancelled";
      return send(response, 200, { event: { id: "event-cancel", taskId: id, type: "task.cancelled", revision: task.revision } });
    }
    if (request.method === "POST" && url.pathname.startsWith("/v1/tasks/") && url.pathname.endsWith("/classify")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/tasks/".length, -"/classify".length));
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task || task.revision !== body.expectedRevision) return send(response, 409, { error: "revision_conflict" });
      task.revision++;
      task.tags = ["refactor", "bugfix"];
      task.recommendedProvider = "openai.codex.app";
      return send(response, 200, {
        event: {
          id: "event-classify",
          taskId: id,
          type: "task.classified",
          revision: task.revision,
          tags: task.tags,
          recommendedProvider: task.recommendedProvider,
        },
        tags: task.tags,
        recommendedProvider: task.recommendedProvider,
      });
    }
    if (request.method === "GET" && url.pathname === "/v1/tags") {
      return send(response, 200, { ok: true, tags: ["refactor", "bugfix", "ui"] });
    }
    const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/(approve|reject)$/);
    if (request.method === "POST" && approvalMatch) {
      const index = approvals.findIndex((approval) => approval.id === decodeURIComponent(approvalMatch[1]));
      if (index < 0) return send(response, 404, { error: "approval_not_found" });
      approvals.splice(index, 1);
      return send(response, 200, { ok: true });
    }
    return send(response, 404, { error: "not_found" });
  });
});

const terminals = [];
const vscode = {
  window: {
    createOutputChannel: () => ({ appendLine() {}, dispose() {}, show() {} }),
    showWarningMessage: async () => undefined,
    showInformationMessage: async (message) => informationMessages.push(message),
    showQuickPick: async (items) => {
      // Return the first item (Offline Fast Classification) to mock user selection
      return Array.isArray(items) ? items[0] : undefined;
    },
    terminals,
    createTerminal: (name) => {
      const term = {
        name,
        show() {},
        sendText(text) { term.lastSent = text; },
      };
      terminals.push(term);
      return term;
    },
  },
  workspace: {
    name: "Synthetic Workspace",
    workspaceFolders: [{ uri: { fsPath: workspacePath } }],
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
  },
  commands: { executeCommand: async () => undefined },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") return vscode;
  try { return originalLoad.call(this, request, parent, isMain); }
  catch (error) { error.message = `Failed loading ${request}: ${error.message}`; throw error; }
};

async function main() {
  let controller;
  try {
    const port = await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });

    execFileSync(process.execPath, [
      path.join(extensionRoot, "node_modules", "typescript", "bin", "tsc"),
      "-p", path.join(extensionRoot, "tsconfig.json"), "--outDir", tempRoot, "--sourceMap", "false",
    ], { cwd: extensionRoot, stdio: "pipe" });

    process.env.NODE_PATH = path.join(extensionRoot, "node_modules");
    Module._initPaths();
    const { WorkspacePaths } = require(path.join(tempRoot, "WorkspacePaths.js"));
    WorkspacePaths.prototype.createWatchers = () => [];
    const { DashboardController } = require(path.join(tempRoot, "DashboardController.js"));
    const { BrokerClient } = require(path.join(tempRoot, "broker", "client.js"));
    const client = new BrokerClient(() => port);
    const outbound = [];
    const ui = makeWebviewControls();
    controller = new DashboardController(
      { globalStorageUri: { fsPath: tempRoot }, extensionPath: extensionRoot },
      (message) => outbound.push(message),
      { getClient: () => client },
    );

    await controller.handleMessage({ type: "refreshBroker" });
    await controller.refreshQuotaSettings(true);
    const seedRequest = requests.find((entry) => entry.method === "POST" && entry.pathname === "/v1/settings/quota");
    assert.strictEqual(seedRequest.body.initializeFrom, "ide", "first IDE connection seeds existing settings once");
    assert.strictEqual(seedRequest.body.settings.pollIntervalMs, 5000);
    assert.strictEqual(seedRequest.body.settings.notifications.claudeWeekly, true);
    const previousStatus = { antigravityPercentage: 99 };
    const fullStatus = { antigravityPercentage: 100, codexPercentage: 100 };
    await controller.checkFullTokenNotification(previousStatus, fullStatus);
    const sharedNotificationRequest = requests.find((entry) => entry.pathname === "/v1/notifications/quota-refill");
    assert.deepStrictEqual(sharedNotificationRequest.body, {}, "IDE sends no provider quota snapshot; the broker uses its canonical collector");
    assert.deepStrictEqual(informationMessages, ["Antigravity (5시간): quota refilled"], "IDE only displays notifications returned by the canonical claim");

    quotaRefillFailure = true;
    await controller.checkFullTokenNotification(previousStatus, { antigravityPercentage: 100, codexPercentage: 100 });
    assert.strictEqual(informationMessages.length, 1, "a transient claim error does not fall back to duplicate local notifications");
    quotaRefillFailure = false;

    quotaRefillCapability = false;
    await controller.checkFullTokenNotification({ antigravityPercentage: 90 }, { antigravityPercentage: 100 });
    assert.strictEqual(informationMessages.length, 2, "a healthy legacy broker retains the validated local notification fallback");
    quotaRefillCapability = true;
    await controller.handleMessage({ type: "setPrewarmMode", mode: "always", target: "codex" });
    assert.strictEqual(quotaSettings.settings.prewarmModes.codex, "always", "mode change is persisted to canonical settings");
    await controller.handleMessage({ type: "prewarm", model: "codex" });
    const sharedPrewarm = requests.find((entry) => entry.method === "POST" && entry.pathname === "/v1/tokens/prewarm");
    assert.strictEqual(sharedPrewarm.body.manual, true, "manual prewarm is explicitly user-triggered");
    assert.ok(sharedPrewarm.body.idempotencyKey);
    assert.strictEqual(outbound.some((message) => message.type === "prewarmStatus"), false, "dispatch does not falsely report a verified timer");
    assert.strictEqual(requests.find((entry) => entry.pathname === "/v1/tasks").search.get("workspacePath"), workspacePath);
    assert.strictEqual(requests.find((entry) => entry.pathname === "/v1/approvals").search.get("workspacePath"), workspacePath);
    const initialBrokerState = outbound.filter((message) => message.type === "brokerState").at(-1);
    assert.ok(initialBrokerState);
    assert.strictEqual(initialBrokerState.state.tasks[0].id, "task-existing");
    assert.strictEqual(initialBrokerState.state.approvals.length, 2);
    ui.render(initialBrokerState.state);
    const findHistory = () => ui.findAll(ui.container, (element) => element.tagName === "DETAILS" && element.className === "broker-history")[0];
    const initialHistory = findHistory();
    assert.ok(initialHistory, "terminal broker tasks must be grouped in a history disclosure");
    assert.strictEqual(initialHistory.open, false, "terminal history is collapsed by default");
    const historySummary = ui.findAll(initialHistory, (element) => element.tagName === "SUMMARY")[0];
    assert.ok(historySummary.textContent.includes("History (4)") && historySummary.textContent.includes("8/15"), "collapsed history summary shows count and creation date");
    const workspaceTaskList = ui.findAll(ui.container, (element) => element.attributes["aria-label"] === "Workspace tasks")[0];
    assert.strictEqual(workspaceTaskList.children.filter((element) => element.tagName === "ARTICLE" && element.className.includes("broker-card")).length, 1, "active tasks remain visible outside collapsed history");
    initialHistory.open = true;
    initialHistory.dispatch("toggle");
    ui.render(initialBrokerState.state);
    const reopenedHistory = findHistory();
    assert.strictEqual(reopenedHistory.open, true, "history expansion survives a full rerender");
    assert.strictEqual(ui.findAll(reopenedHistory, (element) => element.tagName === "ARTICLE" && element.className.includes("broker-card")).length, 4, "expanded history retains all terminal task cards");
    assert.ok(ui.findAll(ui.container, (element) => element.tagName === "BUTTON" && element.textContent === "Delegate").length > 0, "active task actions remain available after opening history");

    const createForm = ui.findAll(ui.container, (element) => element.tagName === "FORM")[0];
    const createFields = ui.findAll(createForm, (element) => ["INPUT", "TEXTAREA"].includes(element.tagName));
    createFields[0].value = "Created from IDE";
    createFields[1].value = "Synthetic creation";
    createForm.dispatch("submit");
    await controller.handleMessage(ui.sent.shift());
    const createRequest = requests.find((entry) => entry.method === "POST" && entry.pathname === "/v1/tasks");
    assert.strictEqual(createRequest.body.workspacePath, workspacePath);
    assert.ok(createRequest.body.idempotencyKey, "IDE creates a host-generated idempotency key");

    ui.render(outbound.filter((message) => message.type === "brokerState").at(-1).state);
    ui.findAll(ui.container, (element) => element.tagName === "BUTTON" && element.textContent === "Delegate")[0].click();
    const delegateForm = ui.findAll(ui.container, (element) => element.tagName === "FORM")[1];
    const delegateFields = ui.findAll(delegateForm, (element) => element.tagName === "TEXTAREA");
    delegateFields[0].value = "Delegate safely";
    delegateForm.dispatch("submit");
    await controller.handleMessage(ui.sent.shift());
    const delegateRequest = requests.find((entry) => entry.pathname === "/v1/tasks/delegate");
    assert.strictEqual(delegateRequest.body.expectedRevision, 4);
    assert.ok(delegateRequest.body.idempotencyKey);

    ui.render(outbound.filter((message) => message.type === "brokerState").at(-1).state);
    ui.findAll(ui.container, (element) => element.tagName === "BUTTON" && element.textContent === "Cancel")[0].click();
    await controller.handleMessage(ui.sent.shift());
    const cancelRequest = requests.find((entry) => entry.pathname.endsWith("/cancel"));
    assert.strictEqual(cancelRequest.body.expectedRevision, 5);
    assert.ok(cancelRequest.body.idempotencyKey);

    // Test quick add task queue
    ui.render(outbound.filter((message) => message.type === "brokerState").at(-1).state);
    const quickInput = ui.findAll(ui.container, (element) => element.className && element.className.includes("broker-quick-input"))[0];
    const quickAddBtn = ui.findAll(ui.container, (element) => element.tagName === "BUTTON" && element.textContent === "+ 추가")[0];
    assert.ok(quickInput && quickAddBtn, "quick add controls are present");
    quickInput.value = "Quick memo: refactor parser logic";
    quickAddBtn.click();
    await controller.handleMessage(ui.sent.shift());
    const quickAddRequest = requests.find((entry) => entry.method === "POST" && entry.pathname === "/v1/tasks" && entry.body.rawInput === "Quick memo: refactor parser logic");
    assert.ok(quickAddRequest, "quick add creates task with rawInput");

    // Test AI classification menu trigger
    ui.render(outbound.filter((message) => message.type === "brokerState").at(-1).state);
    const classifyBtn = ui.findAll(ui.container, (element) => element.className && element.className.includes("broker-classify-btn"))[0];
    assert.ok(classifyBtn, "created task card displays AI classify button");
    classifyBtn.click();
    const classifyMenuMsg = ui.sent.shift();
    assert.strictEqual(classifyMenuMsg.type, "requestClassifyMenu", "clicking classify requests QuickPick menu");
    await controller.handleMessage(classifyMenuMsg);
    const classifyRequest = requests.find((entry) => entry.pathname.endsWith("/classify"));
    assert.ok(classifyRequest, "classification is dispatched via broker with offline mode fallback");

    // Test equal 3-platform action buttons (Antigravity, Codex, Local)
    const latestState = outbound.filter((message) => message.type === "brokerState").at(-1).state;
    ui.render(latestState);
    const runGroup = ui.findAll(ui.container, (element) => element.className && element.className.includes("broker-run-group"))[0];
    assert.ok(runGroup, "broker run group is present for created task");
    const platformBtns = ui.findAll(runGroup, (element) => element.className && element.className.includes("broker-platform-btn"));
    assert.strictEqual(platformBtns.length, 3, "three equal platform buttons are rendered in run group");

    const agyBtn = platformBtns.find((btn) => btn.textContent.includes("Antigravity"));
    assert.ok(agyBtn, "Antigravity button is present with canonical name");
    agyBtn.click();
    const agyMsg = ui.sent.shift();
    assert.strictEqual(agyMsg.provider, "google.antigravity.ide", "Antigravity button delegates to google.antigravity.ide");

    const codexBtn = platformBtns.find((btn) => btn.textContent.includes("Codex"));
    assert.ok(codexBtn, "Codex button is present");
    if (!codexBtn.disabled) {
      codexBtn.click();
      const codexMsg = ui.sent.shift();
      assert.strictEqual(codexMsg.provider, "openai.codex.app", "Codex button delegates to openai.codex.app when online");
    } else {
      assert.ok(codexBtn.title.includes("비활성화"), "Codex button title explains disabled reason when offline");
    }

    const localBtn = platformBtns.find((btn) => btn.textContent.includes("Local"));
    assert.ok(localBtn, "Local button is present");
    assert.strictEqual(localBtn.disabled, true, "Local button is disabled when server is offline");
    assert.ok(localBtn.title.includes("비활성화"), "Local button title explains disabled reason");

    // Test that when any platform is absent/offline, its button is strictly disabled without errors
    ui.render({
      ...outbound.filter((message) => message.type === "brokerState").at(-1).state,
      platforms: {
        antigravityOnline: false,
        codexOnline: false,
        localOnline: false,
        antigravityReason: "Antigravity 미설치",
        codexReason: "Codex CLI가 설치되어 있지 않습니다.",
        localReason: "Local LLM 서버가 오프라인입니다.",
      },
    });
    const offlineRunGroup = ui.findAll(ui.container, (element) => element.className && element.className.includes("broker-run-group"))[0];
    const offlineBtns = ui.findAll(offlineRunGroup, (element) => element.className && element.className.includes("broker-platform-btn"));
    for (const btn of offlineBtns) {
      assert.strictEqual(btn.disabled, true, `${btn.textContent} must be strictly disabled when offline/uninstalled`);
      assert.ok(btn.title.includes("비활성화"), `${btn.textContent} title must explain disabled reason`);
    }

    ui.render(outbound.filter((message) => message.type === "brokerState").at(-1).state);
    ui.findAll(ui.container, (element) => element.tagName === "BUTTON" && element.textContent === "Approve")[0].click();
    await controller.handleMessage(ui.sent.shift());
    ui.render(outbound.filter((message) => message.type === "brokerState").at(-1).state);
    ui.findAll(ui.container, (element) => element.tagName === "BUTTON" && element.textContent === "Reject")[0].click();
    await controller.handleMessage(ui.sent.shift());
    assert.ok(requests.some((entry) => entry.pathname.endsWith("/approve")));
    assert.ok(requests.some((entry) => entry.pathname.endsWith("/reject")));
    assert.ok(outbound.some((message) => message.type === "brokerLoading" && message.busy === true));
    const claimCountBeforeStartupFallback = requests.filter((entry) => entry.pathname === "/v1/notifications/quota-refill").length;
    const messageCountBeforeStartupFallback = informationMessages.length;
    controller.useLegacyQuotaSettingsFallback(); // Mirrors extension.ts when broker startup definitively fails.
    await controller.checkFullTokenNotification({ opusPercentage: 90 }, { opusPercentage: 100 });
    assert.strictEqual(requests.filter((entry) => entry.pathname === "/v1/notifications/quota-refill").length, claimCountBeforeStartupFallback, "definitive broker startup failure preserves local quota alerts");
    assert.strictEqual(informationMessages.length, messageCountBeforeStartupFallback + 1, "startup-failure fallback preserves the configured per-window alert");
    console.log("dashboard broker HTTP flow passed: task actions, approval decisions, settings seed/update, manual prewarm dispatch");
  } finally {
    controller?.dispose();
    Module._load = originalLoad;
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
