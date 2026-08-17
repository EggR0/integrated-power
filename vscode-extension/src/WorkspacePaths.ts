import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";
import {
  normalizeWorkspacePathForStorage,
  resolveIntegratedPowerStateRoot,
  resolveEggRWorkspaceDescriptor,
  workspaceStoragePathForFolder,
} from "./storagePath";

const RUNS_RELATIVE_PATH = ".agent-runs/runs.jsonl";
const TOKEN_REPORT_RELATIVE_PATH = "reports/agent-dashboard.md";
const DASHBOARD_STATE_RELATIVE_PATH = "reports/dashboard-state.json";

export {
  normalizeWorkspacePathForStorage,
  resolveIntegratedPowerStateRoot,
  workspaceStoragePathForFolder,
};

export class WorkspacePollutionError extends Error {
  constructor(public readonly targetPath: string, public readonly repoRoot: string) {
    super(
      `[WorkspacePollutionError] Blocked runtime write inside workspace: "${targetPath}". ` +
      `All state, telemetry, and metrics MUST target StateRoot outside the workspace repository ("${repoRoot}").`
    );
    this.name = "WorkspacePollutionError";
  }
}

/**
 * Asserts that targetPath is NOT inside the workspace repository.
 * Throws WorkspacePollutionError if a violation occurs.
 *
 * Design: fail-CLOSED. If either argument is missing, the check
 * cannot guarantee safety, so it refuses rather than silently allowing.
 *
 * Platform: case-insensitive comparison on win32 only.
 * Symlinks: resolved via fs.realpathSync where possible.
 */
export function assertNotInWorkspace(targetPath: string, repoRoot: string): void {
  if (!targetPath) {
    throw new WorkspacePollutionError(targetPath ?? "", repoRoot ?? "<unknown>");
  }
  if (!repoRoot) {
    throw new WorkspacePollutionError(targetPath, "<unresolved repoRoot>");
  }

  // Resolve symlinks where possible; fall back to path.resolve for non-existent targets
  let resolvedTarget: string;
  try {
    resolvedTarget = fs.realpathSync(targetPath);
  } catch {
    // Target may not exist yet — resolve the parent directory instead
    const parent = path.dirname(targetPath);
    try {
      resolvedTarget = path.join(fs.realpathSync(parent), path.basename(targetPath));
    } catch {
      resolvedTarget = path.resolve(targetPath);
    }
  }

  let resolvedRepo: string;
  try {
    resolvedRepo = fs.realpathSync(repoRoot);
  } catch {
    resolvedRepo = path.resolve(repoRoot);
  }

  // Case-insensitive only on Windows; Linux/macOS paths are case-sensitive
  const caseInsensitive = process.platform === "win32";
  const normTarget = caseInsensitive ? resolvedTarget.toLowerCase() : resolvedTarget;
  const normRepo = caseInsensitive ? resolvedRepo.toLowerCase() : resolvedRepo;

  if (normTarget === normRepo || normTarget.startsWith(normRepo + path.sep)) {
    throw new WorkspacePollutionError(targetPath, repoRoot);
  }
}

/**
 * Safely writes a file ensuring it is outside the workspace repository.
 * Uses fully async I/O to avoid blocking the VS Code extension host event loop.
 */
export async function safeWriteFile(
  targetPath: string,
  data: string | Uint8Array,
  repoRoot: string,
  options?: fs.WriteFileOptions
): Promise<void> {
  assertNotInWorkspace(targetPath, repoRoot);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, data, options);
}

/**
 * Safely appends to a file ensuring it is outside the workspace repository.
 * Uses fully async I/O to avoid blocking the VS Code extension host event loop.
 */
export async function safeAppendFile(
  targetPath: string,
  data: string | Uint8Array,
  repoRoot: string,
  options?: fs.WriteFileOptions
): Promise<void> {
  assertNotInWorkspace(targetPath, repoRoot);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.appendFile(targetPath, data, options);
}

export class WorkspacePaths {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public get workspaceName(): string {
    return vscode.workspace.name ?? "Workspace";
  }

  public get primaryFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  public get runsRelativePath(): string {
    return RUNS_RELATIVE_PATH;
  }

  public get tokenReportRelativePath(): string {
    return TOKEN_REPORT_RELATIVE_PATH;
  }

  private get workspaceStoragePath(): string | undefined {
    const folder = this.primaryFolder;
    if (!folder) return undefined;

    const descriptor = resolveEggRWorkspaceDescriptor(folder.uri.fsPath);
    return workspaceStoragePathForFolder(
      resolveIntegratedPowerStateRoot(),
      descriptor.repoRoot,
      descriptor.remoteUrl,
      descriptor.configuredId,
    );
  }

  public runsFileUri(): vscode.Uri | undefined {
    return this.joinGlobalStorage(RUNS_RELATIVE_PATH);
  }

