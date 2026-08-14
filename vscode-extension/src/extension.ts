import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { DashboardProvider } from "./DashboardProvider";
import {
  ConfigurationCenter,
  ConfigurationSection,
} from "./ConfigurationCenter";
import { installAntigravityPlugin } from "./installAntigravityPlugin";
import {
  ensureIntegratedPowerStorageMigration,
  legacyWorkspaceStorageCandidates,
  resolveIntegratedPowerStateRoot,
  resolveEggRWorkspaceDescriptor,
  workspaceStoragePathForFolder,
} from "./storagePath";
import { offerFirstRunSetup } from "./configurationModel";
import { BrokerController } from "./BrokerController";

async function migrateLegacyDashboardState(context: vscode.ExtensionContext): Promise<number> {
  const primaryFolder = vscode.workspace.workspaceFolders?.[0];
  if (!primaryFolder) {
    return 0;
  }

  const descriptor = resolveEggRWorkspaceDescriptor(primaryFolder.uri.fsPath);
  const destination = workspaceStoragePathForFolder(
    resolveIntegratedPowerStateRoot(),
    descriptor.repoRoot,
    descriptor.remoteUrl,
    descriptor.configuredId,
  );
  let copiedFiles = 0;

  for (const source of legacyWorkspaceStorageCandidates(
    context.globalStorageUri.fsPath,
    primaryFolder.uri.fsPath,
  )) {
    if (path.resolve(source) !== path.resolve(destination) && fs.existsSync(source)) {
      copiedFiles += await copyMissingFiles(source, destination);
    }
  }

  return copiedFiles;
}

async function copyMissingFiles(source: string, destination: string): Promise<number> {
  await fs.promises.mkdir(destination, { recursive: true });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copied += await copyMissingFiles(sourcePath, destinationPath);
    } else if (entry.isFile() && !fs.existsSync(destinationPath)) {
      await fs.promises.copyFile(sourcePath, destinationPath);
      copied++;
    }
  }

  return copied;
}

async function installOrUpdateEggROrchestrator(
  context: vscode.ExtensionContext,
  provider: DashboardProvider,
): Promise<string> {
  try {
    const installResult = await installAntigravityPlugin(context);
    const migratedFiles = await migrateLegacyDashboardState(context);
    await provider.refresh();

    if (!installResult.installed) {
      throw new Error(
        installResult.reason ?? "Integrated Orchestrator를 설치하지 못했습니다.",
      );
    }

    return [
      "Integrated Orchestrator 설치 완료",
      installResult.migratedLegacy
        ? "이전 codex-orchestrator 플러그인은 백업 후 전환"
        : undefined,
      `기존 Dashboard 상태 ${migratedFiles}개 파일 복사`,
      "GEMINI.md 변경 없음",
    ]
      .filter(Boolean)
      .join(" · ");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Integrated Orchestrator 설치 실패: ${message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  ensureIntegratedPowerStorageMigration();
  const provider = new DashboardProvider(context);
  const brokerController = new BrokerController();
  context.subscriptions.push(brokerController);
  const openConfigurationCenter = (section: ConfigurationSection = "overview") =>
    ConfigurationCenter.open(
      context,
      section,
      () => provider.refresh(),
      () => installOrUpdateEggROrchestrator(context, provider),
    );
  const toolbarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  toolbarItem.text = "$(pulse) Integrated Power";
  toolbarItem.tooltip = "Open Integrated Power compact control panel";
  toolbarItem.command = "integratedPower.agentRuns.openCompact";
  toolbarItem.show();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("integratedPower.agentRunsDashboard", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("integratedPower.agentRuns.refresh", () => provider.refresh(true)),
    vscode.commands.registerCommand("integratedPower.agentRuns.openCompact", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.integratedPower");
      await provider.refresh(true);
    }),
    vscode.commands.registerCommand("integratedPower.agentRuns.openRunsFile", () => provider.openRunsFile()),
    vscode.commands.registerCommand(
      "integratedPower.agentRuns.configureViews",
      () => openConfigurationCenter("dashboard"),
    ),
    vscode.commands.registerCommand(
      "integratedPower.eggr.openConfigurationCenter",
      () => openConfigurationCenter("overview"),
    ),
    vscode.commands.registerCommand(
      "integratedPower.eggr.runFirstRunSetup",
      () => openConfigurationCenter("overview"),
    ),
    vscode.commands.registerCommand(
      "integratedPower.eggr.runDashboardSetup",
      () => openConfigurationCenter("dashboard"),
    ),
    vscode.commands.registerCommand(
      "integratedPower.eggr.runOrchestratorSetup",
      () => openConfigurationCenter("orchestrator"),
    ),
    vscode.commands.registerCommand(
      "integratedPower.eggr.runPrivateKnowledgeSetup",
      () => openConfigurationCenter("knowledge"),
    ),
    vscode.commands.registerCommand(
      "integratedPower.eggr.installOrUpdateOrchestrator",
      () => openConfigurationCenter("orchestrator"),
    ),
    vscode.commands.registerCommand(
      "integratedPower.broker.start",
      async () => {
        await brokerController.start(context);
        void vscode.window.showInformationMessage(
          `Integrated Power broker is listening on 127.0.0.1:${brokerController.getPort()}.`,
        );
      },
    ),
    vscode.commands.registerCommand(
      "integratedPower.broker.openDashboard",
      async () => {
        await brokerController.start(context);
        await vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${brokerController.getPort()}/v1/tasks`));
      },
    ),
    vscode.commands.registerCommand(
      "integratedPower.local.startDModelServer",
      async () => {
        try {
          const message = await brokerController.startDLocalModelServer(context);
          void vscode.window.showInformationMessage(message || "D: local model server is ready.");
        } catch (error) {
          void vscode.window.showErrorMessage(
            `D: local model server could not start: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    ),
    provider,
    toolbarItem,
  );

  void brokerController.start(context).catch((error) => {
    void vscode.window.showWarningMessage(
      `Integrated Power broker could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  void provider.refresh();
  void offerFirstRunSetup(context, () => openConfigurationCenter("overview"));
}

export function deactivate(): void {
  // Disposables registered in activate are disposed by VS Code.
}
