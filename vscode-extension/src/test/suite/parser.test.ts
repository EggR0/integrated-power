import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DashboardController } from '../../DashboardController';
import { RunStore } from '../../RunStore';
import { TokenManager } from '../../TokenManager';
import { DashboardState } from '../../types';
import { findExecutable } from '../../configurationModel';
import {
  inspectKnowledgeTools,
  installKnowledgeTools,
} from '../../KnowledgeToolInstaller';
import {
  eggRWorkspaceId,
  normalizeEggRRemoteIdentity,
  normalizeWorkspacePathForStorage,
  resolveIntegratedPowerStateRoot,
  resolveEggRWorkspaceDescriptor,
  workspaceStoragePathForFolder,
} from '../../storagePath';

suite('Parser and Store Test Suite', () => {
  const workspaceRootForTests = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || __dirname;
  const testEggRStateRoot = path.join(workspaceRootForTests, '.test-eggr-state');
  process.env.INTEGRATED_POWER_STATE_ROOT = testEggRStateRoot;
  vscode.window.showInformationMessage('Start all tests.');

  test('Bundled Knowledge tools install independently with backup-on-update', () => {
    const previousLocalAppData = process.env.LOCALAPPDATA;
    const previousRootsConfig = process.env.INTEGRATED_POWER_ROOTS_CONFIG;
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'integrated-power-tools-'));
    process.env.LOCALAPPDATA = scratchRoot;
    process.env.INTEGRATED_POWER_ROOTS_CONFIG = path.join(
      scratchRoot,
      'config',
      'roots.json',
    );
    const extensionRoot = path.resolve(__dirname, '../../..');
    const context = {
      extensionPath: extensionRoot,
      extension: { packageJSON: { version: 'test' } },
    } as unknown as vscode.ExtensionContext;

    try {
      const first = installKnowledgeTools(context);
      assert.ok(first.installed);
      assert.strictEqual(first.changed.length, 12);
      assert.ok(fs.existsSync(first.wizardPath));
      assert.ok(fs.existsSync(first.routerPath));
      assert.ok(fs.existsSync(first.savePath));

      fs.writeFileSync(first.savePath, 'user-modified-test', 'utf8');
      const repaired = installKnowledgeTools(context);
      assert.ok(repaired.installed);
      assert.ok(repaired.changed.includes('save-knowledge.ps1'));
      assert.ok(repaired.backupRoot);
      assert.ok(
        fs.existsSync(path.join(repaired.backupRoot, 'save-knowledge.ps1')),
      );
      assert.ok(inspectKnowledgeTools(context).installed);
    } finally {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
      if (previousLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = previousLocalAppData;
      }
      if (previousRootsConfig === undefined) {
        delete process.env.INTEGRATED_POWER_ROOTS_CONFIG;
      } else {
        process.env.INTEGRATED_POWER_ROOTS_CONFIG = previousRootsConfig;
      }
    }
  });

  test('RunStore handles malformed JSONL safely', async () => {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || __dirname;
    const testFile = vscode.Uri.file(path.join(workspacePath, 'test-runs.jsonl'));
    
    try {
      await vscode.workspace.fs.writeFile(
        testFile, 
        Buffer.from('{"id": "run-1", "title": "Good run"}\n{"bad": }\n{"id": "run-2", "title": "Good run 2"}')
      );

      const store = new RunStore();
      const result = await store.readRuns(testFile);

      assert.strictEqual(result.runs.length, 2, 'Should parse the 2 valid runs');
      assert.strictEqual(result.runs[0].id, 'run-1', 'Runs should be sorted by time/title or reversed');
      assert.strictEqual(result.parseErrors.length, 1, 'Should log exactly 1 parse error for the bad line');
    } finally {
      try {
        await vscode.workspace.fs.delete(testFile);
      } catch (e) {
        // Ignore deletion errors
      }
    }
  });

  test('TokenManager constructs without error (smoke test)', async () => {
    const manager = new TokenManager();
    assert.ok(manager);
  });

  test('EggR workspace identity is stable across Windows paths and Git URL forms', () => {
    const storageRoot = 'C:\\Users\\tester\\AppData\\Local\\EggR\\state';
    const folderPath = 'C:\\Projects\\Example';
    const sshRemote = 'git@example.com:example-org/example-repo.git';
    const httpsRemote = 'https://example.com/example-org/example-repo.git';
    const workspaceId = eggRWorkspaceId(folderPath, sshRemote);
    const expected = path.join(storageRoot, 'workspaces', workspaceId);

    assert.strictEqual(normalizeWorkspacePathForStorage(folderPath), 'C:\\Projects\\Example');
    assert.strictEqual(normalizeEggRRemoteIdentity(sshRemote), 'example.com/example-org/example-repo');
    assert.strictEqual(workspaceId, eggRWorkspaceId('D:\\Moved\\Example', httpsRemote));
    assert.strictEqual(workspaceStoragePathForFolder(storageRoot, folderPath, sshRemote), expected);
  });

  test('environment refresh finds GitHub CLI from the live Windows PATH', () => {
    if (process.platform !== 'win32') return;
    const inheritedPath = process.env.PATH;
    try {
      process.env.PATH = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
      const executable = findExecutable(['gh.exe', 'gh']);
      assert.ok(executable, 'GitHub CLI should be found from the current registry PATH.');
      assert.strictEqual(path.basename(executable).toLowerCase(), 'gh.exe');
    } finally {
      process.env.PATH = inheritedPath;
    }
  });

  test('EggR roots config accepts a Windows PowerShell UTF-8 BOM', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'eggr-bom-'));
    const configDirectory = path.join(tempHome, '.config', 'eggr');
    const configuredStateRoot = path.join(tempHome, 'state');

    try {
      fs.mkdirSync(configDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(configDirectory, 'roots.json'),
        `\uFEFF${JSON.stringify({ state_root: configuredStateRoot })}`,
        'utf8',
      );

      assert.strictEqual(resolveIntegratedPowerStateRoot({}, tempHome, 'win32'), path.resolve(configuredStateRoot));
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  test('RunStore treats missing globalStorage runs file as empty data', async () => {
    const store = new RunStore();
    const missingFile = vscode.Uri.file(path.join(__dirname, 'missing-runs.jsonl'));
    const result = await store.readRuns(missingFile);

    assert.deepStrictEqual(result.runs, []);
    assert.deepStrictEqual(result.activeRuns, []);
    assert.deepStrictEqual(result.artifacts, []);
    assert.deepStrictEqual(result.parseErrors, []);
  });

  test('Packaged extension sources do not contain removed workflow regressions', () => {
    const extensionRoot = path.resolve(__dirname, '../../..');
    const manifestPath = path.join(extensionRoot, 'package.json');
    const readmePath = path.join(extensionRoot, 'README.md');
    const webviewPath = path.join(extensionRoot, 'webview', 'main.js');
    const stylesPath = path.join(extensionRoot, 'webview', 'styles.css');
    const debateReferencePath = path.join(
      extensionRoot,
      'assets',
      'ip-orchestrator-plugin',
      'skills',
      'ip-orchestrator',
      'references',
      'debate.md',
    );

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      contributes?: { commands?: Array<{ command?: string }> };
    };
    const commands = manifest.contributes?.commands?.map((entry) => entry.command) ?? [];
    assert.deepStrictEqual(commands.sort(), [
      'integratedPower.agentRuns.configureViews',
      'integratedPower.agentRuns.openRunsFile',
      'integratedPower.agentRuns.refresh',
      'integratedPower.eggr.installOrUpdateOrchestrator',
      'integratedPower.eggr.openConfigurationCenter',
      'integratedPower.eggr.runDashboardSetup',
      'integratedPower.eggr.runFirstRunSetup',
      'integratedPower.eggr.runOrchestratorSetup',
      'integratedPower.eggr.runPrivateKnowledgeSetup',
    ]);

    const readme = fs.readFileSync(readmePath, 'utf8');
    assert.ok(readme.includes('Antigravity IDE 전용 확장 프로그램'));
    assert.ok(readme.includes('%LOCALAPPDATA%\\Programs\\Antigravity IDE\\bin\\antigravity-ide.cmd'));
    assert.ok(readme.includes('%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe'));
    assert.ok(readme.includes('Codex용 확장도 아니다'));
    assert.ok(!readme.includes('comprehensive VS Code extension'));

    const webview = fs.readFileSync(webviewPath, 'utf8');
    assert.ok(!webview.includes('tokenStatus = emptyTokenStatus()'));
    assert.ok(webview.includes('dashboardState.isTokenLoading = true'));
    assert.ok(!webview.includes('<button type="button" data-command="refresh">Refresh</button>'));
    assert.ok(!webview.includes('<button type="button" data-command="openRunsFile">Open Runs</button>'));
    assert.ok(webview.includes('buildTokenMetric("5Hours"'));
    assert.ok(webview.includes('buildTokenMetric("Weekly"'));
    assert.ok(webview.includes('renderCapacityGroup("ChatGPT"'));
    assert.ok(webview.includes('"ChatGPT 5Hours"'));
    assert.ok(webview.includes('"ChatGPT Weekly"'));
    assert.ok(!webview.includes('buildTokenMetric("(5Hours)"'));
    assert.ok(!webview.includes('buildTokenMetric("(Weekly)"'));
    assert.ok(!webview.includes('Refreshing, showing previous data'));
    assert.ok(!webview.includes('renderLoadingStrip'));
    assert.ok(!webview.includes('data-command="refresh" ${dashboardState.isLoading ? "disabled" : ""}'));

    const styles = fs.readFileSync(stylesPath, 'utf8');
    assert.ok(!styles.includes('.loading-strip'));
    assert.match(styles, /body\s*\{[\s\S]*min-width:\s*340px;/);
    assert.match(styles, /\.capacity-groups\s*\{[\s\S]*gap:\s*12px;/);
    assert.match(styles, /\.metric-reset-row\s*\{[\s\S]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\) max-content;/);
    assert.match(styles, /\.token-section summary::before\s*\{[\s\S]*content:\s*"\+";/);
    assert.match(styles, /\.token-section\[open\] summary::before\s*\{[\s\S]*content:\s*"-";/);
    assert.match(styles, /\.dashboard-shell\.is-refreshing \.progress-fill\s*\{[\s\S]*var\(--vscode-descriptionForeground\)/);
    assert.match(styles, /\.dashboard-shell:not\(\.is-refreshing\) \.token-metric\.warning \.progress-fill/);

    const extensionSource = fs.readFileSync(path.join(extensionRoot, 'src', 'extension.ts'), 'utf8');
    assert.ok(extensionSource.includes('integratedPower.agentRuns.refresh", () => provider.refresh(true)'));
    const dashboardControllerSource = fs.readFileSync(path.join(extensionRoot, 'src', 'DashboardController.ts'), 'utf8');
    assert.ok(dashboardControllerSource.includes('hasUsableTokenStatus(this.state.tokenStatus)'));
    assert.ok(dashboardControllerSource.includes('keep the previous visible data while refresh continues'));

    const debateReference = fs.readFileSync(debateReferencePath, 'utf8');
    assert.ok(debateReference.includes("Integrated Power workspace state `discussions/`"));
    assert.ok(debateReference.includes("Integrated Power workspace state `sessions/<run-id>/`"));
    assert.ok(!debateReference.includes('<repo-root>/discussions/'));
    assert.ok(!debateReference.includes('.system_generated'));
  });

  test('DashboardController queues refresh requests made during an active refresh', async () => {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? __dirname;
    const globalStorageUri = vscode.Uri.file(path.join(workspacePath, '.test-global-storage'));
    const controller = new DashboardController(
      {
        globalStorageUri,
        extensionPath: path.resolve(__dirname, '../../..'),
      } as unknown as vscode.ExtensionContext,
      () => undefined,
    );

    let resolveFirstRead: (() => void) | undefined;
    let readCount = 0;
    const makeState = (): DashboardState => ({
      workspaceName: 'Test Workspace',
      runs: [],
      activeRuns: [],
      artifacts: [],
      parseErrors: [],
      systemErrors: [],
      isLoading: false,
      isTokenLoading: false,
      isStale: false,
      updatedAt: new Date().toISOString(),
    });

    try {
      (controller as unknown as { refreshTokenStatus: () => Promise<void> }).refreshTokenStatus = async () => undefined;
      (controller as unknown as { readDashboardState: () => Promise<DashboardState> }).readDashboardState = async () => {
        readCount++;
        if (readCount === 1) {
          await new Promise<void>((resolve) => {
            resolveFirstRead = resolve;
          });
        }
        return makeState();
      };

      const firstRefresh = controller.refresh(false);
      await waitFor(() => readCount === 1);

      await controller.refresh(true);
      assert.strictEqual(readCount, 1, 'Refresh while busy should be queued, not run concurrently.');

      resolveFirstRead?.();
      await firstRefresh;
      await waitFor(() => readCount === 2);
      assert.strictEqual(readCount, 2, 'Queued refresh should run after the active refresh completes.');
    } finally {
      controller.dispose();
      try {
        await vscode.workspace.fs.delete(globalStorageUri, { recursive: true, useTrash: false });
      } catch {
        // Ignore cleanup failures.
      }
    }
  });

  test('Extension commands use the Integrated Power workspace state Open Runs target', async function () {
    this.timeout(10_000);
    const extension = vscode.extensions.getExtension('EggR.integrated-power');
    assert.ok(extension, 'Dashboard extension should be available in the extension host.');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('integratedPower.agentRuns.refresh'));
    assert.ok(commands.includes('integratedPower.agentRuns.openRunsFile'));
    assert.ok(commands.includes('integratedPower.eggr.installOrUpdateOrchestrator'));
    assert.ok(commands.includes('integratedPower.eggr.openConfigurationCenter'));
    assert.ok(!commands.includes('integratedPower.agentRuns.launchAthenaLoop'));

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, 'Test host should open the extension folder as a workspace.');

    const descriptor = resolveEggRWorkspaceDescriptor(workspaceRoot);
    const storagePath = workspaceStoragePathForFolder(
      resolveIntegratedPowerStateRoot(),
      descriptor.repoRoot,
      descriptor.remoteUrl,
      descriptor.configuredId,
    );
    assert.ok(storagePath.includes(path.join('.test-eggr-state', 'workspaces')));
    assert.ok(storagePath.includes('git-') || storagePath.includes('path-'));

    const runsPath = path.join(storagePath, '.agent-runs', 'runs.jsonl');
    fs.mkdirSync(path.dirname(runsPath), { recursive: true });
    fs.writeFileSync(runsPath, '{"id":"integration-run","title":"Integration run"}\n', 'utf8');

    await vscode.commands.executeCommand('integratedPower.agentRuns.openRunsFile');
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === runsPath);
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, runsPath);

    fs.rmSync(testEggRStateRoot, { recursive: true, force: true });
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
