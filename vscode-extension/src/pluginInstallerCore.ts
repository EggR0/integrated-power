import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export const EGGR_PLUGIN_NAME = "eggr-orchestrator-plugin";
export const EGGR_SKILL_NAME = "eggr-orchestrator";
export const LEGACY_PLUGIN_NAME = "codex-orchestrator-plugin";
export const LEGACY_SKILL_NAME = "codex-orchestrator";
export const INSTALL_STATE_FILE = ".eggr-install-state.json";

const LEGACY_AUTHOR_SHA256 =
  "376c84cfc52dc11f9604773667eb138f2effb68944708946944ac1f232d40a91";

export type PluginCandidateState =
  | "absent"
  | "managed-current"
  | "managed-outdated"
  | "recognized-unmanaged"
  | "conflict";

export interface PluginCandidateInspection {
  path: string;
  state: PluginCandidateState;
  pluginName?: string;
  skillName?: string;
  version?: string;
  detail: string;
}

export interface PluginInstallAction {
  type: "install" | "replace" | "backup-legacy" | "no-op";
  source?: string;
  target: string;
  backup?: string;
  description: string;
}

export interface PluginInstallPlan {
  schemaVersion: 1;
  pluginRoot: string;
  source: PluginCandidateInspection;
  destination: PluginCandidateInspection;
  legacy: PluginCandidateInspection;
  backupRoot: string;
  actions: PluginInstallAction[];
  blocked: boolean;
  blockingReason?: string;
  stamp: string;
}

export interface PluginInstallOptions {
  homeDir: string;
  sourcePath: string;
  extensionVersion: string;
  journalPath?: string;
  now?: Date;
  processId?: number;
  failAt?:
    | "after-stage"
    | "after-destination-backup"
    | "after-legacy-backup"
    | "before-activate";
}

export interface PluginInstallExecutionResult {
  installed: boolean;
  changed: boolean;
  destination: string;
  migratedLegacy: boolean;
  backupPaths: string[];
  plan: PluginInstallPlan;
}

interface EggRInstallState {
  schemaVersion: 1;
  productId: "eggr-orchestrator";
  pluginName: typeof EGGR_PLUGIN_NAME;
  skillName: typeof EGGR_SKILL_NAME;
  pluginVersion: string;
  extensionVersion: string;
  installedAt: string;
  managedFiles: Record<string, string>;
}

export function createPluginInstallPlan(
  options: PluginInstallOptions,
): PluginInstallPlan {
  const homeDir = path.resolve(options.homeDir);
  const geminiRoot = path.join(homeDir, ".gemini");
  const pluginRoot = path.join(geminiRoot, "config", "plugins");
  const destinationPath = path.join(pluginRoot, EGGR_PLUGIN_NAME);
  const legacyPath = path.join(pluginRoot, LEGACY_PLUGIN_NAME);
  const backupRoot = path.join(pluginRoot, ".eggr-backups");
  const sourcePath = path.resolve(options.sourcePath);
  const stamp = (options.now ?? new Date())
    .toISOString()
    .replace(/[:.]/g, "-");

  assertPathInside(pluginRoot, destinationPath);
  assertPathInside(pluginRoot, legacyPath);
  assertPathInside(pluginRoot, backupRoot);

  const source = inspectCandidate(
    sourcePath,
    EGGR_PLUGIN_NAME,
    EGGR_SKILL_NAME,
    true,
  );
  const destination = inspectCandidate(
    destinationPath,
    EGGR_PLUGIN_NAME,
    EGGR_SKILL_NAME,
    false,
  );
  const legacy = inspectCandidate(
    legacyPath,
    LEGACY_PLUGIN_NAME,
    LEGACY_SKILL_NAME,
    false,
  );
  const actions: PluginInstallAction[] = [];
  let blockingReason: string | undefined;

  if (!fs.existsSync(geminiRoot)) {
    blockingReason = `Antigravity configuration directory was not found: ${geminiRoot}`;
  } else if (source.state === "conflict" || source.state === "absent") {
    blockingReason = `Bundled EggR plugin is invalid: ${source.detail}`;
  } else if (destination.state === "conflict") {
    blockingReason =
      `The destination is not a recognized EggR plugin and will not be moved: ${destinationPath}`;
  } else if (legacy.state === "conflict") {
    blockingReason =
      `The legacy path does not match an EggR-distributed legacy plugin and will not be moved: ${legacyPath}`;
  }

  const sourceVersion = source.version ?? "unknown";
  const destinationCurrent =
    destination.state === "managed-current" &&
    destination.version === sourceVersion;

  if (!blockingReason) {
    if (destinationCurrent) {
      actions.push({
        type: "no-op",
        target: destinationPath,
        description: `EggR plugin ${sourceVersion} is already installed with matching managed checksums.`,
      });
    } else if (destination.state === "absent") {
      actions.push({
        type: "install",
        source: sourcePath,
        target: destinationPath,
        description: `Install ${EGGR_PLUGIN_NAME} ${sourceVersion}.`,
      });
    } else {
      actions.push({
        type: "replace",
        source: sourcePath,
        target: destinationPath,
        backup: path.join(backupRoot, `${EGGR_PLUGIN_NAME}-${stamp}`),
        description: `Back up and replace the existing recognized EggR plugin.`,
      });
    }

    if (legacy.state !== "absent") {
      actions.push({
        type: "backup-legacy",
        target: legacyPath,
        backup: path.join(backupRoot, `${LEGACY_PLUGIN_NAME}-${stamp}`),
        description: `Move the recognized legacy plugin to an EggR backup so Antigravity does not load both skill names.`,
      });
    }
  }

  return {
    schemaVersion: 1,
    pluginRoot,
    source,
    destination,
    legacy,
    backupRoot,
    actions,
    blocked: Boolean(blockingReason),
    ...(blockingReason ? { blockingReason } : {}),
    stamp,
  };
}

