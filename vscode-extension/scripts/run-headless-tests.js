const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const extensionRoot = path.resolve(__dirname, "..");
const {
  eggRWorkspaceId,
  normalizeEggRRemoteIdentity,
  normalizeWorkspacePathForStorage,
  ensureIntegratedPowerStorageMigration,
  integratedPowerRootsConfigPath,
  resolveAntigravityPluginRoot,
  resolveIntegratedPowerKnowledgeRoot,
  resolveIntegratedPowerStateRoot,
  resolveIntegratedPowerToolsRoot,
  resolveIntegratedPowerWorkRoot,
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

test("legacy roots config accepts a Windows PowerShell UTF-8 BOM", () => {
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

test("bundled Knowledge resolver prefers canonical roots and avoids pwsh reserved variables", () => {
  const source = readText("assets", "knowledge-tools", "eggr-roots.ps1");
  assert.ok(source.includes(".config\\integrated-power\\roots.json"));
  assert.ok(source.includes(".config\\eggr\\roots.json"));
  assert.ok(source.includes("$runningOnWindows"));
  assert.ok(!source.includes("$isWindows ="));
});

test("portable roots resolve from one machine-local contract without scanning user folders", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "integrated-power-portable-"));
  const configPath = path.join(tempHome, "settings", "roots.json");
  const workRoot = path.join(tempHome, "chosen", "Work");
  const knowledgeRoot = path.join(tempHome, "elsewhere", "Knowledge");
  const pluginRoot = path.join(tempHome, "antigravity-profile", "plugins");
  const toolsRoot = path.join(tempHome, "portable-bin");
  const env = {
    INTEGRATED_POWER_ROOTS_CONFIG: configPath,
    LOCALAPPDATA: path.join(tempHome, "LocalAppData"),
  };
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      `${JSON.stringify({
        work_root: workRoot,
        knowledge: knowledgeRoot,
        antigravity_plugin_root: pluginRoot,
        tools_root: toolsRoot,
      }, null, 2)}\n`,
      "utf8",
    );
    assert.strictEqual(integratedPowerRootsConfigPath(tempHome, env), path.resolve(configPath));
    assert.deepStrictEqual(resolveIntegratedPowerWorkRoot(env, tempHome), {
      path: path.resolve(workRoot), source: "config", configured: true,
    });
    assert.deepStrictEqual(resolveIntegratedPowerKnowledgeRoot(env, tempHome), {
      path: path.resolve(knowledgeRoot), source: "config", configured: true,
    });
    assert.deepStrictEqual(resolveAntigravityPluginRoot(env, tempHome), {
      path: path.resolve(pluginRoot), source: "config", configured: true,
    });
    assert.deepStrictEqual(resolveIntegratedPowerToolsRoot(env, tempHome, "win32"), {
      path: path.resolve(toolsRoot), source: "config", configured: true,
    });
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("portable path environment overrides are explicit and user-scoped", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "integrated-power-env-"));
  const env = {
    INTEGRATED_POWER_ROOTS_CONFIG: path.join(tempHome, "missing", "roots.json"),
    INTEGRATED_POWER_WORK_ROOT: path.join(tempHome, "WorkOverride"),
    INTEGRATED_POWER_KNOWLEDGE_ROOT: path.join(tempHome, "KnowledgeOverride"),
    INTEGRATED_POWER_ANTIGRAVITY_PLUGIN_ROOT: path.join(tempHome, "PluginOverride"),
    INTEGRATED_POWER_TOOLS_ROOT: path.join(tempHome, "ToolsOverride"),
  };
  try {
    for (const resolved of [
      resolveIntegratedPowerWorkRoot(env, tempHome),
      resolveIntegratedPowerKnowledgeRoot(env, tempHome),
      resolveAntigravityPluginRoot(env, tempHome),
      resolveIntegratedPowerToolsRoot(env, tempHome, "win32"),
    ]) {
      assert.strictEqual(resolved.source, "environment");
      assert.strictEqual(resolved.configured, true);
      assert.ok(resolved.path.startsWith(tempHome));
    }
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("an explicit roots file never falls through to another profile's legacy config", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "integrated-power-no-fallback-"));
  const legacyConfig = path.join(tempHome, ".config", "eggr", "roots.json");
  const env = {
    INTEGRATED_POWER_ROOTS_CONFIG: path.join(tempHome, "isolated", "roots.json"),
  };
  try {
    fs.mkdirSync(path.dirname(legacyConfig), { recursive: true });
    fs.writeFileSync(
      legacyConfig,
      `${JSON.stringify({ work_root: path.join(tempHome, "legacy-work") })}\n`,
      "utf8",
    );
    const resolved = resolveIntegratedPowerWorkRoot(env, tempHome);
    assert.strictEqual(resolved.source, "default");
    assert.strictEqual(resolved.configured, false);
    assert.notStrictEqual(resolved.path, path.join(tempHome, "legacy-work"));
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("Integrated Power uses its product state root and copies legacy files without deleting them", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "integrated-power-state-"));
  const localAppData = path.join(tempHome, "AppData", "Local");
  const legacyState = path.join(localAppData, "EggR", "state");
  const productState = path.join(localAppData, "IntegratedPower", "state");
  const legacyFile = path.join(legacyState, "workspaces", "example", "report.json");
  try {
    fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
    fs.writeFileSync(legacyFile, "legacy", "utf8");
    const env = { LOCALAPPDATA: localAppData };
    assert.strictEqual(
      resolveIntegratedPowerStateRoot(env, tempHome, "win32"),
      path.resolve(productState),
    );
    const migration = ensureIntegratedPowerStorageMigration(
      env,
      tempHome,
      "win32",
    );
    assert.strictEqual(migration.copiedFiles, 1);
    assert.strictEqual(
      fs.readFileSync(path.join(productState, "workspaces", "example", "report.json"), "utf8"),
      "legacy",
    );
    assert.strictEqual(fs.readFileSync(legacyFile, "utf8"), "legacy");
    assert.ok(
      fs.existsSync(
        path.join(tempHome, ".config", "integrated-power", "roots.json"),
      ),
    );
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

test("package uses the EggR publisher and canonical public repository", () => {
  const manifest = JSON.parse(readText("package.json"));
  const readme = readText("README.md");

  assert.strictEqual(`${manifest.publisher}.${manifest.name}`, "EggR.integrated-power");
  assert.strictEqual(
    manifest.repository?.url,
    "https://github.com/EggR0/integrated-power.git",
  );
  assert.strictEqual(
    manifest.homepage,
    "https://github.com/EggR0/integrated-power#readme",
  );
  assert.ok(manifest.keywords.includes("eggr"));
  assert.ok(!readme.includes("현재 배포 준비판"));
  assert.ok(!readme.includes("최초 공개판"));
  assert.ok(!readme.includes("게시 전에는"));
});

test("configuration center keeps three independent setup models", () => {
  const modelSource = readText("src", "configurationModel.ts");
  const centerSource = readText("src", "ConfigurationCenter.ts");
  const installerSource = readText("src", "KnowledgeToolInstaller.ts");

  assert.ok(modelSource.includes("saveDashboardConfiguration"));
  assert.ok(modelSource.includes("saveOrchestratorConfiguration"));
  assert.ok(modelSource.includes("runPrivateKnowledgeConfiguration"));
  assert.ok(modelSource.includes('"local_only" | "private_remote"'));
  assert.ok(modelSource.includes('"auto" | "user_default"'));
  assert.ok(centerSource.includes("Integrated Power Configuration Center"));
  assert.ok(centerSource.includes("상태 다시 확인은 현재 Windows 사용자·시스템 PATH를 새로 읽으므로"));
  assert.ok(centerSource.includes("save-agent-worklog"));
  assert.ok(centerSource.includes("내장 Knowledge 도구 설치·복구"));
  assert.ok(centerSource.includes("Knowledge는 main으로 통합해야 합니다."));
  assert.ok(installerSource.includes("resolveIntegratedPowerToolsRoot"));
  assert.ok(installerSource.includes(".integrated-power-backups"));
  assert.ok(centerSource.includes('id="plugin-root"'));
  assert.ok(centerSource.includes('id="work-root"'));
  assert.ok(centerSource.includes('id="tools-root"'));
  assert.ok(centerSource.includes("다른 PC의 절대 경로를 복사하거나 사용자 홈을 훑어 추측하지 않습니다."));
  assert.ok(fs.existsSync(path.join(extensionRoot, "assets", "private-git-knowledge.md")));
  for (const name of [
    "eggr-roots.ps1",
    "set-eggr-roots.ps1",
    "initialize-eggr-knowledge.ps1",
    "route-knowledge.ps1",
    "save-knowledge.ps1",
    "save-agent-worklog.ps1",
  ]) {
    assert.ok(
      fs.existsSync(path.join(extensionRoot, "assets", "knowledge-tools", name)),
      `Bundled Knowledge tool is missing: ${name}`,
    );
  }
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

test("debate documentation uses Integrated Power state paths", () => {
  const debateReference = readText(
    "assets",
    "ip-orchestrator-plugin",
    "skills",
    "ip-orchestrator",
    "references",
    "debate.md",
  );

  assert.ok(debateReference.includes("Integrated Power workspace state `discussions/`"));
  assert.ok(debateReference.includes("Integrated Power workspace state `sessions/<run-id>/`"));
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
  const sourcePath = path.join(extensionRoot, "assets", "ip-orchestrator-plugin");
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
      assert.ok(fs.existsSync(path.join(result.destination, ".integrated-power-install-state.json")));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  await testAsync("plugin installer honors a user-selected root outside the default home profile", async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ip-plugin-custom-root-"));
    const homeDir = path.join(scratch, "user-home");
    const pluginRoot = path.join(scratch, "custom-antigravity", "plugins");
    try {
      fs.mkdirSync(homeDir, { recursive: true });
      const options = {
        homeDir,
        pluginRoot,
        sourcePath,
        extensionVersion: "test",
        now: fixedNow,
        processId: 1010,
      };
      const plan = createPluginInstallPlan(options);
      assert.strictEqual(plan.pluginRoot, path.resolve(pluginRoot));
      assert.strictEqual(plan.blocked, false);
      const result = await executePluginInstallPlan(options, plan);
      assert.strictEqual(result.installed, true);
      assert.ok(result.destination.startsWith(path.resolve(pluginRoot)));
      assert.strictEqual(fs.existsSync(path.join(homeDir, ".gemini")), false);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
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

  await testAsync("plugin installer migrates the exact eggr predecessor to ip-orchestrator", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ip-plugin-predecessor-"));
    const pluginRoot = path.join(homeDir, ".gemini", "config", "plugins");
    const predecessor = path.join(pluginRoot, "eggr-orchestrator-plugin");
    try {
      writePluginFixture(
        predecessor,
        "eggr-orchestrator-plugin",
        "eggr-orchestrator",
        "2.1.0",
        { eggr: { productId: "eggr-orchestrator", managed: true } },
      );
      fs.writeFileSync(path.join(predecessor, "user-note.txt"), "preserve me", "utf8");
      const options = {
        homeDir,
        sourcePath,
        extensionVersion: "test",
        now: fixedNow,
        processId: 1005,
      };
      const plan = createPluginInstallPlan(options);
      assert.deepStrictEqual(
        plan.actions.map((action) => action.type),
        ["install", "backup-legacy"],
      );
      const result = await executePluginInstallPlan(options, plan);
      assert.strictEqual(fs.existsSync(predecessor), false);
      assert.ok(fs.existsSync(path.join(result.destination, "skills", "ip-orchestrator", "SKILL.md")));
      assert.strictEqual(
        fs.readFileSync(path.join(result.backupPaths[0], "user-note.txt"), "utf8"),
        "preserve me",
      );
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
        fs.existsSync(path.join(plan.pluginRoot, "ip-orchestrator-plugin")),
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

function writePluginFixture(root, pluginName, skillName, version, extraManifest = {}) {
  fs.mkdirSync(path.join(root, "skills", skillName), { recursive: true });
  const legacyAuthor = String.fromCharCode(106, 115, 112, 48);
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    `${JSON.stringify({ name: pluginName, version, author: { name: legacyAuthor }, ...extraManifest }, null, 2)}\n`,
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
