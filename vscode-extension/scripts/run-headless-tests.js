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
const {
  createPluginInstallPlan,
  executePluginInstallPlan,
} = require("../out/pluginInstallerCore");

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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test("EggR workspace identity is stable across Windows paths and Git URL forms", () => {
  const storageRoot = "C:\\Users\\tester\\AppData\\Local\\EggR\\state";
  const folderPath = "C:\\Projects\\Example";
  const sshRemote = "git@example.com:example-org/example-repo.git";
  const httpsRemote = "https://example.com/example-org/example-repo.git";
  const workspaceId = eggRWorkspaceId(folderPath, sshRemote);
  const expected = path.join(storageRoot, "workspaces", workspaceId);

  assert.strictEqual(normalizeWorkspacePathForStorage(folderPath), "C:\\Projects\\Example");
  assert.strictEqual(normalizeEggRRemoteIdentity(sshRemote), "example.com/example-org/example-repo");
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
    "integratedPower.eggr.openConfigurationCenter",
    "integratedPower.eggr.runDashboardSetup",
    "integratedPower.eggr.runFirstRunSetup",
    "integratedPower.eggr.runOrchestratorSetup",
    "integratedPower.eggr.runPrivateKnowledgeSetup",
  ]);
});

test("configuration center keeps three independent setup models", () => {
  const modelSource = readText("src", "configurationModel.ts");
  const centerSource = readText("src", "ConfigurationCenter.ts");

  assert.ok(modelSource.includes("saveDashboardConfiguration"));
  assert.ok(modelSource.includes("saveOrchestratorConfiguration"));
  assert.ok(modelSource.includes("runPrivateKnowledgeConfiguration"));
  assert.ok(modelSource.includes('"local_only" | "private_remote"'));
  assert.ok(modelSource.includes('"auto" | "user_default"'));
  assert.ok(centerSource.includes("EggR Configuration Center"));
  assert.ok(fs.existsSync(path.join(extensionRoot, "assets", "private-git-knowledge.md")));
});

test("extension README identifies the Antigravity IDE product boundary", () => {
  const readme = readText("README.md");

  assert.ok(readme.includes("Antigravity IDE 전용 확장 프로그램"));
  assert.ok(readme.includes("%LOCALAPPDATA%\\Programs\\Antigravity IDE\\bin\\antigravity-ide.cmd"));
  assert.ok(readme.includes("%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe"));
  assert.ok(readme.includes("Codex용 확장도 아니다"));
  assert.ok(!readme.includes("comprehensive VS Code extension"));
});

