import * as vscode from "vscode";
import * as path from "path";
import { DashboardOutboundMessage, DashboardState, RunSummary, WebviewToExtensionMessage, TokenStatus, LocalLlmMetric } from "./types";
import { RunStore } from "./RunStore";
import { TokenManager } from "./TokenManager";
import { WorkspacePaths } from "./WorkspacePaths";

type PostMessage = (message: DashboardOutboundMessage) => void;

export class DashboardController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watchers: vscode.Disposable[] = [];
  private readonly output = vscode.window.createOutputChannel("Integrated Power Agent Runs");
  private readonly runStore = new RunStore();
  private readonly tokenManager = new TokenManager();
  private readonly paths: WorkspacePaths;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private writeTimer?: ReturnType<typeof setTimeout>;
  private tokenPollingTimer?: ReturnType<typeof setInterval>;
  private pendingWriteState?: DashboardState;
  private isRefreshing = false;
  private pendingRefreshForce: boolean | undefined = undefined;
  private tokenRefreshGeneration = 0;
  private state: DashboardState = this.emptyState();

  constructor(private readonly context: vscode.ExtensionContext, private readonly postMessage: PostMessage) {
    this.paths = new WorkspacePaths(context);
    this.disposables.push(this.output);
    this.resetWatchers();

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.resetWatchers();
        void this.refresh();
      }),
    );
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    this.stopTokenPolling(false);

    for (const watcher of this.watchers.splice(0)) {
      watcher.dispose();
    }

    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  public publishState(): void {
    this.postState();
  }

  public async handleMessage(message: unknown): Promise<void> {
    if (!this.isInboundMessage(message)) {
      return;
    }

    switch (message.type) {
      case "ready":
        this.postState();
        await this.refresh();
        return;
      case "refresh":
        await this.refresh(true);
        return;
      case "openRunsFile":
        await this.openRunsFile();
        return;
      case "openArtifact":
        await this.openArtifact(message.artifactId);
        return;
    }
  }

  public async refresh(force: boolean = false): Promise<void> {
    if (this.isRefreshing) {
      this.pendingRefreshForce = (this.pendingRefreshForce || force) ? true : false;
      return;
    }

    this.isRefreshing = true;
    const generation = ++this.tokenRefreshGeneration;
    this.state = {
      ...this.state,
      isLoading: true,
      isStale: false,
      updatedAt: new Date().toISOString(),
    };
    this.postState();

    try {
      this.state = await this.readDashboardState();
      this.syncTokenPolling(this.state.activeRuns.length > 0);
      this.postState();
    } catch (error) {
      const message = this.errorMessage(error);
      this.output.appendLine(`[refresh failed] ${message}`);
      this.state = {
        ...this.state,
        systemErrors: [message, ...this.state.systemErrors].slice(0, 50),
        isLoading: false,
        isTokenLoading: false,
        isStale: true,
        updatedAt: new Date().toISOString(),
      };
      this.postState();
      this.postError(message);
    } finally {
      this.isRefreshing = false;
      if (this.pendingRefreshForce !== undefined) {
        const forceNext = this.pendingRefreshForce;
        this.pendingRefreshForce = undefined;
        // Schedule next refresh slightly later to yield execution
        setTimeout(() => { void this.refresh(forceNext); }, 50);
      }
    }

    void this.refreshTokenStatus(generation, force);
  }

  public async openRunsFile(): Promise<void> {
    const file = this.paths.runsFileUri();
    if (!file) {
      void vscode.window.showWarningMessage("No workspace folder is open.");
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      void vscode.window.showErrorMessage(`Unable to open runs file: ${this.errorMessage(error)}`);
    }
  }

  private resetWatchers(): void {
    for (const watcher of this.watchers.splice(0)) {
      watcher.dispose();
    }

    this.watchers.push(...this.paths.createWatchers(() => this.scheduleRefresh()));

    const terminalQueueUri = this.paths.terminalQueueUri();
    if (terminalQueueUri) {
      const globalStoragePath = normalizeWorkspacePathForStorage(this.context);
      if (globalStoragePath) {
        const terminalWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(globalStoragePath, "reports/terminal-queue.json")
        );
        this.watchers.push(
          terminalWatcher,
          terminalWatcher.onDidCreate(() => this.processTerminalQueue()),
          terminalWatcher.onDidChange(() => this.processTerminalQueue())
        );
      }
    }
  }

  private async processTerminalQueue(): Promise<void> {
    const uri = this.paths.terminalQueueUri();
    if (!uri) return;

    try {
      const data = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(data).toString("utf8").trim();
      if (!content) return;

      const commands = JSON.parse(content);
      if (!Array.isArray(commands) || commands.length === 0) return;

      // Clear the file so we don't process it again
      await vscode.workspace.fs.writeFile(uri, Buffer.from("[]", "utf8"));

      for (const cmd of commands) {
        if (typeof cmd.command === "string") {
          const terminalName = cmd.name || "AI Worker";
          const terminal = vscode.window.createTerminal(terminalName);
          terminal.show();
          terminal.sendText(cmd.command);
        }
      }
    } catch (e) {
      // Parse error or file not found, ignore
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh(true);
    }, 150);
  }

  private syncTokenPolling(isActive: boolean): void {
    if (isActive) {
      this.startTokenPolling();
    } else {
      this.stopTokenPolling(true);
    }
  }

  private startTokenPolling(): void {
    if (this.tokenPollingTimer) {
      return;
    }

    this.tokenPollingTimer = setInterval(() => {
      void this.refreshTokenStatus(this.tokenRefreshGeneration, true);
    }, 3000);
  }

  private stopTokenPolling(triggerFinalRefresh: boolean): void {
    if (this.tokenPollingTimer) {
      clearInterval(this.tokenPollingTimer);
      this.tokenPollingTimer = undefined;

      if (triggerFinalRefresh) {
        void this.refreshTokenStatus(this.tokenRefreshGeneration, true);
      }
    }
  }

  private async readDashboardState(): Promise<DashboardState> {
    const runsFileUri = this.paths.runsFileUri();
    const tokenFileUri = this.paths.tokenReportUri();
    const queueUri = this.paths.queueUri();
    const metricsUri = this.paths.metricsUri();
    let localLlmMetricsUri = undefined;
    if (metricsUri) {
      localLlmMetricsUri = metricsUri.with({ path: metricsUri.path.replace("token_usage.csv", "local_llm_metrics.csv") });
    }
    const architectureUri = this.paths.primaryFolder ? vscode.Uri.joinPath(this.paths.primaryFolder.uri, ".agents", "dashboard_architecture.md") : undefined;

    const [runsData, tokenStatus, queueContent, metricsCsv, localLlmMetricsCsv, architectureDiagram] = await Promise.all([
      this.runStore.readRuns(runsFileUri, {
        normalizeArtifactPath: (value) => this.paths.toWorkspaceRelativePath(value),
      }),
      this.tokenManager.getStatus(tokenFileUri, { refreshQuota: false }),
      this.readTextFileSilently(queueUri),
      this.readTextFileSilently(metricsUri),
      this.readTextFileSilently(localLlmMetricsUri),
      this.readTextFileSilently(architectureUri),
    ]);

    const runs = runsData.runs.map((run) => this.sanitizeRunForWebview(run));

    let localLlmMetrics: LocalLlmMetric[] = [];
    if (localLlmMetricsCsv) {
      const lines = localLlmMetricsCsv.split(/\r?\n/).filter(l => l.trim() !== "");
      if (lines.length > 1) {
        const headers = this.parseCsvLine(lines[0]).map((header) => header.trim());
        localLlmMetrics = lines.slice(1).map(line => {
          const parts = this.parseCsvLine(line);
          const value = (name: string, fallbackIndex?: number): string => {
            const index = headers.indexOf(name);
            if (index >= 0) {
              return parts[index] || "";
            }
            if (fallbackIndex !== undefined) {
              return parts[fallbackIndex] || "";
            }
            return "";
          };
          return {
            timestamp: value("Timestamp", 0),
            taskTitle: value("TaskTitle", 1),
            model: value("Model", 2),
            taskScale: value("TaskScale", 3),
            actualElapsedSeconds: parseFloat(value("ActualElapsedSeconds", 4) || "0"),
            totalTokens: parseInt(value("TotalTokens", 5) || "0", 10),
            taskType: value("TaskType") || undefined,
            provider: value("Provider") || undefined,
            success: this.parseBoolean(value("Success")),
            outputChars: this.parseOptionalNumber(value("OutputChars")),
            tokensPerSecond: this.parseOptionalNumber(value("TokensPerSecond")),
            selectedBy: value("SelectedBy") || undefined,
            selectionReason: value("SelectionReason") || undefined,
            errorMessage: value("ErrorMessage") || undefined,
          };
        });
      }
    }

    let resolvedTokenStatus: TokenStatus | undefined = tokenStatus;
    if (tokenStatus && this.state.tokenStatus && (this.state.tokenStatus.codexMax > 0 || this.state.tokenStatus.antigravityMax > 0)) {
      // If the newly fetched tokenStatus is empty (0-filled), but we already have valid data, keep the valid data!
      if (tokenStatus.codexMax === 0 && tokenStatus.antigravityMax === 0 && tokenStatus.opusMax === 0) {
        resolvedTokenStatus = {
          ...this.state.tokenStatus,
          activity: tokenStatus.activity,
        };
      }
    }

    // Instead of falling back to a 0-filled object, let it be undefined if it has no data.
    // This allows the webview to show the Loading Skeleton.
    if (resolvedTokenStatus && resolvedTokenStatus.codexMax === 0 && resolvedTokenStatus.antigravityMax === 0 && resolvedTokenStatus.opusMax === 0) {
      resolvedTokenStatus = undefined;
    }

    const backgroundJobErrors = runs
      .filter((run) => run.status === "error" || run.status === "failed" || (run.exitCode !== undefined && run.exitCode !== 0))
      .map((run) => `Run failed: ${run.title} (ID: ${run.id})`);

    const combinedSystemErrors = Array.from(new Set([
      ...(this.state.systemErrors || []),
      ...(resolvedTokenStatus?.errors || []),
      ...backgroundJobErrors
    ]));

    return {
      workspaceName: this.paths.workspaceName,
      runsFile: runsFileUri ? this.paths.runsRelativePath : undefined,
      runs,
      activeRuns: runs.filter((run) => run.active),
      artifacts: runs.flatMap((run) => run.artifacts),
      parseErrors: runsData.parseErrors,
      systemErrors: combinedSystemErrors,
      tokenStatus: resolvedTokenStatus,
      localLlmMetrics,
      architectureDiagram,
      queueContent,
      metricsCsv,
      isLoading: false,
      isTokenLoading: true,
      isStale: false,
      updatedAt: new Date().toISOString(),
    };
  }

  private async refreshTokenStatus(generation: number, force: boolean = false): Promise<void> {
    try {
      const tokenStatus = await this.tokenManager.getStatus(this.paths.tokenReportUri(), {
        refreshQuota: true,
        forceRefresh: force,
      });
      if (generation !== this.tokenRefreshGeneration) {
        return;
      }

      const safeTokenStatus: TokenStatus = tokenStatus || {
          antigravityTokensLeft: 0,
          antigravityMax: 0,
          antigravityWeeklyTokensLeft: 0,
          antigravityWeeklyMax: 0,
          opusTokensLeft: 0,
          opusMax: 0,
          opusWeeklyTokensLeft: 0,
          opusWeeklyMax: 0,
          codexTokensLeft: 0,
          codexMax: 0,
          codexWeeklyTokensLeft: 0,
          codexWeeklyMax: 0,
          codexStatus: "offline",
          llmStatus: "offline",
          recommendedTaskWeight: "unknown",
          activity: []
      };

      this.state = {
        ...this.state,
        tokenStatus: safeTokenStatus,
        isTokenLoading: false,
        updatedAt: new Date().toISOString(),
      };
      this.postState();
    } catch (error) {
      if (generation !== this.tokenRefreshGeneration) {
        return;
      }

      const message = this.errorMessage(error);
      this.output.appendLine(`[token refresh failed] ${message}`);
      this.state = {
        ...this.state,
        systemErrors: [message, ...this.state.systemErrors].slice(0, 50),
        isTokenLoading: false,
        updatedAt: new Date().toISOString(),
      };
      this.postState();
      this.postError(message);
    }
  }

  private async openArtifact(artifactId: string): Promise<void> {
    const artifact = this.state.artifacts.find((candidate) => candidate.id === artifactId);
    if (!artifact?.workspacePath) {
      void vscode.window.showWarningMessage("Artifact is unavailable or cannot be opened safely.");
      return;
    }

    const uri = this.paths.resolveWorkspaceRelativePath(artifact.workspacePath);
    if (!uri) {
      void vscode.window.showErrorMessage("Security error: artifact path is outside the primary workspace.");
      return;
    }

    if (!(await this.uriExists(uri))) {
      void vscode.window.showWarningMessage(`Artifact file no longer exists: ${artifact.label}`);
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      void vscode.window.showErrorMessage(`Unable to open artifact: ${this.errorMessage(error)}`);
    }
  }

  private sanitizeRunForWebview(run: RunSummary): RunSummary {
    return {
      ...run,
      cwd: run.cwd ? this.paths.toWorkspaceRelativePath(run.cwd) : undefined,
      contextFiles: run.contextFiles.flatMap((contextFile) => {
        const workspacePath = this.paths.toWorkspaceRelativePath(contextFile);
        return workspacePath ? [workspacePath] : [];
      }),
    };
  }

  private async uriExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async readTextFileSilently(uri: vscode.Uri | undefined): Promise<string | undefined> {
    if (!uri) { return undefined; }
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(data).toString("utf8");
    } catch {
      return undefined;
    }
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      const next = line[index + 1];

      if (char === "\"") {
        if (inQuotes && next === "\"") {
          current += "\"";
          index++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
        continue;
      }

      current += char;
    }

    values.push(current);
    return values;
  }

  private parseBoolean(value: string): boolean | undefined {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
    return undefined;
  }

  private parseOptionalNumber(value: string): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  private postState(): void {
    this.postMessage({
      type: "state",
      state: this.state,
    });
    this.scheduleWriteDashboardState(this.state);
  }

  private scheduleWriteDashboardState(state: DashboardState): void {
    this.pendingWriteState = state;
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      const stateToWrite = this.pendingWriteState;
      if (stateToWrite) {
        void this.writeDashboardState(stateToWrite);
      }
    }, 500);
  }

  private async writeDashboardState(state: DashboardState): Promise<void> {
    const uri = this.paths.dashboardStateUri();
    if (!uri) {
      return;
    }

    try {
      const json = `${JSON.stringify(state, null, 2)}\n`;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(json, "utf8"));
    } catch (error) {
      this.output.appendLine(`[dashboard state write failed] ${this.errorMessage(error)}`);
    }
  }

  private postError(message: string): void {
    this.postMessage({
      type: "error",
      message,
    });
  }

  private isInboundMessage(message: unknown): message is WebviewToExtensionMessage {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return false;
    }

    const typed = message as { type?: unknown; artifactId?: unknown };
    if (
      typed.type === "ready" ||
      typed.type === "refresh" ||
      typed.type === "openRunsFile"
    ) {
      return true;
    }

    return typed.type === "openArtifact" && typeof typed.artifactId === "string" && typed.artifactId.length > 0;
  }

  private emptyState(): DashboardState {
    return {
      workspaceName: "Workspace",
      runs: [],
      activeRuns: [],
      artifacts: [],
      parseErrors: [],
      systemErrors: [],
      isLoading: false,
      isTokenLoading: false,
      isStale: false,
      tokenStatus: {
          antigravityTokensLeft: 0,
          antigravityMax: 0,
          antigravityWeeklyTokensLeft: 0,
          antigravityWeeklyMax: 0,
          opusTokensLeft: 0,
          opusMax: 0,
          opusWeeklyTokensLeft: 0,
          opusWeeklyMax: 0,
          codexTokensLeft: 0,
          codexMax: 0,
          codexWeeklyTokensLeft: 0,
          codexWeeklyMax: 0,
          codexStatus: "offline",
          llmStatus: "offline",
          recommendedTaskWeight: "unknown",
          activity: []
      },
      architectureDiagram: undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
