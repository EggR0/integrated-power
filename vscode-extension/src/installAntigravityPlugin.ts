import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export interface AntigravityPluginInstallResult {
  installed: boolean;
  destination?: string;
  reason?: string;
}

export async function installAntigravityPlugin(
  context: vscode.ExtensionContext,
): Promise<AntigravityPluginInstallResult> {
  const geminiRoot = path.join(os.homedir(), '.gemini');
  const geminiConfigPath = path.join(geminiRoot, 'config', 'plugins');

  if (!fs.existsSync(geminiRoot)) {
    return {
      installed: false,
      reason: `Antigravity configuration directory was not found: ${geminiRoot}`,
    };
  }

  const pluginDestPath = path.join(geminiConfigPath, 'codex-orchestrator-plugin');
  const pluginSrcPath = path.join(context.extensionPath, 'assets', 'codex-orchestrator-plugin');

  if (!fs.existsSync(pluginSrcPath)) {
    throw new Error(`Bundled EggR orchestrator assets were not found: ${pluginSrcPath}`);
  }

  await fs.promises.mkdir(geminiConfigPath, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stagePath = path.join(geminiConfigPath, `.codex-orchestrator-plugin.eggr-stage-${process.pid}-${stamp}`);
  const backupRoot = path.join(geminiConfigPath, '.eggr-backups');
  const backupPath = path.join(backupRoot, `codex-orchestrator-plugin-${stamp}`);
  let movedExistingInstall = false;

  try {
    await copyDir(pluginSrcPath, stagePath);
    if (fs.existsSync(pluginDestPath)) {
      await fs.promises.mkdir(backupRoot, { recursive: true });
      await fs.promises.rename(pluginDestPath, backupPath);
      movedExistingInstall = true;
    }
    await fs.promises.rename(stagePath, pluginDestPath);
    return { installed: true, destination: pluginDestPath };
  } catch (error) {
    if (movedExistingInstall && !fs.existsSync(pluginDestPath) && fs.existsSync(backupPath)) {
      await fs.promises.rename(backupPath, pluginDestPath);
    }
    throw error;
  } finally {
    await fs.promises.rm(stagePath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  const srcEntries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of srcEntries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}
