import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { readUtf8JsonFile } from "./jsonFile";

export interface EggRWorkspaceDescriptor {
  repoRoot: string;
  remoteUrl?: string;
  configuredId?: string;
}

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const PRODUCT_CONFIG_DIRECTORY = "integrated-power";
const LEGACY_CONFIG_DIRECTORY = "eggr";
const PRODUCT_STATE_DIRECTORY = "IntegratedPower";
const LEGACY_STATE_DIRECTORY = "EggR";
const STATE_MIGRATION_MARKER = ".migrated-from-eggr-state-v1.json";

export interface IntegratedPowerStorageMigration {
  sourceRoot?: string;
  destinationRoot: string;
  copiedFiles: number;
  productConfigPath: string;
}

export function normalizeWorkspacePathForStorage(folderPath: string): string {
  const resolved = path.resolve(folderPath);
  return /^[a-z]:/i.test(resolved) ? resolved[0].toUpperCase() + resolved.slice(1) : resolved;
}

export function normalizeEggRRemoteIdentity(remoteUrl: string): string {
  return remoteUrl
    .trim()
    .replace(/\\/g, "/")
    .replace(/^[^@/]+@([^:/]+):/, "$1/")
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "")
    .replace(/^[^@/]+@/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

export function eggRWorkspaceId(
  folderPath: string,
  remoteUrl?: string,
  configuredId?: string,
): string {
  if (configuredId !== undefined) {
    if (!WORKSPACE_ID_PATTERN.test(configuredId)) {
      throw new Error("EggR workspace id must match ^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$.");
    }
    return configuredId;
  }

  if (remoteUrl?.trim()) {
    return `git-${sha256(normalizeEggRRemoteIdentity(remoteUrl)).slice(0, 24)}`;
  }

  let pathIdentity = normalizeWorkspacePathForStorage(folderPath).replace(/\\/g, "/").replace(/\/+$/, "");
  if (process.platform === "win32" || /^[A-Za-z]:\//.test(pathIdentity)) {
    pathIdentity = pathIdentity.toLowerCase();
  }
  return `path-${sha256(pathIdentity).slice(0, 24)}`;
}

export function integratedPowerRootsConfigPath(
  userHome: string = os.homedir(),
): string {
  return path.join(userHome, ".config", PRODUCT_CONFIG_DIRECTORY, "roots.json");
}

export function legacyEggRRootsConfigPath(
  userHome: string = os.homedir(),
): string {
  return path.join(userHome, ".config", LEGACY_CONFIG_DIRECTORY, "roots.json");
}

export function resolveIntegratedPowerStateRoot(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const productDefault = defaultProductStateRoot(env, userHome, platform);
  const legacyDefault = defaultLegacyStateRoot(env, userHome, platform);
  let candidate =
    env.INTEGRATED_POWER_STATE_ROOT?.trim() || env.EGGR_STATE_ROOT?.trim();
  if (!candidate) {
    const configPath = fs.existsSync(integratedPowerRootsConfigPath(userHome))
      ? integratedPowerRootsConfigPath(userHome)
      : legacyEggRRootsConfigPath(userHome);
    if (fs.existsSync(configPath)) {
      const config = readUtf8JsonFile<{ state_root?: unknown }>(configPath);
      if (typeof config.state_root === "string" && config.state_root.trim()) {
        candidate = config.state_root.trim();
      }
    }
  }

  if (!candidate) candidate = productDefault;

  const resolved = path.resolve(expandEnvironmentVariables(candidate, env));
  if (
    !env.INTEGRATED_POWER_STATE_ROOT?.trim() &&
    pathsEqual(resolved, legacyDefault, platform)
  ) {
    return path.resolve(productDefault);
  }

  return resolved;
}

/**
 * Compatibility export for integrations that imported the old function name.
 * New code and new state always use the Integrated Power product root.
 */
export const resolveEggRStateRoot = resolveIntegratedPowerStateRoot;

export function ensureIntegratedPowerStorageMigration(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): IntegratedPowerStorageMigration {
  const productConfigPath = integratedPowerRootsConfigPath(userHome);
  const explicitSessionRoot = env.INTEGRATED_POWER_STATE_ROOT?.trim();
  if (explicitSessionRoot) {
    return {
      destinationRoot: path.resolve(
        expandEnvironmentVariables(explicitSessionRoot, env),
      ),
      copiedFiles: 0,
      productConfigPath,
    };
  }
  const legacyConfigPath = legacyEggRRootsConfigPath(userHome);
  const productConfig = readOptionalJsonObject(productConfigPath);
  const legacyConfig = readOptionalJsonObject(legacyConfigPath);
  const destinationRoot = resolveIntegratedPowerStateRoot(
    env,
    userHome,
    platform,
  );
  const legacyDefault = defaultLegacyStateRoot(env, userHome, platform);
  const configuredLegacyRoot =
    typeof legacyConfig.state_root === "string" && legacyConfig.state_root.trim()
      ? path.resolve(expandEnvironmentVariables(legacyConfig.state_root, env))
      : legacyDefault;
  const markerPath = path.join(destinationRoot, STATE_MIGRATION_MARKER);
  let copiedFiles = 0;

  if (
    !pathsEqual(configuredLegacyRoot, destinationRoot, platform) &&
    fs.existsSync(configuredLegacyRoot) &&
    !fs.existsSync(markerPath)
  ) {
    copiedFiles = copyMissingRegularFiles(configuredLegacyRoot, destinationRoot);
    writeJsonAtomic(markerPath, {
      schemaVersion: 1,
      sourceRoot: configuredLegacyRoot,
      destinationRoot,
      copiedFiles,
      completedAt: new Date().toISOString(),
      legacyDataRetained: true,
    });
  }

  const mergedConfig = {
    ...legacyConfig,
    ...productConfig,
    state_root: destinationRoot,
  };
  writeJsonAtomic(productConfigPath, mergedConfig);

  return {
    ...(fs.existsSync(configuredLegacyRoot) &&
    !pathsEqual(configuredLegacyRoot, destinationRoot, platform)
      ? { sourceRoot: configuredLegacyRoot }
      : {}),
    destinationRoot,
    copiedFiles,
    productConfigPath,
  };
}

export function synchronizeIntegratedPowerRootsFromLegacy(
  userHome: string = os.homedir(),
): string {
  const productConfigPath = integratedPowerRootsConfigPath(userHome);
  const productConfig = readOptionalJsonObject(productConfigPath);
  const legacyConfig = readOptionalJsonObject(
    legacyEggRRootsConfigPath(userHome),
  );
  const stateRoot =
    typeof productConfig.state_root === "string" &&
    productConfig.state_root.trim()
      ? productConfig.state_root
      : resolveIntegratedPowerStateRoot(process.env, userHome);
  writeJsonAtomic(productConfigPath, {
    ...productConfig,
    ...legacyConfig,
    state_root: stateRoot,
  });
  return productConfigPath;
}

export function resolveEggRWorkspaceDescriptor(folderPath: string): EggRWorkspaceDescriptor {
  const resolvedFolder = normalizeWorkspacePathForStorage(folderPath);
  const repoRoot = runGit(resolvedFolder, ["rev-parse", "--show-toplevel"]) ?? resolvedFolder;
  const workspaceConfigPath = path.join(repoRoot, ".eggr", "workspace.json");
  let configuredId: string | undefined;

  if (fs.existsSync(workspaceConfigPath)) {
    const config = readUtf8JsonFile<{ id?: unknown }>(workspaceConfigPath);
    if (typeof config.id !== "string" || !WORKSPACE_ID_PATTERN.test(config.id)) {
      throw new Error(`Invalid EggR workspace id in ${workspaceConfigPath}.`);
    }
    configuredId = config.id;
  }

  return {
    repoRoot,
    remoteUrl: runGit(repoRoot, ["config", "--get", "remote.origin.url"]),
    configuredId,
  };
}

export function workspaceStoragePathForFolder(
  stateRoot: string,
  folderPath: string,
  remoteUrl?: string,
  configuredId?: string,
): string {
  return path.join(stateRoot, "workspaces", eggRWorkspaceId(folderPath, remoteUrl, configuredId));
}

export function legacyWorkspaceStorageCandidates(globalStorageFsPath: string, folderPath: string): string[] {
  const normalized = normalizeWorkspacePathForStorage(folderPath);
  const legacyInputs = new Set([
    normalized,
    /^[A-Z]:/.test(normalized) ? normalized[0].toLowerCase() + normalized.slice(1) : normalized,
  ]);

  return [...legacyInputs].map((value) =>
    path.join(globalStorageFsPath, "workspaces", crypto.createHash("md5").update(value).digest("hex")),
  );
}

function runGit(cwd: string, args: string[]): string | undefined {
  try {
    const output = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

function expandEnvironmentVariables(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => env[name] ?? match);
}

function defaultProductStateRoot(
  env: NodeJS.ProcessEnv,
  userHome: string,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32" && env.LOCALAPPDATA?.trim()) {
    return path.join(env.LOCALAPPDATA, PRODUCT_STATE_DIRECTORY, "state");
  }
  if (env.XDG_STATE_HOME?.trim()) {
    return path.join(env.XDG_STATE_HOME, "integrated-power");
  }
  return path.join(userHome, ".local", "state", "integrated-power");
}

function defaultLegacyStateRoot(
  env: NodeJS.ProcessEnv,
  userHome: string,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32" && env.LOCALAPPDATA?.trim()) {
    return path.resolve(path.join(env.LOCALAPPDATA, LEGACY_STATE_DIRECTORY, "state"));
  }
  if (env.XDG_STATE_HOME?.trim()) {
    return path.resolve(path.join(env.XDG_STATE_HOME, "eggr"));
  }
  return path.resolve(path.join(userHome, ".local", "state", "eggr"));
}

function readOptionalJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  const value = readUtf8JsonFile<unknown>(filePath);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function writeJsonAtomic(
  filePath: string,
  value: Record<string, unknown>,
): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (
    fs.existsSync(filePath) &&
    fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "") === serialized
  ) {
    return;
  }
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, serialized, "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function copyMissingRegularFiles(source: string, destination: string): number {
  fs.mkdirSync(destination, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copied += copyMissingRegularFiles(sourcePath, destinationPath);
    } else if (entry.isFile() && !fs.existsSync(destinationPath)) {
      fs.copyFileSync(sourcePath, destinationPath);
      copied++;
    }
  }
  return copied;
}

function pathsEqual(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
