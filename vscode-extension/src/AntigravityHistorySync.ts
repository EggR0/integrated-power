import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface HistorySyncResult {
  status: "ok" | "error";
  dry_run?: boolean;
  valid_indexed?: number;
  disk_sessions?: number;
  missing_count?: number;
  restored_count?: number;
  migrated_count?: number;
  skipped_active_count?: number;
  target_workspace?: string;
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
  private repairScriptPath: string;
  private lastPromptedPendingCount = 0;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.scriptPath = path.join(
      context.extensionPath,
      "assets",
      "antigravity",
      "sync_history.py"
    );
    this.repairScriptPath = path.join(
      context.extensionPath,
      "assets",
      "antigravity",
      "repair_and_restart.py"
    );
  }

  public static async forceSync(context: vscode.ExtensionContext): Promise<HistorySyncResult> {
    if (!AntigravityHistorySyncManager.instance) {
      AntigravityHistorySyncManager.instance = new AntigravityHistorySyncManager(context);
    }
    return await AntigravityHistorySyncManager.instance.runSync({ userTriggered: true, force: true });
  }

  public static async repairAndRestart(context: vscode.ExtensionContext): Promise<void> {
    if (!AntigravityHistorySyncManager.instance) {
      AntigravityHistorySyncManager.instance = new AntigravityHistorySyncManager(context);
    }
    await AntigravityHistorySyncManager.instance.promptAndExecuteRepairAndRestart();
  }

  public static register(context: vscode.ExtensionContext): vscode.Disposable | null {
    if (!isAntigravityHost()) {
      return null;
    }

    if (!AntigravityHistorySyncManager.instance) {
      AntigravityHistorySyncManager.instance = new AntigravityHistorySyncManager(context);
      AntigravityHistorySyncManager.instance.start();
    }

    const syncCommand = vscode.commands.registerCommand(
      "integratedPower.antigravity.syncHistory",
      async () => {
        await AntigravityHistorySyncManager.instance?.runSync({ userTriggered: true, force: true });
      }
    );

    const repairCommand = vscode.commands.registerCommand(
      "integratedPower.antigravity.repairAndRestart",
      async () => {
        await AntigravityHistorySyncManager.instance?.promptAndExecuteRepairAndRestart();
      }
    );

    context.subscriptions.push(syncCommand, repairCommand);

    return new vscode.Disposable(() => {
      AntigravityHistorySyncManager.instance?.dispose();
      AntigravityHistorySyncManager.instance = null;
    });
  }

  public start(): void {
    // 1. Initial check upon extension activation
    void this.checkPendingRecovery();

    // 2. Periodic background check every 10 minutes
    this.timer = setInterval(() => {
      void this.checkPendingRecovery();
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
              void this.checkPendingRecovery();
            }, 10000);
          }
        });
      } catch {
        // Fallback to timer if fs.watch fails
      }
    }
  }

  /**
   * Check for recoverable conversations in dry-run mode.
   * If recovery is needed, prompt the user with a notification offering to run the repair & restart routine.
   */
  public async checkPendingRecovery(): Promise<void> {
    try {
      const res = await this.runDryRun();
      const missing = res.missing_count ?? 0;
      const migrated = res.migrated_count ?? 0;
      const totalPending = missing + migrated;

      if (totalPending > 0 && totalPending !== this.lastPromptedPendingCount) {
        this.lastPromptedPendingCount = totalPending;
        const actionText = "대화 복구 및 IDE 재시작";
        const message = `[Antigravity IDE] 복구 가능한 대화 기록(${totalPending}개)이 발견되었습니다. 안전한 복구를 위해 IDE 재시작 스크립트를 실행하시겠습니까?`;

        void vscode.window
          .showInformationMessage(message, actionText, "나중에")
          .then((selected) => {
            if (selected === actionText) {
              void this.promptAndExecuteRepairAndRestart();
            }
          });
      }
    } catch {
      // Ignore background check errors
    }
  }

  /**
   * Prompt user with explicit modal warning before shutting down and restarting IDE.
   */
  public async promptAndExecuteRepairAndRestart(): Promise<void> {
    const confirmBtn = "복구 및 재시작";
    const selected = await vscode.window.showWarningMessage(
      "안티그래비티 IDE가 완전히 종료된 후, 몇 초 뒤 자동으로 다시 시작되며 대화 기록이 복구됩니다.\n\n진행 중인 작업 내용이 저장되었는지 확인해 주십시오. 계속하시겠습니까?",
      { modal: true },
      confirmBtn,
      "취소"
    );

    if (selected === confirmBtn) {
      await this.executeRepairAndRestart();
    }
  }

  /**
   * Spawns repair_and_restart.py in detached background mode and cleanly exits IDE.
   */
  public async executeRepairAndRestart(): Promise<void> {
    if (!fs.existsSync(this.repairScriptPath)) {
      void vscode.window.showErrorMessage(`복구 스크립트를 찾을 수 없습니다: ${this.repairScriptPath}`);
      return;
    }

    const pythonExecutable = this.findPythonExecutable();
    const currentWsUri = vscode.workspace.workspaceFolders?.[0]?.uri?.toString() || "";
    const currentWsPath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || "";
    const idePid = process.pid;
    const execPath = process.execPath;

    try {
      if (process.platform === "win32") {
        // Windows: Launch via explorer.exe to break away from VS Code / Electron Job Object.
        // Direct child_process.spawn() inherits JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE from the
        // Extension Host, causing the process to be terminated when the IDE quits.
        // Delegating process creation to explorer.exe ensures:
        // 1. The process is parented by explorer.exe (completely outside the IDE Job Object).
        // 2. A visible, standalone Command Prompt terminal window opens on the desktop.
        // 3. The recovery orchestrator survives workbench.action.quit and safely completes.
        const runnerBatPath = path.join(os.tmpdir(), "antigravity_repair_runner.bat");
        // Escape '%' for cmd.exe batch parameter substitution (e.g. %3A -> %%3A, %20 -> %%20)
        const escapedUri = currentWsUri.replace(/%/g, "%%");
        const cleanPython = pythonExecutable.replace(/pythonw\.exe$/i, "python.exe");

        // Windows cmd.exe requires CRLF (\r\n) line endings. LF causes line parsing corruption.
        // Keep batch script minimal so cmd.exe never mishandles UTF-8 or special characters.
        // repair_and_restart.py handles all rich console UI, logging, and countdown.
        const batLines = [
          "@echo off",
          "chcp 65001 >nul",
          "title Antigravity IDE 대화 기록 복구 및 재시작",
          `"${cleanPython}" "${this.repairScriptPath}" --ide-pid ${idePid} --workspace "${currentWsPath}" --exec-path "${execPath}" --target-ws-uri "${escapedUri}"`,
          "if errorlevel 1 pause",
          "",
        ];
        const batContent = batLines.join("\r\n");
        fs.writeFileSync(runnerBatPath, batContent, "utf-8");

        const child = spawn("explorer.exe", [runnerBatPath], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        // Allow 800ms for explorer.exe to register and launch the console window
        await new Promise((resolve) => setTimeout(resolve, 800));
      } else {
        const child = spawn(
          pythonExecutable,
          [
            this.repairScriptPath,
            "--ide-pid",
            String(idePid),
            "--workspace",
            currentWsPath,
            "--exec-path",
            execPath,
            "--target-ws-uri",
            currentWsUri,
          ],
          {
            detached: true,
            stdio: "ignore",
          }
        );
        child.unref();
      }

      // Gracefully quit Antigravity IDE so in-memory state flushes before repair script writes to state.vscdb
      await vscode.commands.executeCommand("workbench.action.quit");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`복구 프로세스 시작 실패: ${message}`);
    }
  }

  public async runDryRun(): Promise<HistorySyncResult> {
    if (!fs.existsSync(this.scriptPath)) {
      return { status: "error", error: `Script not found: ${this.scriptPath}` };
    }

    const pythonExecutable = this.findPythonExecutable();
    const currentWsUri = vscode.workspace.workspaceFolders?.[0]?.uri?.toString() || "";
    const args = [this.scriptPath, "--dry-run", "--json"];
    if (currentWsUri) {
      args.push("--target-workspace", currentWsUri);
    }

    const { stdout } = await execFileAsync(pythonExecutable, args, {
      windowsHide: true,
      timeout: 10000,
    });

    return JSON.parse(stdout.trim());
  }

  public async runSync(options: { silent?: boolean; userTriggered?: boolean; force?: boolean } = {}): Promise<HistorySyncResult> {
    if (!fs.existsSync(this.scriptPath)) {
      const errRes: HistorySyncResult = { status: "error", error: `Script not found: ${this.scriptPath}` };
      if (options.userTriggered) {
        void vscode.window.showErrorMessage(`Antigravity 동기화 스크립트가 없습니다: ${this.scriptPath}`);
      }
      return errRes;
    }

    const pythonExecutable = this.findPythonExecutable();
    const currentWsUri = vscode.workspace.workspaceFolders?.[0]?.uri?.toString() || "";

    const args = [this.scriptPath, "--json"];
    if (currentWsUri) {
      args.push("--target-workspace", currentWsUri);
    }
    if (options.force || options.userTriggered) {
      args.push("--force");
    }

    try {
      const { stdout } = await execFileAsync(pythonExecutable, args, {
        windowsHide: true,
        timeout: 15000,
      });

      const parsed: HistorySyncResult = JSON.parse(stdout.trim());

      if (parsed.status === "ok") {
        const restored = parsed.restored_count ?? 0;
        const migrated = parsed.migrated_count ?? 0;
        const valid = parsed.valid_indexed ?? 0;

        if (options.userTriggered) {
          if (restored > 0 || migrated > 0) {
            const parts: string[] = [];
            if (restored > 0) parts.push(`${restored}개 누락 세션 감지/복구`);
            if (migrated > 0) parts.push(`${migrated}개 세션 마이그레이션 대상`);
            const message = `[Antigravity IDE] ${parts.join(", ")} 완료! (총 ${valid}개 인덱싱). 완전한 영구 반영을 위해 IDE 재시작 복구를 권장합니다.`;
            const restartAction = "대화 복구 및 IDE 재시작";
            void vscode.window
              .showInformationMessage(message, restartAction)
              .then((selected) => {
                if (selected === restartAction) {
                  void this.promptAndExecuteRepairAndRestart();
                }
              });
          } else {
            void vscode.window.showInformationMessage(
              `[Antigravity IDE] 모든 대화 기록이 정상 인덱싱되어 있습니다. (총 ${valid}개 유효 인덱싱)`
            );
          }
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
      path.join(userProfile, "AppData", "Local", "Programs", "Python", "Python311", "python.exe"),
      path.join(userProfile, "AppData", "Local", "Programs", "Python", "Python311", "pythonw.exe"),
      "python",
      "pythonw",
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
