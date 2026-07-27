import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { DashboardProvider } from "./DashboardProvider";
import { installAntigravityPlugin } from "./installAntigravityPlugin";
import {
  legacyWorkspaceStorageCandidates,
  resolveEggRStateRoot,
  resolveEggRWorkspaceDescriptor,
  workspaceStoragePathForFolder,
} from "./storagePath";

async function initializeGlobalProtocol(context: vscode.ExtensionContext): Promise<"created" | "preserved" | "missing-template"> {
  const geminiDir = path.join(os.homedir(), ".gemini");
  const globalProtocolPath = path.join(geminiDir, "GEMINI.md");
  const templatePath = path.join(context.extensionPath, "assets", "gemini.md");

  if (!fs.existsSync(templatePath)) {
    return "missing-template";
  }

  await fs.promises.mkdir(geminiDir, { recursive: true });
  if (!fs.existsSync(globalProtocolPath)) {
    await fs.promises.copyFile(templatePath, globalProtocolPath);
    return "created";
  }

  const selection = await vscode.window.showInformationMessage(
    "EggR가 기존 GEMINI.md를 보존했습니다. 최신 라우팅 규칙 템플릿을 검토하시겠습니까?",
    "템플릿 열기",
  );
  if (selection === "템플릿 열기") {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(templatePath));
    await vscode.window.showTextDocument(document, { preview: false });
  }
  return "preserved";
}

async function migrateLegacyDashboardState(context: vscode.ExtensionContext): Promise<number> {
  const primaryFolder = vscode.workspace.workspaceFolders?.[0];
  if (!primaryFolder) {
    return 0;
  }

  const descriptor = resolveEggRWorkspaceDescriptor(primaryFolder.uri.fsPath);
  const destination = workspaceStoragePathForFolder(
    resolveEggRStateRoot(),
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
): Promise<void> {
  try {
    const protocolResult = await initializeGlobalProtocol(context);
    const installResult = await installAntigravityPlugin(context);
    const migratedFiles = await migrateLegacyDashboardState(context);
    await provider.refresh();

    if (!installResult.installed) {
      void vscode.window.showWarningMessage(installResult.reason ?? "EggR 오케스트레이터를 설치하지 못했습니다.");
      return;
    }

    const protocolText =
      protocolResult === "created"
        ? "GEMINI.md 생성"
        : protocolResult === "preserved"
          ? "기존 GEMINI.md 보존"
          : "GEMINI.md 템플릿 없음";
    void vscode.window.showInformationMessage(
      `EggR 오케스트레이터 설치 완료 · ${protocolText} · 기존 상태 ${migratedFiles}개 파일 복사`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`EggR 오케스트레이터 설치 실패: ${message}`);
    throw error;
  }
}

async function configureDashboardViews(): Promise<void> {
  const config = vscode.workspace.getConfiguration("integratedPower.view");
  const showAntigravity = config.get<boolean>("showAntigravity", true);
  const showCodex = config.get<boolean>("showCodex", true);
  const showLocalLlm = config.get<boolean>("showLocalLlm", true);

  const items: vscode.QuickPickItem[] = [
    { label: "Antigravity IDE Capacity", picked: showAntigravity, description: "Show the Antigravity IDE token capacity section" },
    { label: "Codex Capacity", picked: showCodex, description: "Show the Codex API token capacity section" },
    { label: "Local LLM Status", picked: showLocalLlm, description: "Show the Local LLM status section" },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: "Select the dashboard sections you want to display",
    title: "Configure Dashboard Views",
  });

  if (selected !== undefined) {
    const selectedLabels = new Set(selected.map(item => item.label));
    await config.update("showAntigravity", selectedLabels.has("Antigravity IDE Capacity"), vscode.ConfigurationTarget.Global);
    await config.update("showCodex", selectedLabels.has("Codex Capacity"), vscode.ConfigurationTarget.Global);
    await config.update("showLocalLlm", selectedLabels.has("Local LLM Status"), vscode.ConfigurationTarget.Global);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DashboardProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("integratedPower.agentRunsDashboard", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("integratedPower.agentRuns.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("integratedPower.agentRuns.openRunsFile", () => provider.openRunsFile()),
    vscode.commands.registerCommand("integratedPower.agentRuns.configureViews", configureDashboardViews),
    vscode.commands.registerCommand(
      "integratedPower.eggr.installOrUpdateOrchestrator",
      () => installOrUpdateEggROrchestrator(context, provider),
    ),
    provider,
  );

  void provider.refresh();
}

export function deactivate(): void {
  // Disposables registered in activate are disposed by VS Code.
}
