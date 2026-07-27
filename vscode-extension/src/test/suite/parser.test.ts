import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DashboardController } from '../../DashboardController';
import { RunStore } from '../../RunStore';
import { TokenManager } from '../../TokenManager';
import { DashboardState } from '../../types';
import {
  eggRWorkspaceId,
  normalizeEggRRemoteIdentity,
  normalizeWorkspacePathForStorage,
  resolveEggRStateRoot,
  resolveEggRWorkspaceDescriptor,
  workspaceStoragePathForFolder,
} from '../../storagePath';

suite('Parser and Store Test Suite', () => {
  const workspaceRootForTests = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || __dirname;
  const testEggRStateRoot = path.join(workspaceRootForTests, '.test-eggr-state');
  process.env.EGGR_STATE_ROOT = testEggRStateRoot;
  vscode.window.showInformationMessage('Start all tests.');

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
    const sshRemote = 'git@github.com:R-Github04/Intergrated-POWER.git';
    const httpsRemote = 'https://github.com/R-Github04/Intergrated-POWER.git';
    const workspaceId = eggRWorkspaceId(folderPath, sshRemote);
    const expected = path.join(storageRoot, 'workspaces', workspaceId);

    assert.strictEqual(normalizeWorkspacePathForStorage(folderPath), 'C:\\Projects\\Example');
    assert.strictEqual(normalizeEggRRemoteIdentity(sshRemote), 'github.com/r-github04/intergrated-power');
    assert.strictEqual(workspaceId, eggRWorkspaceId('D:\\Moved\\Example', httpsRemote));
    assert.strictEqual(workspaceStoragePathForFolder(storageRoot, folderPath, sshRemote), expected);
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

      assert.strictEqual(resolveEggRStateRoot({}, tempHome, 'win32'), path.resolve(configuredStateRoot));
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
    const webviewPath = path.join(extensionRoot, 'webview', 'main.js');
    const stylesPath = path.join(extensionRoot, 'webview', 'styles.css');
    const debateReferencePath = path.join(
      extensionRoot,
      'assets',
      'codex-orchestrator-plugin',
      'skills',
      'codex-orchestrator',
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
      'integratedPower.eggr.runDashboardSetup',
      'integratedPower.eggr.runFirstRunSetup',
      'integratedPower.eggr.runOrchestratorSetup',
      'integratedPower.eggr.runPrivateKnowledgeSetup',
    ]);

    const webview = fs.readFileSync(webviewPath, 'utf8');
    assert.ok(!webview.includes('tokenStatus = emptyTokenStatus()'));
    assert.ok(webview.includes('dashboardState.isTokenLoading = true'));
    assert.ok(webview.includes('<button type="button" data-command="refresh">Refresh</button>'));
    assert.ok(!webview.includes('data-command="refresh" ${dashboardState.isLoading ? "disabled" : ""}'));

    const styles = fs.readFileSync(stylesPath, 'utf8');
    assert.match(styles, /\.loading-strip\s*\{[\s\S]*position:\s*fixed;/);

    const debateReference = fs.readFileSync(debateReferencePath, 'utf8');
    assert.ok(debateReference.includes("EggR workspace state `discussions/`"));
    assert.ok(debateReference.includes("EggR workspace state `sessions/<run-id>/`"));
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

  test('Extension commands use the EggR workspace state Open Runs target', async () => {
    const extension = vscode.extensions.getExtension('integratedpower.antigravity-ide-dashboard');
    assert.ok(extension, 'Dashboard extension should be available in the extension host.');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('integratedPower.agentRuns.refresh'));
    assert.ok(commands.includes('integratedPower.agentRuns.openRunsFile'));
    assert.ok(commands.includes('integratedPower.eggr.installOrUpdateOrchestrator'));
    assert.ok(!commands.includes('integratedPower.agentRuns.launchAthenaLoop'));

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, 'Test host should open the extension folder as a workspace.');

    const descriptor = resolveEggRWorkspaceDescriptor(workspaceRoot);
    const storagePath = workspaceStoragePathForFolder(
      resolveEggRStateRoot(),
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
