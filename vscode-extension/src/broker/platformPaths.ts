// vscode-extension/src/broker/platformPaths.ts
// Integrated Power: Cross-Platform OS Path & Environment Resolver

import * as os from "os";
import * as path from "path";

export interface ResolvedPlatformPaths {
  platform: NodeJS.Platform;
  stateRoot: string;
  configDir: string;
  cacheDir: string;
  logDir: string;
  gdrive: {
    configDir: string;
    keyPath: string;
    credentialsPath: string;
  };
}

/**
 * Resolves the canonical state root for the Integrated Power broker across
 * Windows, macOS, and Linux without assuming Windows-specific environment variables.
 */
export function resolvePlatformStateRoot(
  customRoot?: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): string {
  const p = platform === "win32" ? path.win32 : path.posix;

  if (customRoot?.trim()) {
    return p.resolve(customRoot.trim());
  }
  if (env.INTEGRATED_POWER_STATE_ROOT?.trim()) {
    return p.resolve(env.INTEGRATED_POWER_STATE_ROOT.trim());
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || p.join(homedir, "AppData", "Local");
    return p.join(localAppData, "IntegratedPower", "state");
  }

  if (platform === "darwin") {
    return p.join(homedir, "Library", "Application Support", "IntegratedPower", "state");
  }

  // Linux and other POSIX: XDG Base Directory Specification
  const xdgDataHome = env.XDG_DATA_HOME || p.join(homedir, ".local", "share");
  return p.join(xdgDataHome, "IntegratedPower", "state");
}

/**
 * Resolves the cross-platform configuration directory.
 */
export function resolvePlatformConfigDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  if (env.INTEGRATED_POWER_CONFIG_DIR?.trim()) {
    return p.resolve(env.INTEGRATED_POWER_CONFIG_DIR.trim());
  }

  if (platform === "win32") {
    const appData = env.APPDATA || p.join(homedir, "AppData", "Roaming");
    return p.join(appData, "IntegratedPower");
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME || p.join(homedir, ".config");
  return p.join(xdgConfigHome, "integrated-power");
}

/**
 * Resolves Google Drive MCP credential paths in an OS-neutral way.
 */
export function resolveGoogleDriveMcpPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): { configDir: string; keyPath: string; credentialsPath: string } {
  const p = platform === "win32" ? path.win32 : path.posix;
  const baseConfig = env.XDG_CONFIG_HOME || p.join(homedir, ".config");
  const configDir = p.join(baseConfig, "google-drive-mcp");

  const keyPath = env.GDRIVE_OAUTH_PATH?.trim()
    ? p.resolve(env.GDRIVE_OAUTH_PATH.trim())
    : p.join(configDir, "gcp-oauth.keys.json");

  const credentialsPath = env.GDRIVE_CREDENTIALS_PATH?.trim()
    ? p.resolve(env.GDRIVE_CREDENTIALS_PATH.trim())
    : p.join(configDir, ".gdrive-server-credentials.json");

  return { configDir, keyPath, credentialsPath };
}

/**
 * Returns complete resolved path profile for current host environment or simulated target.
 */
export function getPlatformPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): ResolvedPlatformPaths {
  const stateRoot = resolvePlatformStateRoot(undefined, platform, env, homedir);
  const configDir = resolvePlatformConfigDir(platform, env, homedir);
  const cacheDir = platform === "win32"
    ? path.join(env.LOCALAPPDATA || path.join(homedir, "AppData", "Local"), "IntegratedPower", "cache")
    : platform === "darwin"
      ? path.join(homedir, "Library", "Caches", "IntegratedPower")
      : path.join(env.XDG_CACHE_HOME || path.join(homedir, ".cache"), "integrated-power");

  const logDir = path.join(stateRoot, "logs");
  const gdrive = resolveGoogleDriveMcpPaths(platform, env, homedir);

  return {
    platform,
    stateRoot,
    configDir,
    cacheDir,
    logDir,
    gdrive,
  };
}

export function resolveBrokerPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INTEGRATED_POWER_BROKER_PORT || "37241";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 37241;
}
