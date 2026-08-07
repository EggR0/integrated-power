import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { DashboardProvider } from "./DashboardProvider";
import { installAntigravityPlugin } from "./installAntigravityPlugin";

import * as os from "os";
import { workspaceStoragePathForFolder } from "./storagePath";

function initializeGlobalProtocol(context: vscode.ExtensionContext) {
  const geminiDir = path.join(os.homedir(), ".gemini");
  const globalProtocolPath = path.join(geminiDir, "GEMINI.md");
  const templatePath = path.join(context.extensionPath, "assets", "gemini.md");

  if (!fs.existsSync(geminiDir)) {
    fs.mkdirSync(geminiDir, { recursive: true });
  }

  if (fs.existsSync(templatePath)) {
    if (!fs.existsSync(globalProtocolPath)) {
      fs.copyFileSync(templatePath, globalProtocolPath);
      vscode.window.showInformationMessage("Antigravity IDE: Global Orchestration Protocol (GEMINI.md) initialized.");
    } else {
      vscode.window.showInformationMessage(
        "Antigravity IDE: A global GEMINI.md already exists. Do you want to review the latest protocol template?",
        "Open Template"
      ).then(selection => {
        if (selection === "Open Template") {
          vscode.workspace.openTextDocument(vscode.Uri.file(templatePath)).then(doc => {
            vscode.window.showTextDocument(doc, { preview: false });
          });
        }
      });
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  initializeGlobalProtocol(context);

  const provider = new DashboardProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("integratedPower.agentRunsDashboard", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("integratedPower.agentRuns.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("integratedPower.agentRuns.openRunsFile", () => provider.openRunsFile()),
    provider
  );

  // Install the bundled Antigravity plugin for Codex Orchestrator
  installAntigravityPlugin(context).catch(err => {
    console.error("Failed to install Antigravity plugin", err);
  });

  void provider.refresh();
}

export function deactivate(): void {
  // Disposables registered in activate are disposed by VS Code.
}
