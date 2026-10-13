const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Module = require("node:module");
const childProcess = require("node:child_process");

const vsix = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "integrated-power-0.9.21-integration.vsix"));
if (!fs.existsSync(vsix)) throw new Error(`VSIX not found: ${vsix}`);

async function main() {
const temp = fs.mkdtempSync(path.join(path.resolve(__dirname, "..", ".."), ".tmp-vsix-runtime-"));
const extracted = path.join(temp, "unpacked");
const profile = path.join(temp, "profile");
const stateRoot = path.join(temp, "state");
const port = await freePort();
let originalExecFileSync;
fs.mkdirSync(extracted, { recursive: true });
fs.mkdirSync(profile, { recursive: true });

try {
  const escapedVsix = vsix.replaceAll("'", "''");
  const escapedDestination = extracted.replaceAll("'", "''");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${escapedVsix}' -DestinationPath '${escapedDestination}' -Force`], { stdio: "inherit" });
  const extensionRoot = path.join(extracted, "extension");
  const extensionJs = path.join(extensionRoot, "out", "extension.js");
  const quotaJs = path.join(extensionRoot, "out", "shared-quota.js");
  const webviewMain = fs.readFileSync(path.join(extensionRoot, "webview", "main.js"), "utf8");
  const webviewQuota = fs.readFileSync(path.join(extensionRoot, "webview", "quota-core.js"), "utf8");
  assert(fs.existsSync(extensionJs), "VSIX must contain the bundled extension entrypoint");
  assert(fs.existsSync(quotaJs), "VSIX must contain the runtime shared-quota bundle");
  assert(webviewMain.includes("buildGaugeTickGradient") && webviewMain.includes('data-segments="${segments}"') && /metric\.label === "Weekly" \? 7 : 5/.test(webviewMain), "VSIX webview must render IDE five-hour and weekly tick overlays through the shared gauge helper");
  assert(webviewQuota.includes("buildGaugeTickGradient"), "VSIX must package the shared gauge tick generator used by its webview");
  const quota = require(quotaJs);
  assert.equal(quota.mergeQuotaSettings({ notifyOnFull: false }).notifyOnFull, false);

  const vscode = createVscodeMock(extensionRoot, profile);
  const credentialTestStore = new Map();
  originalExecFileSync = childProcess.execFileSync;
  childProcess.execFileSync = function(file, args, options) {
    if (path.basename(String(file)).toLowerCase() === "powershell.exe" && options?.env?.INTEGRATED_POWER_CREDENTIAL_OPERATION) {
      const target = options.env.INTEGRATED_POWER_CREDENTIAL_TARGET;
      if (options.env.INTEGRATED_POWER_CREDENTIAL_OPERATION === "read") return credentialTestStore.get(target) || "";
      credentialTestStore.set(target, options.env.INTEGRATED_POWER_CREDENTIAL_VALUE);
      return "OK";
    }
    return originalExecFileSync.call(this, file, args, options);
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    return request === "vscode" ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  let extension;
  try { extension = require(extensionJs); }
  finally { Module._load = originalLoad; }

  process.env.INTEGRATED_POWER_BROKER_PORT = String(port);
  process.env.INTEGRATED_POWER_STATE_ROOT = stateRoot;
  const context = createContext(extensionRoot, profile);
  extension.activate(context);
  try { await waitForHealth(port); }
  catch (error) { throw new Error(`${error.message}\n${vscode.diagnostics.join("\n")}`); }
  const health = await requestJson(port, "GET", "/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.schemaVersion, 2);
  const settings = await requestJson(port, "GET", "/v1/settings/quota");
  assert.equal(settings.status, 200);
  assert.equal(settings.body.ok, true);
  const created = await requestJson(port, "POST", "/v1/tasks", {
    title: "VSIX runtime smoke",
    goal: "exercise packaged broker and persistent settings",
    originProvider: "local.openai-compatible",
    privacy: "private",
  });
  assert.equal(created.status, 201);
  const tasks = await requestJson(port, "GET", "/v1/tasks");
  assert(tasks.body.tasks.some((task) => task.id === created.body.task.id));
  for (const subscription of context.subscriptions.reverse()) subscription.dispose?.();
  extension.deactivate();
  childProcess.execFileSync = originalExecFileSync;
  console.log(JSON.stringify({ vsix, schemaVersion: health.body.schemaVersion, settingsRead: true, taskReadback: created.body.task.id, isolatedState: true }));
} finally {
  if (originalExecFileSync) childProcess.execFileSync = originalExecFileSync;
  delete process.env.INTEGRATED_POWER_BROKER_PORT;
  delete process.env.INTEGRATED_POWER_STATE_ROOT;
  fs.rmSync(temp, { recursive: true, force: true });
}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

function createContext(extensionPath, globalStorage) {
  const state = new Map();
  return {
    extensionPath,
    extensionUri: uri(extensionPath),
    globalStorageUri: uri(globalStorage),
    globalState: { get: (key) => state.get(key), update: async (key, value) => state.set(key, value) },
    subscriptions: [],
  };
}

function createVscodeMock(extensionPath, globalStorage) {
  const disposable = { dispose() {} };
  const diagnostics = [];
  const output = { appendLine(line) { diagnostics.push(line); }, show() {}, dispose() {} };
  const configuration = { get(_key, fallback) { return fallback; }, async update() {}, has() { return false; } };
  const window = {
    createOutputChannel: () => output,
    createStatusBarItem: () => ({ ...disposable, show() {}, hide() {}, text: "", tooltip: "", command: "" }),
    registerWebviewViewProvider: () => disposable,
    showInformationMessage: async () => undefined,
    showWarningMessage: async (message) => { diagnostics.push(message); return undefined; },
    showErrorMessage: async () => undefined,
  };
  const workspace = {
    workspaceFolders: [], name: undefined,
    getConfiguration: () => configuration,
    onDidChangeWorkspaceFolders: () => disposable,
    onDidChangeConfiguration: () => disposable,
    createFileSystemWatcher: () => disposable,
    fs: {
      async readFile(target) { return fs.promises.readFile(target.fsPath); },
      async writeFile(target, data) { return fs.promises.writeFile(target.fsPath, data); },
      async stat(target) { return fs.promises.stat(target.fsPath); },
    },
  };
  return {
    window, workspace, diagnostics,
    commands: { registerCommand: () => disposable, executeCommand: async () => undefined },
    env: { openExternal: async () => undefined },
    StatusBarAlignment: { Right: 2 }, ConfigurationTarget: { Global: 1 }, ViewColumn: { One: 1 },
    RelativePattern: class RelativePattern { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    Uri: {
      file: (value) => uri(value), parse: (value) => uri(value),
      joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)),
    },
  };
}

function uri(fsPath) { return { fsPath, path: fsPath, scheme: "file", toString: () => fsPath }; }

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(port, "GET", "/health");
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Packaged VSIX broker did not become healthy on its isolated port.");
}

function requestJson(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = http.request({ host: "127.0.0.1", port, method, path: pathname, headers: data ? { "content-type": "application/json", "content-length": data.length } : {} }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    });
    request.once("error", reject);
    if (data) request.write(data);
    request.end();
  });
}
