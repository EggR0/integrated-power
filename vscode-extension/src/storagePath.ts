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

export function resolveEggRStateRoot(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  let candidate = env.EGGR_STATE_ROOT?.trim();
  if (!candidate) {
    const configPath = path.join(userHome, ".config", "eggr", "roots.json");
    if (fs.existsSync(configPath)) {
      const config = readUtf8JsonFile<{ state_root?: unknown }>(configPath);
      if (typeof config.state_root === "string" && config.state_root.trim()) {
        candidate = config.state_root.trim();
      }
    }
  }

  if (!candidate) {
    if (platform === "win32" && env.LOCALAPPDATA?.trim()) {
      candidate = path.join(env.LOCALAPPDATA, "EggR", "state");
    } else if (env.XDG_STATE_HOME?.trim()) {
      candidate = path.join(env.XDG_STATE_HOME, "eggr");
    } else {
      candidate = path.join(userHome, ".local", "state", "eggr");
    }
  }

  return path.resolve(expandEnvironmentVariables(candidate, env));
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

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