test("dashboard activation does not silently install or overwrite the EggR orchestrator", () => {
  const extensionSource = readText("src", "extension.ts");
  const activateBlock = extensionSource.slice(extensionSource.indexOf("export function activate"));

  assert.ok(!activateBlock.includes("installAntigravityPlugin(context);"));
  assert.ok(!extensionSource.includes("initializeGlobalProtocol"));
  assert.ok(!extensionSource.includes("dashboard_global_storage.txt"));
  assert.ok(extensionSource.includes("integratedPower.eggr.installOrUpdateOrchestrator"));
  assert.ok(extensionSource.includes("integratedPower.eggr.openConfigurationCenter"));
  assert.ok(!fs.existsSync(path.join(extensionRoot, "assets", "gemini.md")));
  const setupSources = [
    extensionSource,
    readText("src", "ConfigurationCenter.ts"),
    readText("src", "configurationModel.ts"),
  ].join("\n");
  assert.ok(!setupSources.includes("Ensure-GlobalRoutingRules"));
  assert.ok(!setupSources.includes("InstallGlobalRules"));
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
    "eggr-orchestrator-plugin",
    "skills",
    "eggr-orchestrator",
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

async function runPluginDistributionTests() {
  const sourcePath = path.join(extensionRoot, "assets", "eggr-orchestrator-plugin");
  const fixedNow = new Date("2026-07-27T12:00:00.000Z");

  await testAsync("plugin installer performs a clean install without scanning unrelated paths", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "eggr-plugin-clean-"));
    const decoy = path.join(homeDir, "Documents", "codex-orchestrator-plugin", "keep.txt");
    const gemini = path.join(homeDir, ".gemini", "GEMINI.md");
    try {
      fs.mkdirSync(path.dirname(decoy), { recursive: true });
      fs.writeFileSync(decoy, "unrelated", "utf8");
      fs.mkdirSync(path.dirname(gemini), { recursive: true });
      fs.writeFileSync(gemini, "user rules", "utf8");
      const options = {
        homeDir,
        sourcePath,
        extensionVersion: "test",
        now: fixedNow,
        processId: 1001,
      };
      const plan = createPluginInstallPlan(options);
      assert.strictEqual(plan.blocked, false);
      assert.deepStrictEqual(plan.actions.map((action) => action.type), ["install"]);
      const result = await executePluginInstallPlan(options, plan);
      assert.strictEqual(result.installed, true);
      assert.strictEqual(fs.readFileSync(decoy, "utf8"), "unrelated");
      assert.strictEqual(fs.readFileSync(gemini, "utf8"), "user rules");
      assert.ok(fs.existsSync(path.join(result.destination, ".eggr-install-state.json")));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  await testAsync("plugin installer migrates the exact 0.4.2 legacy path to backup", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "eggr-plugin-legacy-"));
    const pluginRoot = path.join(homeDir, ".gemini", "config", "plugins");
    const legacy = path.join(pluginRoot, "codex-orchestrator-plugin");
    const gemini = path.join(homeDir, ".gemini", "GEMINI.md");
    try {
      writePluginFixture(legacy, "codex-orchestrator-plugin", "codex-orchestrator", "1.2.0");
      fs.writeFileSync(path.join(legacy, "user-note.txt"), "preserve me", "utf8");
      fs.writeFileSync(gemini, "user rules", "utf8");
      const options = {
        homeDir,
        sourcePath,
        extensionVersion: "test",
        now: fixedNow,
        processId: 1002,
      };
      const plan = createPluginInstallPlan(options);
      assert.deepStrictEqual(
        plan.actions.map((action) => action.type),
        ["install", "backup-legacy"],
      );
      const result = await executePluginInstallPlan(options, plan);
      assert.strictEqual(fs.existsSync(legacy), false);
      assert.strictEqual(result.migratedLegacy, true);
      assert.strictEqual(result.backupPaths.length, 1);
      assert.strictEqual(
        fs.readFileSync(path.join(result.backupPaths[0], "user-note.txt"), "utf8"),
        "preserve me",
      );
      assert.strictEqual(fs.readFileSync(gemini, "utf8"), "user rules");
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  await testAsync("plugin installer blocks an unrecognized legacy-path conflict", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "eggr-plugin-conflict-"));
    const legacy = path.join(
      homeDir,
      ".gemini",
      "config",
      "plugins",
      "codex-orchestrator-plugin",
    );
    try {
      writePluginFixture(legacy, "codex-orchestrator-plugin", "codex-orchestrator", "9.0.0");
      const plan = createPluginInstallPlan({
        homeDir,
        sourcePath,
        extensionVersion: "test",
        now: fixedNow,
      });
      assert.strictEqual(plan.blocked, true);
      assert.match(plan.blockingReason, /will not be moved/);
      assert.ok(fs.existsSync(legacy));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  await testAsync("plugin installer rolls the legacy path back after an injected interruption", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "eggr-plugin-rollback-"));
    const legacy = path.join(
      homeDir,
      ".gemini",
      "config",
      "plugins",
      "codex-orchestrator-plugin",
    );
    try {
      writePluginFixture(legacy, "codex-orchestrator-plugin", "codex-orchestrator", "1.2.0");
      const options = {
        homeDir,
        sourcePath,
        extensionVersion: "test",
        now: fixedNow,
        processId: 1003,
        failAt: "after-legacy-backup",
      };
      const plan = createPluginInstallPlan(options);
      await assert.rejects(() => executePluginInstallPlan(options, plan), /Injected/);
      assert.ok(fs.existsSync(legacy));
      assert.strictEqual(
        fs.existsSync(path.join(plan.pluginRoot, "eggr-orchestrator-plugin")),
        false,
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  await testAsync("plugin installer is idempotent when managed checksums match", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "eggr-plugin-idempotent-"));
    try {
      fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
      const options = {
        homeDir,
        sourcePath,
        extensionVersion: "test",
        now: fixedNow,
        processId: 1004,
      };
      await executePluginInstallPlan(options);
      const secondPlan = createPluginInstallPlan(options);
      assert.deepStrictEqual(secondPlan.actions.map((action) => action.type), ["no-op"]);
      const secondResult = await executePluginInstallPlan(options, secondPlan);
      assert.strictEqual(secondResult.changed, false);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
}

function writePluginFixture(root, pluginName, skillName, version) {
  fs.mkdirSync(path.join(root, "skills", skillName), { recursive: true });
  const legacyAuthor = String.fromCharCode(106, 115, 112, 48);
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    `${JSON.stringify({ name: pluginName, version, author: { name: legacyAuthor } }, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: test fixture\n---\n`,
    "utf8",
  );
}

runPluginDistributionTests()
  .then(() => console.log("headless tests passed"))
  .catch(() => {
    process.exitCode = 1;
  });
