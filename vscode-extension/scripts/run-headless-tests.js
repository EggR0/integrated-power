const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const extensionRoot = path.resolve(__dirname, "..");
const {
  eggRWorkspaceId,
  normalizeEggRRemoteIdentity,
  normalizeWorkspacePathForStorage,
  resolveEggRStateRoot,
  workspaceStoragePathForFolder,
} = require("../out/storagePath");

function readText(...parts) {
  return fs.readFileSync(path.join(extensionRoot, ...parts), "utf8");
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test("EggR workspace identity is stable across Windows paths and Git URL forms", () => {
  const storageRoot = "C:\\Users\\tester\\AppData\\Local\\EggR\\state";
  const folderPath = "C:\\Projects\\Example";
  const sshRemote = "git@github.com:R-Github04/Intergrated-POWER.git";
  const httpsRemote = "https://github.com/R-Github04/Intergrated-POWER.git";
  const workspaceId = eggRWorkspaceId(folderPath, sshRemote);
  const expected = path.join(storageRoot, "workspaces", workspaceId);

  assert.strictEqual(normalizeWorkspacePathForStorage(folderPath), "C:\\Projects\\Example");
  assert.strictEqual(normalizeEggRRemoteIdentity(sshRemote), "github.com/r-github04/intergrated-power");
  assert.strictEqual(workspaceId, eggRWorkspaceId("D:\\Moved\\Example", httpsRemote));
  assert.strictEqual(workspaceStoragePathForFolder(storageRoot, folderPath, sshRemote), expected);
});

test("EggR roots config accepts a Windows PowerShell UTF-8 BOM", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "eggr-bom-"));
  const configDirectory = path.join(tempHome, ".config", "eggr");
  const configuredStateRoot = path.join(tempHome, "state");

  try {
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(configDirectory, "roots.json"),
      `\uFEFF${JSON.stringify({ state_root: configuredStateRoot })}`,
      "utf8",
    );

    assert.strictEqual(resolveEggRStateRoot({}, tempHome, "win32"), path.resolve(configuredStateRoot));
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("package commands exclude removed Athena workflow", () => {
  const manifest = JSON.parse(readText("package.json"));
  const commands = (manifest.contributes?.commands ?? []).map((entry) => entry.command).sort();

  assert.deepStrictEqual(commands, [
    "integratedPower.agentRuns.configureViews",
    "integratedPower.agentRuns.openRunsFile",
    "integratedPower.agentRuns.refresh",
    "integratedPower.eggr.installOrUpdateOrchestrator",
    "integratedPower.eggr.runDashboardSetup",
    "integratedPower.eggr.runFirstRunSetup",
    "integratedPower.eggr.runOrchestratorSetup",
    "integratedPower.eggr.runPrivateKnowledgeSetup",
  ]);
});

test("first-run setup keeps three independent entry points", () => {
  const setupSource = readText("src", "setupWizards.ts");

  assert.ok(setupSource.includes("runDashboardSetupWizard"));
  assert.ok(setupSource.includes("runOrchestratorSetupWizard"));
  assert.ok(setupSource.includes("runPrivateKnowledgeSetupWizard"));
  assert.ok(setupSource.includes('knowledgeMode === "local_only"'));
  assert.ok(setupSource.includes('Mode: "auto" | "user_default"'));
  assert.ok(fs.existsSync(path.join(extensionRoot, "assets", "private-git-knowledge.md")));
});

test("dashboard activation does not silently install or overwrite the EggR orchestrator", () => {
  const extensionSource = readText("src", "extension.ts");
  const activateBlock = extensionSource.slice(extensionSource.indexOf("export function activate"));

  assert.ok(!activateBlock.includes("initializeGlobalProtocol(context);"));
  assert.ok(!activateBlock.includes("installAntigravityPlugin(context);"));
  assert.ok(!extensionSource.includes("dashboard_global_storage.txt"));
  assert.ok(extensionSource.includes("integratedPower.eggr.installOrUpdateOrchestrator"));
});

test("webview preserves token status and keeps Refresh clickable", () => {
  const webview = readText("webview", "main.js");
  const styles = readText("webview", "styles.css");

  assert.ok(!webview.includes("tokenStatus = emptyTokenStatus()"));
  assert.ok(webview.includes("dashboardState.isTokenLoading = true"));
  assert.ok(webview.includes('<button type="button" data-command="refresh">Refresh</button>'));
  assert.ok(!webview.includes('data-command="refresh" ${dashboardState.isLoading ? "disabled" : ""}'));
  assert.match(styles, /\.loading-strip\s*\{[\s\S]*position:\s*fixed;/);
});

test("debate documentation uses EggR state paths", () => {
  const debateReference = readText(
    "assets",
    "codex-orchestrator-plugin",
    "skills",
    "codex-orchestrator",
    "references",
    "debate.md",
  );

  assert.ok(debateReference.includes("EggR workspace state `discussions/`"));
  assert.ok(debateReference.includes("EggR workspace state `sessions/<run-id>/`"));
  assert.ok(!debateReference.includes("<repo-root>/discussions/"));
  assert.ok(!debateReference.includes(".system_generated"));
});

test("compiled runtime excludes stale path and workflow patterns", () => {
  const runtimeFiles = [
    readText("out", "extension.js"),
    readText("out", "WorkspacePaths.js"),
    readText("out", "DashboardController.js"),
    readText("webview", "main.js"),
  ].join("\n");

  for (const forbidden of [
    "launchAthenaLoop",
    "OrchestratorService",
    "operational-data",
    ".system_generated",
    "tokenStatus = emptyTokenStatus()",
  ]) {
    assert.ok(!runtimeFiles.includes(forbidden), `Forbidden runtime pattern remained: ${forbidden}`);
  }

  assert.ok(runtimeFiles.includes("pendingRefreshForce"));
  assert.ok(runtimeFiles.includes("workspaceStoragePathForFolder"));

  const tokenManagerOut = readText("out", "TokenManager.js");
  assert.ok(tokenManagerOut.includes("triggerCodexLiveRefresh"), "Expected triggerCodexLiveRefresh in TokenManager.js");
  assert.ok(tokenManagerOut.includes("findCodexCli"), "Expected findCodexCli in TokenManager.js");
});

console.log("headless tests passed");
