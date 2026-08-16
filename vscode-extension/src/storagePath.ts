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

export type IntegratedPowerPathSource =
  | "environment"
  | "config"
  | "legacy-config"
  | "default";

export interface ResolvedIntegratedPowerPath {
  path: string;
  source: IntegratedPowerPathSource;
  configured: boolean;
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
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = envValue(env, "INTEGRATED_POWER_ROOTS_CONFIG");
  if (configured) {
    return resolvePortablePath(configured, env, userHome);
  }
  return path.join(userHome, ".config", PRODUCT_CONFIG_DIRECTORY, "roots.json");
}

export function legacyEggRRootsConfigPath(
  userHome: string = os.homedir(),
): string {
  return path.join(userHome, ".config", LEGACY_CONFIG_DIRECTORY, "roots.json");
}

export function readIntegratedPowerRoots(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = os.homedir(),
): Record<string, unknown> {
  const canonicalPath = integratedPowerRootsConfigPath(userHome, env);
  if (fs.existsSync(canonicalPath)) return readOptionalJsonObject(canonicalPath);
  if (envValue(env, "INTEGRATED_POWER_ROOTS_CONFIG")) return {};
  return readOptionalJsonObject(legacyEggRRootsConfigPath(userHome));
}

export function resolveIntegratedPowerWorkRoot(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = os.homedir(),
): ResolvedIntegratedPowerPath {
  return resolveRootSetting({
    env,
    userHome,
    environmentNames: ["INTEGRATED_POWER_WORK_ROOT", "EGGR_WORK_ROOT"],
    configName: "work_root",
    defaultPath: path.join(userHome, "Documents", "IntegratedPower"),
  });
}

export function resolveIntegratedPowerKnowledgeRoot(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = os.homedir(),
): ResolvedIntegratedPowerPath {
  const workRoot = resolveIntegratedPowerWorkRoot(env, userHome);
  return resolveRootSetting({
    env,
    userHome,
    environmentNames: ["INTEGRATED_POWER_KNOWLEDGE_ROOT"],
    configName: "knowledge",
    defaultPath: path.join(workRoot.path, "Knowledge"),
  });
}

export function resolveAntigravityPluginRoot(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = os.homedir(),
): ResolvedIntegratedPowerPath {
  return resolveRootSetting({
    env,
    userHome,
    environmentNames: ["INTEGRATED_POWER_ANTIGRAVITY_PLUGIN_ROOT"],
    configName: "antigravity_plugin_root",
    defaultPath: path.join(userHome, ".gemini", "config", "plugins"),
  });
}

export function resolveIntegratedPowerToolsRoot(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): ResolvedIntegratedPowerPath {
  const platformDefault =
    platform === "win32" && envValue(env, "LOCALAPPDATA")
      ? path.join(envValue(env, "LOCALAPPDATA")!, "IntegratedPower", "bin")
      : envValue(env, "XDG_DATA_HOME")
        ? path.join(envValue(env, "XDG_DATA_HOME")!, "integrated-power", "bin")
        : path.join(userHome, ".local", "share", "integrated-power", "bin");
  return resolveRootSetting({
    env,
    userHome,
    environmentNames: ["INTEGRATED_POWER_TOOLS_ROOT"],
    configName: "tools_root",
    defaultPath: platformDefault,
  });
}

export function resolvePortablePath(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = os.homedir(),
): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Configured path cannot be empty.");
  let expanded = trimmed;
  if (expanded === "~") {
    expanded = userHome;
  } else if (/^~[\\/]/.test(expanded)) {
    expanded = path.join(userHome, expanded.slice(2));
  }
  expanded = expanded
    .replace(/%([^%]+)%/g, (match, name: string) => envValue(env, name) ?? match)
    .replace(/\$\{([^}]+)\}/g, (match, name: string) => envValue(env, name) ?? match);
  if (/%[^%]+%|\$\{[^}]+\}/.test(expanded)) {
    throw new Error(`Configured path contains an unresolved environment variable: ${value}`);
  }
  if (!path.isAbsolute(expanded)) {
    throw new Error(`Configured path must be absolute after expansion: ${value}`);
  }
  const resolved = path.resolve(expanded);
  if (path.parse(resolved).root === resolved) {
    throw new Error(`Configured path cannot be a filesystem root: ${resolved}`);
  }
  return resolved;
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
    const explicitRootsConfig = envValue(env, "INTEGRATED_POWER_ROOTS_CONFIG");
    const configPath = explicitRootsConfig
      ? integratedPowerRootsConfigPath(userHome, env)
      : fs.existsSync(integratedPowerRootsConfigPath(userHome, env))
      ? integratedPowerRootsConfigPath(userHome, env)
      : legacyEggRRootsConfigPath(userHome);
    if (fs.existsSync(configPath)) {
      const config = readUtf8JsonFile<{ state_root?: unknown }>(configPath);
      if (typeof config.state_root === "string" && config.state_root.trim()) {
        candidate = config.state_root.trim();
      }
    }
  }

  if (!candidate) candidate = productDefault;

  const resolved = resolvePortablePath(candidate, env, userHome);
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

interface RootSettingOptions {
  env: NodeJS.ProcessEnv;
  userHome: string;
  environmentNames: string[];
  configName: string;
  defaultPath: string;
}

function resolveRootSetting(
  options: RootSettingOptions,
): ResolvedIntegratedPowerPath {
  for (const name of options.environmentNames) {
    const value = envValue(options.env, name);
    if (value) {
      return {
        path: resolvePortablePath(value, options.env, options.userHome),
        source: "environment",
        configured: true,
      };
    }
  }
  const canonicalPath = integratedPowerRootsConfigPath(
    options.userHome,
    options.env,
  );
  const canonical = readOptionalJsonObject(canonicalPath);
  const canonicalValue = canonical[options.configName];
  if (typeof canonicalValue === "string" && canonicalValue.trim()) {
    return {
      path: resolvePortablePath(canonicalValue, options.env, options.userHome),
      source: "config",
      configured: true,
    };
  }
  if (
    !fs.existsSync(canonicalPath) &&
    !envValue(options.env, "INTEGRATED_POWER_ROOTS_CONFIG")
  ) {
    const legacy = readOptionalJsonObject(
      legacyEggRRootsConfigPath(options.userHome),
    );
    const legacyValue = legacy[options.configName];
    if (typeof legacyValue === "string" && legacyValue.trim()) {
      return {
        path: resolvePortablePath(legacyValue, options.env, options.userHome),
        source: "legacy-config",
        configured: true,
      };
    }
  }
  return {
    path: path.resolve(options.defaultPath),
    source: "default",
    configured: false,
  };
}

function envValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const exact = env[name];
  if (typeof exact === "string" && exact.trim()) return exact.trim();
  const matchedName = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  const matched = matchedName ? env[matchedName] : undefined;
  return typeof matched === "string" && matched.trim()
    ? matched.trim()
    : undefined;
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
