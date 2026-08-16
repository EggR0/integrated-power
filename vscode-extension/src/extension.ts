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
  resolveIntegratedPowerStateRoot,
  resolveEggRWorkspaceDescriptor,
  workspaceStoragePathForFolder,
} from "./storagePath";
import { offerFirstRunSetup } from "./configurationModel";
import { BrokerController } from "./BrokerController";

async function installOrUpdateEggROrchestrator(
  context: vscode.ExtensionContext,
  provider: DashboardProvider,
): Promise<string> {
  try {
    const installResult = await installAntigravityPlugin(context);
    await provider.refresh();

    if (!installResult.installed) {
      throw new Error(
        installResult.reason ?? "Integrated Orchestrator를 설치하지 못했습니다.",
      );
    }

    return "Integrated Orchestrator 설치 완료";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Integrated Orchestrator 설치 실패: ${message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
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
    vscode.commands.registerCommand(
      "integratedPower.broker.showLogs",
      () => brokerController.showLogs(false),
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
