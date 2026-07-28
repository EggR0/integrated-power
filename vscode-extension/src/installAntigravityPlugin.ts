import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  PluginInstallPlan,
  createPluginInstallPlan,
  executePluginInstallPlan,
} from "./pluginInstallerCore";

export interface AntigravityPluginInstallResult {
  installed: boolean;
  changed?: boolean;
  destination?: string;
  reason?: string;
  migratedLegacy?: boolean;
  backupPaths?: string[];
  plan: PluginInstallPlan;
}

export function inspectAntigravityPluginInstall(
  context: vscode.ExtensionContext,
  homeDir = os.homedir(),
): PluginInstallPlan {
  return createPluginInstallPlan({
    homeDir,
    sourcePath: path.join(
      context.extensionPath,
      "assets",
      "ip-orchestrator-plugin",
    ),
    extensionVersion: String(context.extension.packageJSON.version ?? "unknown"),
  });
}

export async function installAntigravityPlugin(
  context: vscode.ExtensionContext,
): Promise<AntigravityPluginInstallResult> {
  const options = {
    homeDir: os.homedir(),
    sourcePath: path.join(
      context.extensionPath,
      "assets",
      "ip-orchestrator-plugin",
    ),
    extensionVersion: String(context.extension.packageJSON.version ?? "unknown"),
    journalPath: path.join(
      context.globalStorageUri.fsPath,
      "installations",
      "ip-orchestrator.json",
    ),
  };
  const plan = createPluginInstallPlan(options);
  if (plan.blocked) {
    return {
      installed: false,
      reason: plan.blockingReason,
      plan,
    };
  }
  const result = await executePluginInstallPlan(options, plan);
  return {
    installed: result.installed,
    changed: result.changed,
    destination: result.destination,
    migratedLegacy: result.migratedLegacy,
    backupPaths: result.backupPaths,
    plan,
  };
}