export async function executePluginInstallPlan(
  options: PluginInstallOptions,
  plan: PluginInstallPlan = createPluginInstallPlan(options),
): Promise<PluginInstallExecutionResult> {
  if (plan.blocked) {
    throw new Error(plan.blockingReason ?? "Plugin migration is blocked.");
  }

  const installAction = plan.actions.find(
    (action) => action.type === "install" || action.type === "replace",
  );
  const legacyAction = plan.actions.find(
    (action) => action.type === "backup-legacy",
  );
  const backupPaths: string[] = [];
  const processId = options.processId ?? process.pid;
  const stagePath = path.join(
    plan.pluginRoot,
    `.${EGGR_PLUGIN_NAME}.stage-${processId}-${plan.stamp}`,
  );
  assertPathInside(plan.pluginRoot, stagePath);

  let destinationMoved = false;
  let legacyMoved = false;
  let destinationActivated = false;

  try {
    if (installAction) {
      await copyDirectory(options.sourcePath, stagePath);
      const installState = createInstallState(
        stagePath,
        options.extensionVersion,
        options.now ?? new Date(),
      );
      await writeJsonAtomic(
        path.join(stagePath, INSTALL_STATE_FILE),
        installState as unknown as Record<string, unknown>,
      );
      throwIfRequested(options, "after-stage");
    }

    if (installAction?.type === "replace" && installAction.backup) {
      await fs.promises.mkdir(plan.backupRoot, { recursive: true });
      await fs.promises.rename(installAction.target, installAction.backup);
      destinationMoved = true;
      backupPaths.push(installAction.backup);
      throwIfRequested(options, "after-destination-backup");
    }

    if (legacyAction?.backup) {
      await fs.promises.mkdir(plan.backupRoot, { recursive: true });
      await fs.promises.rename(legacyAction.target, legacyAction.backup);
      legacyMoved = true;
      backupPaths.push(legacyAction.backup);
      throwIfRequested(options, "after-legacy-backup");
    }

    if (installAction) {
      throwIfRequested(options, "before-activate");
      await fs.promises.mkdir(plan.pluginRoot, { recursive: true });
      await fs.promises.rename(stagePath, installAction.target);
      destinationActivated = true;
    }

    const result: PluginInstallExecutionResult = {
      installed: fs.existsSync(
        path.join(plan.pluginRoot, EGGR_PLUGIN_NAME, "plugin.json"),
      ),
      changed: Boolean(installAction || legacyAction),
      destination: path.join(plan.pluginRoot, EGGR_PLUGIN_NAME),
      migratedLegacy: Boolean(legacyAction),
      backupPaths,
      plan,
    };
    if (options.journalPath) {
      await writeJsonAtomic(options.journalPath, {
        schemaVersion: 1,
        productId: "eggr-orchestrator",
        completedAt: (options.now ?? new Date()).toISOString(),
        extensionVersion: options.extensionVersion,
        changed: result.changed,
        migratedLegacy: result.migratedLegacy,
        destination: result.destination,
        backupPaths: result.backupPaths,
        actions: plan.actions,
      });
    }
    return result;
  } catch (error) {
    if (
      destinationActivated &&
      fs.existsSync(path.join(plan.pluginRoot, EGGR_PLUGIN_NAME))
    ) {
      await fs.promises.rename(
        path.join(plan.pluginRoot, EGGR_PLUGIN_NAME),
        stagePath,
      );
      destinationActivated = false;
    }
    if (
      legacyMoved &&
      legacyAction?.backup &&
      !fs.existsSync(legacyAction.target) &&
      fs.existsSync(legacyAction.backup)
    ) {
      await fs.promises.rename(legacyAction.backup, legacyAction.target);
    }
    if (
      destinationMoved &&
      installAction?.backup &&
      !fs.existsSync(installAction.target) &&
      fs.existsSync(installAction.backup)
    ) {
      await fs.promises.rename(installAction.backup, installAction.target);
    }
    throw error;
  } finally {
    if (fs.existsSync(stagePath)) {
      assertPathInside(plan.pluginRoot, stagePath);
      await fs.promises
        .rm(stagePath, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
}

function inspectCandidate(
  candidatePath: string,
  expectedPluginName: string,
  expectedSkillName: string,
  source: boolean,
): PluginCandidateInspection {
  if (!fs.existsSync(candidatePath)) {
    return {
      path: candidatePath,
      state: "absent",
      detail: "Directory does not exist.",
    };
  }

  const manifest = readJsonObject(path.join(candidatePath, "plugin.json"));
  const pluginName =
    manifest && typeof manifest.name === "string" ? manifest.name : undefined;
  const version =
    manifest && typeof manifest.version === "string"
      ? manifest.version
      : undefined;
  const skillPath = path.join(
    candidatePath,
    "skills",
    expectedSkillName,
    "SKILL.md",
  );
  const skillName = readSkillName(skillPath);
  if (pluginName !== expectedPluginName || skillName !== expectedSkillName) {
    return {
      path: candidatePath,
      state: "conflict",
      pluginName,
      skillName,
      version,
      detail:
        `Expected plugin '${expectedPluginName}' and skill '${expectedSkillName}', ` +
        `found plugin '${pluginName ?? "missing"}' and skill '${skillName ?? "missing"}'.`,
    };
  }

  if (source) {
    const eggRMetadata =
      manifest && isRecord(manifest.eggr) ? manifest.eggr : undefined;
    if (
      !eggRMetadata ||
      eggRMetadata.productId !== "eggr-orchestrator" ||
      eggRMetadata.managed !== true
    ) {
      return {
        path: candidatePath,
        state: "conflict",
        pluginName,
        skillName,
        version,
        detail: "Bundled source is missing the EggR product ownership marker.",
      };
    }
    return {
      path: candidatePath,
      state: "recognized-unmanaged",
      pluginName,
      skillName,
      version,
      detail: "Bundled source is structurally valid.",
    };
  }

  const state = readInstallState(path.join(candidatePath, INSTALL_STATE_FILE));
  if (!state) {
    const author =
      manifest && isRecord(manifest.author) && typeof manifest.author.name === "string"
        ? manifest.author.name
        : undefined;
    const eggRMetadata =
      manifest && isRecord(manifest.eggr) ? manifest.eggr : undefined;
    const knownLegacyDistribution =
      expectedPluginName === LEGACY_PLUGIN_NAME &&
      matchesLegacyAuthor(author) &&
      typeof version === "string" &&
      /^1\./.test(version);
    const knownEggRDistribution =
      expectedPluginName === EGGR_PLUGIN_NAME &&
      ((eggRMetadata?.productId === "eggr-orchestrator" &&
        eggRMetadata.managed === true) ||
        (matchesLegacyAuthor(author) && version === "2.0.0"));
    if (!knownLegacyDistribution && !knownEggRDistribution) {
      return {
        path: candidatePath,
        state: "conflict",
        pluginName,
        skillName,
        version,
        detail:
          "The plugin identity matches, but no known EggR ownership signature or install state was found.",
      };
    }
    return {
      path: candidatePath,
      state: "recognized-unmanaged",
      pluginName,
      skillName,
      version,
      detail:
        "Recognized plugin without an EggR install state. It can be backed up, never deleted in place.",
    };
  }
  const currentHashes = hashManagedTree(candidatePath);
  const checksumsMatch = mapsEqual(state.managedFiles, currentHashes);
  return {
    path: candidatePath,
    state: checksumsMatch ? "managed-current" : "managed-outdated",
    pluginName,
    skillName,
    version,
    detail: checksumsMatch
      ? "EggR ownership marker and managed checksums match."
      : "EggR ownership marker exists, but one or more managed files changed; the whole directory will be backed up before replacement.",
  };
}

function createInstallState(
  pluginPath: string,
  extensionVersion: string,
  now: Date,
): EggRInstallState {
  const manifest = readJsonObject(path.join(pluginPath, "plugin.json"));
  const version =
    manifest && typeof manifest.version === "string"
      ? manifest.version
      : "unknown";
  return {
    schemaVersion: 1,
    productId: "eggr-orchestrator",
    pluginName: EGGR_PLUGIN_NAME,
    skillName: EGGR_SKILL_NAME,
    pluginVersion: version,
    extensionVersion,
    installedAt: now.toISOString(),
    managedFiles: hashManagedTree(pluginPath),
  };
}

function readInstallState(filePath: string): EggRInstallState | undefined {
  const value = readJsonObject(filePath);
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.productId !== "eggr-orchestrator" ||
    value.pluginName !== EGGR_PLUGIN_NAME ||
    !isRecord(value.managedFiles)
  ) {
    return undefined;
  }
  const managedFiles: Record<string, string> = {};
  for (const [key, hash] of Object.entries(value.managedFiles)) {
    if (typeof hash !== "string") return undefined;
    managedFiles[key] = hash;
  }
  return {
    schemaVersion: 1,
    productId: "eggr-orchestrator",
    pluginName: EGGR_PLUGIN_NAME,
    skillName: EGGR_SKILL_NAME,
    pluginVersion:
      typeof value.pluginVersion === "string" ? value.pluginVersion : "unknown",
    extensionVersion:
      typeof value.extensionVersion === "string"
        ? value.extensionVersion
        : "unknown",
    installedAt:
      typeof value.installedAt === "string" ? value.installedAt : "",
    managedFiles,
  };
}

function hashManagedTree(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const relativePath of listFiles(root)) {
    if (relativePath === INSTALL_STATE_FILE) continue;
    const absolutePath = path.join(root, ...relativePath.split("/"));
    hashes[relativePath] = crypto
      .createHash("sha256")
      .update(fs.readFileSync(absolutePath))
      .digest("hex");
  }
  return hashes;
}

function listFiles(root: string, relative = ""): string[] {
  const directory = relative
    ? path.join(root, ...relative.split("/"))
    : root;
  const results: string[] = [];
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const childRelative = relative
      ? `${relative}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      results.push(...listFiles(root, childRelative));
    } else if (entry.isFile()) {
      results.push(childRelative);
    } else {
      throw new Error(`Unsupported plugin entry type: ${childRelative}`);
    }
  }
  return results;
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await fs.promises.mkdir(destination, { recursive: true });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(sourcePath, destinationPath);
    } else {
      throw new Error(`Unsupported plugin entry type: ${sourcePath}`);
    }
  }
}

async function writeJsonAtomic(
  filePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.promises.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await fs.promises.writeFile(
      temporary,
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    await fs.promises.rename(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function matchesLegacyAuthor(value: string | undefined): boolean {
  if (!value) return false;
  return crypto.createHash("sha256").update(value, "utf8").digest("hex") ===
    LEGACY_AUTHOR_SHA256;
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""),
    ) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readSkillName(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const match = fs
    .readFileSync(filePath, "utf8")
    .match(/^name:\s*([a-z0-9-]+)\s*$/m);
  return match?.[1];
}

function assertPathInside(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Unsafe managed path: ${resolvedCandidate}`);
  }
}

function mapsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key],
    )
  );
}

function throwIfRequested(
  options: PluginInstallOptions,
  point: PluginInstallOptions["failAt"],
): void {
  if (options.failAt === point) {
    throw new Error(`Injected plugin migration failure at ${point}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
