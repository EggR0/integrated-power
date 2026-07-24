import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export async function installAntigravityPlugin(context: vscode.ExtensionContext) {
  try {
    const geminiConfigPath = path.join(os.homedir(), '.gemini', 'config', 'plugins');
    
    // Only install if Antigravity config directory exists
    if (!fs.existsSync(path.join(os.homedir(), '.gemini'))) {
      return;
    }

    // Ensure plugins directory exists
    if (!fs.existsSync(geminiConfigPath)) {
      fs.mkdirSync(geminiConfigPath, { recursive: true });
    }

    const pluginDestPath = path.join(geminiConfigPath, 'codex-orchestrator-plugin');
    const pluginSrcPath = path.join(context.extensionPath, 'assets', 'codex-orchestrator-plugin');

    // If it doesn't exist in the extension (shouldn't happen), abort
    if (!fs.existsSync(pluginSrcPath)) {
      console.warn('Antigravity plugin assets not found in extension.');
      return;
    }

    // Mirror the plugin directory so stale skills/scripts from older releases do not remain installed.
    await syncDir(pluginSrcPath, pluginDestPath);
    console.log('Antigravity plugin installed/updated successfully.');
  } catch (err) {
    console.error('Failed to install Antigravity plugin:', err);
  }
}

async function syncDir(src: string, dest: string) {
  await fs.promises.mkdir(dest, { recursive: true });
  const [srcEntries, destEntries] = await Promise.all([
    fs.promises.readdir(src, { withFileTypes: true }),
    fs.promises.readdir(dest, { withFileTypes: true }).catch(() => [] as fs.Dirent[]),
  ]);
  const srcNames = new Set(srcEntries.map((entry) => entry.name));

  for (const entry of destEntries) {
    if (!srcNames.has(entry.name)) {
      await fs.promises.rm(path.join(dest, entry.name), { recursive: true, force: true });
    }
  }

  for (const entry of srcEntries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await syncDir(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}
