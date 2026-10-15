/**
 * vscode-extension/scripts/test-first-run-onboarding.js
 *
 * Comprehensive First-Run User Onboarding & Usability Verification Harness
 * Tests installation, clean activation, broker auto-start, configuration center,
 * webview resilience, and full feature workflow for new users.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const Module = require("node:module");

const arg = process.argv[2] || "--all";
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionRoot = path.resolve(__dirname, "..");

// Helper to find latest VSIX in repoRoot or extensionRoot
function findLatestVsix() {
  const candidates = [];
  for (const dir of [repoRoot, extensionRoot]) {
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".vsix")) {
        const full = path.join(dir, file);
        candidates.push({ path: full, mtime: fs.statSync(full).mtimeMs, name: file });
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

function httpGet(port, urlPath, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath, timeout: timeoutMs }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("HTTP timeout")); });
  });
}

function createMockExtensionContext(storageDir) {
  const globalState = new Map();
  const subscriptions = [];
  return {
    extensionUri: { fsPath: extensionRoot },
    extensionPath: extensionRoot,
    globalStorageUri: { fsPath: path.join(storageDir, "globalStorage") },
    logUri: { fsPath: path.join(storageDir, "logs") },
    storageUri: { fsPath: path.join(storageDir, "storage") },
    subscriptions,
    globalState: {
      get: (key, defaultValue) => (globalState.has(key) ? globalState.get(key) : defaultValue),
      update: (key, value) => {
        globalState.set(key, value);
        return Promise.resolve();
      },
    },
    extension: {
      packageJSON: JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8")),
    },
  };
}

async function runGatePackage() {
  const vsixPath = findLatestVsix();
  assert(vsixPath && fs.existsSync(vsixPath), "At least one VSIX package must exist for first-run testing");
  
  const tempExtract = fs.mkdtempSync(path.join(os.tmpdir(), "ip-gate1-vsix-"));
  try {
    const escapedVsix = vsixPath.replaceAll("'", "''");
    const escapedDestination = tempExtract.replaceAll("'", "''");
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedVsix}', '${escapedDestination}')`
    ], { stdio: "pipe" });

    const extDir = path.join(tempExtract, "extension");
    const requiredFiles = [
      "package.json",
      "out/extension.js",
      "out/shared-quota.js",
      "out/broker/index.js",
      "out/broker/broker-manifest.json",
      "webview/main.js",
      "webview/broker-controls.js",
      "webview/quota-core.js",
      "webview/styles.css",
      "assets/antigravity/sync_history.py",
      "assets/ip-orchestrator-plugin/plugin.json",
      "assets/knowledge-tools/eggr-roots.ps1"
    ];

    for (const rel of requiredFiles) {
      const full = path.join(extDir, rel);
      assert(fs.existsSync(full), `VSIX must contain ${rel}`);
    }

    // Verify manifest has version and commands
    const pkg = JSON.parse(fs.readFileSync(path.join(extDir, "package.json"), "utf8"));
    assert.equal(pkg.name, "integrated-power");
    assert(Array.isArray(pkg.contributes.commands) && pkg.contributes.commands.length >= 10);
    assert(pkg.contributes.configuration.properties["integratedPower.view.showQueue"]);

    console.log("gate 1 passed: package assets verified");
  } finally {
    try { fs.rmSync(tempExtract, { recursive: true, force: true }); } catch {}
  }
}

async function runGateActivation() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "ip-gate2-home-"));
  const tempState = path.join(tempHome, "AppData", "Local", "IntegratedPower", "state");
  const testPort = await freePort();

  process.env.INTEGRATED_POWER_BROKER_PORT = String(testPort);
  process.env.INTEGRATED_POWER_STATE_ROOT = tempState;

  // Mock vscode environment
  const registeredCommands = new Map();
  let statusBarCreated = false;
  let webviewRegistered = false;
  let firstRunPromptTriggered = false;

  const mockVscode = {
    window: {
      createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
      createStatusBarItem: () => {
        statusBarCreated = true;
        return { text: "", tooltip: "", command: "", show: () => {}, dispose: () => {} };
      },
      registerWebviewViewProvider: (viewId) => {
        if (viewId === "integratedPower.agentRunsDashboard") webviewRegistered = true;
        return { dispose: () => {} };
      },
      showInformationMessage: async (text, ...items) => {
        if (text.includes("Integrated Power Dashboard")) {
          firstRunPromptTriggered = true;
        }
        return items[0];
      },
      showErrorMessage: async () => {},
      showWarningMessage: async () => {},
      createWebviewPanel: () => ({
        webview: {
          html: "",
          onDidReceiveMessage: () => ({ dispose: () => {} }),
          asWebviewUri: (u) => u,
          postMessage: async () => true,
          options: {},
        },
        onDidDispose: () => ({ dispose: () => {} }),
        reveal: () => {},
        dispose: () => {},
      }),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { One: 1, Two: 2 },
    commands: {
      registerCommand: (name, callback) => {
        registeredCommands.set(name, callback);
        return { dispose: () => registeredCommands.delete(name) };
      },
      executeCommand: async () => {},
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({
        get: (key, defaultValue) => defaultValue,
        update: async () => {},
      }),
      onDidChangeConfiguration: () => ({ dispose: () => {} }),
      onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
      createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose: () => {} }),
        onDidCreate: () => ({ dispose: () => {} }),
        onDidDelete: () => ({ dispose: () => {} }),
        dispose: () => {},
      }),
      fs: {
        readFile: async () => Buffer.from(""),
      },
    },
    env: {
      appName: "Antigravity IDE",
      openExternal: async () => true,
    },
    Uri: {
      file: (f) => ({ fsPath: f }),
      parse: (s) => ({ toString: () => s }),
      joinPath: (base, ...segs) => ({ fsPath: path.join(base.fsPath || base, ...segs) }),
    },
    Disposable: class {
      constructor(call) { this.call = call; }
      dispose() { if (this.call) this.call(); }
    },
    ConfigurationTarget: { Global: 1 },
  };

  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return mockVscode;
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    const ext = require(path.join(extensionRoot, "out", "extension.js"));
    const context = createMockExtensionContext(tempHome);
    
    ext.activate(context);

    assert(statusBarCreated, "Status bar item must be created on activation");
    assert(webviewRegistered, "Agent runs dashboard webview must be registered");
    assert(registeredCommands.has("integratedPower.agentRuns.openCompact"), "openCompact command must be registered");
    assert(registeredCommands.has("integratedPower.addTaskToQueue"), "addTaskToQueue command must be registered");
    assert(registeredCommands.has("integratedPower.eggr.openConfigurationCenter"), "openConfigurationCenter must be registered");

    // Wait for broker to initialize and listen on testPort
    let healthy = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await httpGet(testPort, "/health");
        if (res.status === 200 && res.body.service === "integrated-power-broker") {
          healthy = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }

    assert(healthy, `Broker must start on port ${testPort} and return health`);
    assert(firstRunPromptTriggered, "offerFirstRunSetup must prompt new user with configuration center option");

    // Clean up
    for (const d of context.subscriptions) {
      try { d.dispose(); } catch {}
    }
    ext.deactivate();

    console.log("gate 2 passed: clean activation verified");
  } finally {
    Module._load = origLoad;
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch {}
  }
}

async function runGateConfiguration() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "ip-gate3-home-"));
  const origLoad = Module._load;

  const mockVscode = {
    workspace: {
      getConfiguration: (section) => ({
        get: (key, defaultValue) => defaultValue,
        update: async () => {},
      }),
      onDidChangeConfiguration: () => ({ dispose: () => {} }),
    },
    window: {
      showErrorMessage: async () => {},
      showInformationMessage: async () => {},
    },
    env: { appName: "Antigravity IDE" },
    Uri: {
      file: (f) => ({ fsPath: f }),
      joinPath: (base, ...segs) => ({ fsPath: path.join(base.fsPath || base, ...segs) }),
    },
  };

  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return mockVscode;
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    fs.mkdirSync(path.join(tempHome, ".gemini"), { recursive: true });
    const configModel = require(path.join(extensionRoot, "out", "configurationModel.js"));
    const pluginInstaller = require(path.join(extensionRoot, "out", "installAntigravityPlugin.js"));
    const context = createMockExtensionContext(tempHome);
    
    // Inspect plugin install plan for fresh user
    const pluginPlan = pluginInstaller.inspectAntigravityPluginInstall(context, tempHome);
    assert(pluginPlan, "Plugin install plan must be generated for clean environment");
    assert.equal(pluginPlan.blocked, false, "Fresh install plan should not be blocked");
    assert(pluginPlan.actions.length > 0, "Plan must contain install actions");

    // Inspect first-run status
    const status = configModel.getFirstRunStatus(context);
    assert(typeof status === "object");
    assert.equal(status.dashboard, false, "Dashboard setup should initially be uncompleted for fresh user");

    console.log("gate 3 passed: configuration center verified");
  } finally {
    Module._load = origLoad;
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch {}
  }
}

async function runGateWebview() {
  // Test quota core bundle in browser-like environment
  const quotaJs = path.join(extensionRoot, "webview", "quota-core.js");
  assert(fs.existsSync(quotaJs), "quota-core.js bundle must exist");

  const vm = require("node:vm");
  const windowContext = { Math, Number, String, Boolean, Date, Array, Object };
  windowContext.window = windowContext;
  windowContext.globalThis = windowContext;
  windowContext.self = windowContext;
  vm.createContext(windowContext);
  vm.runInContext(fs.readFileSync(quotaJs, "utf8"), windowContext);

  const IPQuota = windowContext.IPQuota || windowContext.window.IPQuota;
  assert(IPQuota, "window.IPQuota must be defined by quota-core.js");
  assert(typeof IPQuota.calculateEffective5HourQuota === "function");
  assert(typeof IPQuota.buildGaugeTickGradient === "function");

  // Verify ticks with NaN/undefined/zero inputs (Zero-tool resilience)
  const defaultTickGradient = IPQuota.buildGaugeTickGradient(5, 0, 100);
  assert(typeof defaultTickGradient === "string" && defaultTickGradient.includes("linear-gradient"));

  const emptyQuotaRes = IPQuota.calculateEffective5HourQuota(0, 0, "gemini-3.6-flash");
  assert.equal(emptyQuotaRes.effectivePct, 0);
  assert.equal(emptyQuotaRes.isWeeklyExhausted, true);

  console.log("gate 4 passed: webview resilience verified");
}

async function runGateE2E() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "ip-gate5-home-"));
  const tempState = path.join(tempHome, "state");
  const testPort = await freePort();

  const brokerMod = require(path.join(extensionRoot, "out", "broker", "index.js"));
  const {
    createPreferredEventLedger,
    loadOrCreateLedgerKey,
    IntegratedPowerBroker,
    createFirstWaveAdapters,
    startBrokerServer,
    resolveGoogleDriveMcpPaths,
  } = brokerMod;

  fs.mkdirSync(tempState, { recursive: true });
  const ledgerBase = path.join(tempState, "events.enc.jsonl");
  const key = loadOrCreateLedgerKey(`${ledgerBase}.key`);
  const ledger = createPreferredEventLedger(ledgerBase, key);
  const broker = new IntegratedPowerBroker(ledger, createFirstWaveAdapters());
  await broker.initialize();
  const server = await startBrokerServer(broker, testPort, { stateRoot: tempState });

  try {
    // 1. Check health
    const health = await httpGet(testPort, "/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.service, "integrated-power-broker");

    // 2. Create task (Quick Add simulation)
    const taskData = JSON.stringify({
      title: "신규 설치 유저의 첫 번째 작업",
      goal: "온보딩 워크플로우 정상 검증",
      originProvider: "user.dashboard",
      workspacePath: tempHome,
    });
    const postTaskRes = await new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port: testPort,
        path: "/v1/tasks",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(taskData) },
      }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      });
      req.on("error", reject);
      req.write(taskData);
      req.end();
    });

    assert.equal(postTaskRes.status, 201, "Task creation should return 201 Created");
    const createdTask = postTaskRes.body.task;
    assert(createdTask && createdTask.id, "Created task must have an ID");

    // 3. Verify task listed
    const listRes = await httpGet(testPort, "/v1/tasks");
    assert.equal(listRes.status, 200);
    assert(listRes.body.tasks.some((t) => t.id === createdTask.id));

    // 4. Prewarm settings write & read
    const initialSettings = await httpGet(testPort, "/v1/settings/quota");
    const settingsPayload = JSON.stringify({
      expectedRevision: initialSettings.body.revision ?? 0,
      initializeFrom: "ide",
      settings: {
        prewarmMode: "always",
        prewarmModes: { antigravity: "always", opus: "once", codex: "click" },
      },
    });
    const postSettingsRes = await new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port: testPort,
        path: "/v1/settings/quota",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(settingsPayload) },
      }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      });
      req.on("error", reject);
      req.write(settingsPayload);
      req.end();
    });

    assert.equal(postSettingsRes.status, 200, "Quota settings write must succeed");
    const getSettingsRes = await httpGet(testPort, "/v1/settings/quota");
    assert.equal(getSettingsRes.body.settings.prewarmMode, "always");
    assert.equal(getSettingsRes.body.settings.prewarmModes.opus, "once");

    // 5. Google Drive MCP paths
    const gdrivePaths = resolveGoogleDriveMcpPaths("win32", {}, tempHome);
    assert(gdrivePaths.keyPath.includes("google-drive-mcp"));

    console.log("gate 5 passed: full feature journey verified");
  } finally {
    await server.close();
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  if (arg === "--gate-package") {
    await runGatePackage();
  } else if (arg === "--gate-activation") {
    await runGateActivation();
  } else if (arg === "--gate-configuration") {
    await runGateConfiguration();
  } else if (arg === "--gate-webview") {
    await runGateWebview();
  } else if (arg === "--gate-e2e") {
    await runGateE2E();
  } else {
    await runGatePackage();
    await runGateActivation();
    await runGateConfiguration();
    await runGateWebview();
    await runGateE2E();
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
