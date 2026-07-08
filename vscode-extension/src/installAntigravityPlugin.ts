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

    const assetsPath = path.join(context.extensionPath, 'assets');
    if (!fs.existsSync(assetsPath)) {
      console.warn('Antigravity assets not found in extension.');
      return;
    }

    // Identify current official plugins in the assets directory
    const assetEntries = fs.readdirSync(assetsPath, { withFileTypes: true });
    const currentPlugins: string[] = [];
    
    for (const entry of assetEntries) {
      if (entry.isDirectory() && fs.existsSync(path.join(assetsPath, entry.name, 'plugin.json'))) {
        currentPlugins.push(entry.name);
      }
    }

    // Read previously managed plugins manifest to clean up stale/renamed plugins
    const manifestPath = path.join(geminiConfigPath, '.managed_plugins.json');
    let previousPlugins: string[] = [];
    if (fs.existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (Array.isArray(parsed)) {
          previousPlugins = parsed;
        }
      } catch (e) {
        console.warn('Failed to parse .managed_plugins.json');
      }
    } else {
      // Seed legacy official plugins to ensure they are cleaned up if no longer managed
      previousPlugins = ['codex-orchestrator-plugin'];
    }

    // Clean up old plugins that are no longer shipped by the extension
    for (const oldPlugin of previousPlugins) {
      if (!currentPlugins.includes(oldPlugin)) {
        const oldPluginPath = path.join(geminiConfigPath, oldPlugin);
        if (fs.existsSync(oldPluginPath)) {
          fs.rmSync(oldPluginPath, { recursive: true, force: true });
          console.log(`Removed stale managed plugin: ${oldPlugin}`);
        }
      }
    }

    // Mirror all current plugins
    for (const plugin of currentPlugins) {
      const srcPath = path.join(assetsPath, plugin);
      const destPath = path.join(geminiConfigPath, plugin);
      await syncDir(srcPath, destPath);
      console.log(`Installed/updated plugin: ${plugin}`);
    }

    // Save the new manifest
    fs.writeFileSync(manifestPath, JSON.stringify(currentPlugins, null, 2), 'utf8');

    console.log('Antigravity plugin installation complete.');
  } catch (err) {
    console.error('Failed to install Antigravity plugins:', err);
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
