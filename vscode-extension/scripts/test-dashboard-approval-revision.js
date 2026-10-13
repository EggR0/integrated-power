const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");
const Module = require("module");
const vm = require("vm");

const extensionRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(extensionRoot, ".dashboard-approval-runtime-"));
const workspacePath = path.join(tempRoot, "workspace");
fs.mkdirSync(workspacePath, { recursive: true });
const originalLoad = Module._load;

class MemoryLedger {
  constructor() { this.events = []; }
  async append(event) { this.events.push(event); }
  async list(taskId) { return taskId ? this.events.filter((event) => event.taskId === taskId) : [...this.events]; }
}

class FakeElement {
  constructor(tagName) { this.tagName = tagName.toUpperCase(); this.children = []; this.listeners = {}; this.attributes = {}; this.value = ""; this.disabled = false; }
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

function makeControls() {
  const document = { createElement: (tag) => new FakeElement(tag) };
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(extensionRoot, "webview", "broker-controls.js"), "utf8"), { window, document });
  const root = new FakeElement("main");
  const sent = [];
  const find = (node, predicate, found = []) => { if (predicate(node)) found.push(node); node.children.forEach((child) => find(child, predicate, found)); return found; };
  return { root, sent, render: (state) => window.IPBrokerControls.render(root, state, (message) => sent.push(message)), find: (predicate) => find(root, predicate) };
}

const vscode = {
  window: {
    createOutputChannel: () => ({ appendLine() {}, dispose() {}, show() {} }),
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
  },
  workspace: {
    name: "Approval fixture",
    workspaceFolders: [{ uri: { fsPath: workspacePath } }],
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
  },
  commands: { executeCommand: async () => undefined },
};

Module._load = function (request, parent, isMain) {
  if (request === "vscode") return vscode;
  if (request === "../../../shared/quota/settings" || String(request).endsWith(`${path.sep}shared-quota.js`)) {
    const defaults = {
      pollIntervalMs: 5000, notifyOnFull: true, prewarmMode: "click",
      prewarmModes: { antigravity: "click", opus: "click", codex: "click" },
      notifications: {
        antigravityGemini5h: true, antigravityGeminiWeekly: true,
        antigravityClaude5h: true, antigravityClaudeWeekly: true,
        chatgpt5h: true, chatgptWeekly: true, claude5h: true, claudeWeekly: true,
      },
    };
    return { mergeQuotaSettings: (value) => ({ ...defaults, ...value, prewarmModes: { ...defaults.prewarmModes, ...value?.prewarmModes }, notifications: { ...defaults.notifications, ...value?.notifications } }) };
  }
  try { return originalLoad.call(this, request, parent, isMain); }
  catch (error) { error.message = `Failed loading ${request} from ${parent?.filename}: ${error.message}`; throw error; }
};

