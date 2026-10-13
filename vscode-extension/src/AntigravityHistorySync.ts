import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface HistorySyncResult {
  status: "ok" | "error";
  dry_run?: boolean;
  valid_indexed?: number;
  disk_sessions?: number;
  missing_count?: number;
  restored_count?: number;
  backup_path?: string | null;
  error?: string | null;
}

/**
 * Guard: Check if the current host application is Antigravity IDE.
 * Strictly ensures this functionality only executes in Antigravity IDE environments.
 */
export function isAntigravityHost(): boolean {
  const appName = (vscode.env.appName || "").toLowerCase();
  return appName.includes("antigravity");
}

export class AntigravityHistorySyncManager {
  private static instance: AntigravityHistorySyncManager | null = null;
  private timer: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private context: vscode.ExtensionContext;
  private scriptPath: string;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.scriptPath = path.join(
      context.extensionPath,
      "assets",
      "antigravity",
      "sync_history.py"
    );
  }

  public static async forceSync(context: vscode.ExtensionContext): Promise<HistorySyncResult> {
    if (!AntigravityHistorySyncManager.instance) {
      AntigravityHistorySyncManager.instance = new AntigravityHistorySyncManager(context);
    }
    return await AntigravityHistorySyncManager.instance.runSync({ userTriggered: true });
  }

  public static register(context: vscode.ExtensionContext): vscode.Disposable | null {
    if (!isAntigravityHost()) {
      return null;
    }

    if (!AntigravityHistorySyncManager.instance) {
      AntigravityHistorySyncManager.instance = new AntigravityHistorySyncManager(context);
      AntigravityHistorySyncManager.instance.start();
    }

    const commandDisposable = vscode.commands.registerCommand(
      "integratedPower.antigravity.syncHistory",
      async () => {
        await AntigravityHistorySyncManager.instance?.runSync({ userTriggered: true });
      }
    );

    context.subscriptions.push(commandDisposable);

    return new vscode.Disposable(() => {
      AntigravityHistorySyncManager.instance?.dispose();
      AntigravityHistorySyncManager.instance = null;
    });
  }

  public start(): void {
    // 1. Initial silent check upon extension activation
    void this.runSync({ silent: true });

    // 2. Periodic background check every 10 minutes
    this.timer = setInterval(() => {
      void this.runSync({ silent: true });
    }, 10 * 60 * 1000);

    // 3. File system watcher for ~/.gemini/antigravity-ide/conversations
    const convDir = path.join(os.homedir(), ".gemini", "antigravity-ide", "conversations");
    if (fs.existsSync(convDir)) {
      try {
        this.watcher = fs.watch(convDir, (eventType, filename) => {
          if (filename && filename.endsWith(".db")) {
            if (this.debounceTimer) {
              clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = setTimeout(() => {
              void this.runSync({ silent: true });
            }, 3000);
          }
        });
      } catch {
        // Fallback to timer if fs.watch fails
      }
    }
  }

  public async runSync(options: { silent?: boolean; userTriggered?: boolean } = {}): Promise<HistorySyncResult> {
    if (!fs.existsSync(this.scriptPath)) {
      const errRes: HistorySyncResult = { status: "error", error: `Script not found: ${this.scriptPath}` };
      if (options.userTriggered) {
        void vscode.window.showErrorMessage(`Antigravity 동기화 스크립트가 없습니다: ${this.scriptPath}`);
      }
      return errRes;
    }

    const pythonExecutable = this.findPythonExecutable();

    try {
      const { stdout } = await execFileAsync(pythonExecutable, [this.scriptPath, "--json"], {
        windowsHide: true,
        timeout: 15000,
      });

      const parsed: HistorySyncResult = JSON.parse(stdout.trim());

      if (parsed.status === "ok") {
        if ((parsed.restored_count ?? 0) > 0) {
          const message = `[Antigravity IDE] ${parsed.restored_count}개의 누락된 대화 세션이 자동 복구되었습니다!`;
          const reloadAction = "창 새로고침 (Reload Window)";
          void vscode.window
            .showInformationMessage(message, reloadAction)
            .then((selected) => {
              if (selected === reloadAction) {
                void vscode.commands.executeCommand("workbench.action.reloadWindow");
              }
            });
        } else if (options.userTriggered) {
          void vscode.window.showInformationMessage(
            `[Antigravity IDE] 모든 대화 기록이 정상 인덱싱되어 있습니다. (총 ${parsed.valid_indexed ?? 0}개)`
          );
        }
      } else if (options.userTriggered && parsed.error) {
        void vscode.window.showWarningMessage(`[Antigravity IDE] 동기화 중 오류: ${parsed.error}`);
      }

      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.userTriggered) {
        void vscode.window.showErrorMessage(`[Antigravity IDE] 동기화 실행 실패: ${message}`);
      }
      return { status: "error", error: message };
    }
  }

  private findPythonExecutable(): string {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const candidatePaths = [
      path.join(userProfile, "AppData", "Local", "Programs", "Python", "Python311", "pythonw.exe"),
      path.join(userProfile, "AppData", "Local", "Programs", "Python", "Python311", "python.exe"),
      "pythonw",
      "python",
    ];

    for (const p of candidatePaths) {
      if (path.isAbsolute(p) && fs.existsSync(p)) {
        return p;
      }
    }

    return "python";
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