  public tokenReportUri(): vscode.Uri | undefined {
    return this.joinGlobalStorage(TOKEN_REPORT_RELATIVE_PATH);
  }

  public dashboardStateUri(): vscode.Uri | undefined {
    return this.joinGlobalStorage(DASHBOARD_STATE_RELATIVE_PATH);
  }

  public queueUri(): vscode.Uri | undefined {
    return this.joinGlobalStorage("reports/ai-work-queue.md");
  }

  public metricsUri(): vscode.Uri | undefined {
    return this.joinGlobalStorage("reports/codex_timer_metrics.csv");
  }

  public createWatchers(onChange: () => void): vscode.Disposable[] {
    const globalStatePath = this.workspaceStoragePath;
    if (!globalStatePath) return [];

    // Defense-in-depth: verify the state path is outside the workspace repo
    const folder = this.primaryFolder;
    if (folder) {
      assertNotInWorkspace(globalStatePath, folder.uri.fsPath);
    }

    if (!fs.existsSync(globalStatePath)) {
      fs.mkdirSync(globalStatePath, { recursive: true });
    }

    const runWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(globalStatePath, RUNS_RELATIVE_PATH),
    );
    const tokenWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(globalStatePath, TOKEN_REPORT_RELATIVE_PATH),
    );

    return [
      runWatcher,
      runWatcher.onDidCreate(onChange),
      runWatcher.onDidChange(onChange),
      runWatcher.onDidDelete(onChange),
      tokenWatcher,
      tokenWatcher.onDidCreate(onChange),
      tokenWatcher.onDidChange(onChange),
      tokenWatcher.onDidDelete(onChange),
    ];
  }

  private joinGlobalStorage(relativePath: string): vscode.Uri | undefined {
    const basePath = this.workspaceStoragePath;
    if (!basePath) return undefined;

    // Reject path traversal segments (WARNING-3: prevent escaping StateRoot)
    const segments = relativePath.split(/[\/\\]/).filter(Boolean);
    if (segments.some(s => s === ".." || s === ".")) {
      throw new Error(`[WorkspacePaths] Invalid relative path (traversal detected): ${relativePath}`);
    }

    const target = path.join(basePath, ...segments);

    // Defense-in-depth: ensure the resolved path is outside the workspace repo
    const folder = this.primaryFolder;
    if (folder) {
      assertNotInWorkspace(target, folder.uri.fsPath);
    }
    return vscode.Uri.file(target);
  }

  public toWorkspaceRelativePath(value: string): string | undefined {
    const folder = this.primaryFolder;
    if (!folder) {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed || this.hasUnsupportedScheme(trimmed) || this.isUncPath(trimmed)) {
      return undefined;
    }

    const candidatePath = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(folder.uri.fsPath, trimmed);

    const basePath = this.workspaceStoragePath;
    if (basePath && this.isPathInsideFolder(candidatePath, basePath)) {
      const rel = path.relative(basePath, candidatePath);
      return this.toPortablePath(`[global]/${rel}`);
    }

    if (!this.isPathInsideFolder(candidatePath, folder.uri.fsPath)) {
      return undefined;
    }

    const relativePath = path.relative(folder.uri.fsPath, candidatePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return undefined;
    }

    return this.toPortablePath(relativePath);
  }

  public resolveWorkspaceRelativePath(workspacePath: string): vscode.Uri | undefined {
    const folder = this.primaryFolder;
    if (!folder) {
      return undefined;
    }

    const trimmed = workspacePath.trim();
    if (!trimmed || this.hasUnsupportedScheme(trimmed) || this.isUncPath(trimmed)) {
      return undefined;
    }

    if (trimmed.startsWith("[global]/")) {
      const basePath = this.workspaceStoragePath;
      if (!basePath) return undefined;
      const candidatePath = path.resolve(basePath, trimmed.slice("[global]/".length));
      if (!this.isPathInsideFolder(candidatePath, basePath)) {
        return undefined;
      }
      return vscode.Uri.file(candidatePath);
    }

    if (path.isAbsolute(trimmed)) {
      return undefined;
    }

    const candidatePath = path.resolve(folder.uri.fsPath, trimmed);
    if (!this.isPathInsideFolder(candidatePath, folder.uri.fsPath)) {
      return undefined;
    }

    return vscode.Uri.file(candidatePath);
  }

  private hasUnsupportedScheme(value: string): boolean {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value);
  }

  private isUncPath(value: string): boolean {
    return value.startsWith("\\\\") || value.startsWith("//");
  }

  private isPathInsideFolder(candidatePath: string, folderPath: string): boolean {
    const normalizedCandidate = path.resolve(candidatePath);
    const normalizedFolder = path.resolve(folderPath);
    const relativePath = path.relative(normalizedFolder, normalizedCandidate);

    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
  }

  private toPortablePath(value: string): string {
    return value.split(path.sep).join("/");
  }
}