async function main() {
  let server;
  let controller;
  let compiledRoot;
  try {
    compiledRoot = fs.mkdtempSync(path.join(extensionRoot, ".dashboard-approval-build-"));
    execFileSync(process.execPath, [
      path.join(extensionRoot, "node_modules", "typescript", "bin", "tsc"),
      "-p", path.join(extensionRoot, "tsconfig.json"), "--outDir", compiledRoot, "--sourceMap", "false",
    ], { cwd: extensionRoot, stdio: "pipe" });
    process.env.NODE_PATH = path.join(extensionRoot, "node_modules");
    Module._initPaths();
    const { IntegratedPowerBroker } = require(path.join(compiledRoot, "broker", "broker.js"));
    const { startBrokerServer } = require(path.join(compiledRoot, "broker", "server.js"));
    const broker = new IntegratedPowerBroker(new MemoryLedger(), []);
    await broker.initialize();
    server = await startBrokerServer(broker, 0, {
      stateRoot: tempRoot,
      tokenStatusReader: async () => ({}),
      autoSchedule: false,
    });

    const { BrokerClient } = require(path.join(compiledRoot, "broker", "client.js"));
    const client = new BrokerClient(() => server.port);
    const task = await client.createTask({
      title: "Approval revision flow", goal: "Synthetic approval test", originProvider: "local.openai-compatible",
      workspacePath, privacy: "private", idempotencyKey: "approval-flow-task",
    });
    const requested = await client.requestApproval({
      taskId: task.id, action: "merge", description: "Review the synthetic result", requestedBy: "broker",
      expectedRevision: task.revision, idempotencyKey: "approval-flow-request",
    });
    assert.strictEqual(requested.requestedRevision, task.revision, "request revision remains available for audit");
    assert.strictEqual(requested.expectedRevision, task.revision + 1, "action token reflects request event revision");

    const { WorkspacePaths } = require(path.join(compiledRoot, "WorkspacePaths.js"));
    WorkspacePaths.prototype.createWatchers = () => [];
    const { DashboardController } = require(path.join(compiledRoot, "DashboardController.js"));
    DashboardController.prototype.writeDashboardState = async () => {};
    const outbound = [];
    const controls = makeControls();
    controller = new DashboardController(
      { globalStorageUri: { fsPath: tempRoot }, extensionPath: extensionRoot },
      (message) => outbound.push(message),
      { getClient: () => client },
    );
    await controller.handleMessage({ type: "refreshBroker" });
    let state = outbound.filter((message) => message.type === "brokerState").at(-1).state;
    assert.strictEqual(state.approvals[0].expectedRevision, requested.expectedRevision, "queue exposes current action revision");
    controls.render(state);
    controls.find((element) => element.tagName === "BUTTON" && element.textContent === "Approve")[0].click();
    const decision = controls.sent.shift();
    assert.strictEqual(decision.expectedRevision, requested.expectedRevision, "IDE button sends the action revision");
    await controller.handleMessage(decision);
    state = outbound.filter((message) => message.type === "brokerState").at(-1).state;
    assert.strictEqual(state.approvals.length, 0, "real broker accepts the IDE decision and removes the approval");
    assert.strictEqual(broker.getTask(task.id).status, "running", "approval action reaches the actual broker task state");

    const secondTask = await client.createTask({
      title: "Stale approval flow", goal: "Synthetic stale revision test", originProvider: "local.openai-compatible",
      workspacePath, privacy: "private", idempotencyKey: "stale-approval-task",
    });
    const staleApproval = await client.requestApproval({
      taskId: secondTask.id, action: "publish", description: "Stale decision must conflict", requestedBy: "broker",
      expectedRevision: secondTask.revision, idempotencyKey: "stale-approval-request",
    });
    await controller.handleMessage({ type: "refreshBroker" });
    const queued = outbound.filter((message) => message.type === "brokerState").at(-1).state.approvals.find((approval) => approval.id === staleApproval.id);
    assert.ok(queued);
    await broker.recordEvidence({ taskId: secondTask.id, kind: "manual", label: "revision moved", passed: true, details: "Synthetic intervening task event", expectedRevision: staleApproval.expectedRevision });
    controls.render({ ...outbound.filter((message) => message.type === "brokerState").at(-1).state, approvals: [queued] });
    controls.find((element) => element.tagName === "BUTTON" && element.textContent === "Approve")[0].click();
    await controller.handleMessage(controls.sent.shift());
    state = outbound.filter((message) => message.type === "brokerState").at(-1).state;
    assert.strictEqual(state.approvals.length, 1, "stale action remains queued after the broker returns 409");
    assert.match(state.error || "", /409|conflict|revision/i, "IDE presents the stale revision conflict for review");
    console.log("dashboard approval revision passed: real request event, current action token, UI approval, stale 409");
  } finally {
    controller?.dispose();
    if (server) await server.close();
    Module._load = originalLoad;
    if (compiledRoot) fs.rmSync(compiledRoot, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
