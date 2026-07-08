const assert = require("assert");
const fs = require("fs");
const path = require("path");

const extensionRoot = path.resolve(__dirname, "..");
const {
  normalizeWorkspacePathForStorage,
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

test("workspace storage path uses Antigravity globalStorage workspace hash", () => {
  const storageRoot = "C:\\Users\\tester\\AppData\\Roaming\\Antigravity IDE\\User\\globalStorage\\integratedpower.antigravity-ide-dashboard";
  const folderPath = "C:\\Projects\\Example";
  const expected = path.join(storageRoot, "workspaces", "50ce1bf3906f6a0c46337bc7cac06b27");

  assert.strictEqual(normalizeWorkspacePathForStorage(folderPath), "c:\\Projects\\Example");
  assert.strictEqual(workspaceStoragePathForFolder(storageRoot, folderPath), expected);
});

test("package commands exclude removed Athena workflow", () => {
  const manifest = JSON.parse(readText("package.json"));
  const commands = (manifest.contributes?.commands ?? []).map((entry) => entry.command).sort();

  assert.deepStrictEqual(commands, [
    "integratedPower.agentRuns.openRunsFile",
    "integratedPower.agentRuns.refresh",
  ]);
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

test("debate documentation uses globalStorage paths", () => {
  const debateReference = readText(
    "assets",
    "ai-delegation-plugin",
    "skills",
    "ai-delegation",
    "references",
    "debate.md",
  );

  assert.ok(debateReference.includes("globalStorage path's `discussions/`"));
  assert.ok(debateReference.includes("globalStorage path's `sessions/<run-id>/`"));
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
});

console.log("headless tests passed");
