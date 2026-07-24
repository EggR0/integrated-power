import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";
import {
  normalizeWorkspacePathForStorage,
  workspaceStoragePathForFolder,
} from "./storagePath";

const RUNS_RELATIVE_PATH = ".agent-runs/runs.jsonl";
const TOKEN_REPORT_RELATIVE_PATH = "reports/agent-dashboard.md";
const DASHBOARD_STATE_RELATIVE_PATH = "reports/dashboard-state.json";

export { normalizeWorkspacePathForStorage, workspaceStoragePathForFolder };

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

    return workspaceStoragePathForFolder(this.context.globalStorageUri.fsPath, folder.uri.fsPath);
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
    const globalStoragePath = this.workspaceStoragePath;
    if (!globalStoragePath) return [];

    if (!fs.existsSync(globalStoragePath)) {
      fs.mkdirSync(globalStoragePath, { recursive: true });
    }

    const runWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(globalStoragePath, RUNS_RELATIVE_PATH),
    );
    const tokenWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(globalStoragePath, TOKEN_REPORT_RELATIVE_PATH),
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
    return vscode.Uri.file(path.join(basePath, ...relativePath.split("/")));
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
