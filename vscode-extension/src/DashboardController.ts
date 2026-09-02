import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { DashboardOutboundMessage, DashboardState, RunSummary, WebviewToExtensionMessage, TokenStatus, LocalLlmMetric } from "./types";
import { RunStore } from "./RunStore";
import { TokenManager } from "./TokenManager";
import { WorkspacePaths } from "./WorkspacePaths";
import { resolveIntegratedPowerStateRoot } from "./storagePath";

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
  private lastFullTokenNotified = false;
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
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("integratedPower.view")) {
          this.state.viewConfig = this.getViewConfig();
          this.postState();
          void this.refresh(true);
        }
      })
    );
    this.startTokenPolling();
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
        this.seedVisibleState(message.state);
        this.postState();
        await this.refresh();
        return;
      case "refresh":
        await this.refresh(true);
        return;
      case "configureViews":
        await vscode.commands.executeCommand("integratedPower.agentRuns.configureViews");
        return;
      case "openConfigurationCenter":
        await vscode.commands.executeCommand("integratedPower.eggr.openConfigurationCenter");
        return;
      case "openRunsFile":
        await this.openRunsFile();
        return;
      case "openArtifact":
        await this.openArtifact(message.artifactId);
        return;
      case "openTerminals":
        await vscode.commands.executeCommand("integratedPower.terminals.openAll");
        return;
      case "showBroker":
        await vscode.commands.executeCommand("integratedPower.terminals.showBroker");
        return;
      case "showOllama":
        await vscode.commands.executeCommand("integratedPower.terminals.showOllama");
        return;
      case "showWebUI":
        await vscode.commands.executeCommand("integratedPower.terminals.showWebUI");
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
    const refreshStartedAt = new Date().toISOString();
    this.state = {
      ...this.state,
      isLoading: true,
      isStale: false,
      refreshStartedAt,
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
        refreshStartedAt: undefined,
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
      await vscode.workspace.fs.stat(file);
    } catch {
      void vscode.window.showInformationMessage("No agent runs found for this workspace yet. Start a task first to generate logs.");
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
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh(false);
    }, 150);
  }

  private syncTokenPolling(_isActive: boolean): void {
    // Keep continuous 5s polling active while dashboard is mounted
    this.startTokenPolling();
  }

  private startTokenPolling(): void {
    if (this.tokenPollingTimer) {
      return;
    }

    this.tokenPollingTimer = setInterval(async () => {
      if (this.isRefreshing) {
        return;
      }
      const pollGeneration = this.tokenRefreshGeneration;
      void this.refreshTokenStatus(pollGeneration, false);
      try {
        const nextState = await this.readDashboardState();
        if (pollGeneration !== this.tokenRefreshGeneration) {
          return;
        }
        this.state = {
          ...nextState,
          tokenStatus: this.mergeTokenStatus(this.state.tokenStatus, nextState.tokenStatus),
          isLoading: false,
          isTokenLoading: false,
          updatedAt: new Date().toISOString(),
        };
        this.postState();
      } catch {
        // Silent periodic background refresh
      }
    }, 5000);
  }

  private stopTokenPolling(_triggerFinalRefresh: boolean): void {
    if (this.tokenPollingTimer) {
      clearInterval(this.tokenPollingTimer);
      this.tokenPollingTimer = undefined;
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

    const [runsData, tokenStatus, queueContent, metricsCsv, localLlmMetricsCsv] = await Promise.all([
      this.runStore.readRuns(runsFileUri, {
        normalizeArtifactPath: (value) => this.paths.toWorkspaceRelativePath(value),
      }),
      this.tokenManager.getStatus(tokenFileUri, { refreshQuota: false }),
      this.readTextFileSilently(queueUri),
      this.readTextFileSilently(metricsUri),
      this.readTextFileSilently(localLlmMetricsUri),
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

    let resolvedTokenStatus = this.mergeTokenStatus(this.state.tokenStatus, tokenStatus);

    // On first load, show the skeleton only when there is truly no prior or newly fetched quota data.
    if (resolvedTokenStatus && !this.hasUsableTokenStatus(resolvedTokenStatus)) {
      resolvedTokenStatus = undefined;
    }

    const backgroundJobErrors = runs
      .filter((run) => run.status === "error" || run.status === "failed" || (run.exitCode !== undefined && run.exitCode !== 0))
      .map((run) => `Run failed: ${run.title} (ID: ${run.id})`);

    const combinedSystemErrors = [
      ...(this.state.systemErrors || []),
      ...(resolvedTokenStatus?.errors || []),
      ...backgroundJobErrors
    ];

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
      queueContent,
      metricsCsv,
      isLoading: false,
      isTokenLoading: true,
      isStale: false,
      refreshStartedAt: this.state.refreshStartedAt,
      updatedAt: new Date().toISOString(),
      viewConfig: this.getViewConfig(),
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

      const previousTokenStatus = this.state.tokenStatus;
      const safeTokenStatus: TokenStatus | undefined = this.mergeTokenStatus(previousTokenStatus, tokenStatus);

      this.checkFullTokenNotification(previousTokenStatus, safeTokenStatus);
      this.persistTokenStatusCache(safeTokenStatus);

      this.state = {
        ...this.state,
        tokenStatus: safeTokenStatus,
        isTokenLoading: false,
        refreshStartedAt: undefined,
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
        refreshStartedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      this.postState();
      this.postError(message);
    }
  }

  private checkFullTokenNotification(
    previous: TokenStatus | undefined,
    current: TokenStatus | undefined,
  ): void {
    if (!current) return;
    const config = vscode.workspace.getConfiguration("integratedPower");
    const enabled = config.get<boolean>("notifications.notifyOnFullTokens", true);
    if (!enabled) return;

    const agyPercent = current.antigravityPercentage ?? 100;
    const opusPercent = current.opusPercentage ?? 100;
    const codexPercent = current.codexPercentage ?? 100;

    const isAllFull = agyPercent >= 100 && opusPercent >= 100 && codexPercent >= 100;
    const wasAnyDepleted = previous
      ? (previous.antigravityPercentage !== undefined && previous.antigravityPercentage < 100) ||
        (previous.opusPercentage !== undefined && previous.opusPercentage < 100) ||
        (previous.codexPercentage !== undefined && previous.codexPercentage < 100)
      : false;

    if (isAllFull) {
      if (wasAnyDepleted && !this.lastFullTokenNotified) {
        this.lastFullTokenNotified = true;
        void vscode.window.showInformationMessage(
          "🎉 [Integrated Power] 모든 AI 모델 쿼터가 100%로 완충되었습니다! 작업을 최대 용량으로 시작할 수 있습니다.",
        );
      }
    } else {
      this.lastFullTokenNotified = false;
    }
  }

  private persistTokenStatusCache(status: TokenStatus | undefined): void {
    if (!status) return;
    try {
      const stateRoot = resolveIntegratedPowerStateRoot();
      fs.mkdirSync(stateRoot, { recursive: true });
      const cachePath = path.join(stateRoot, "token_status.json");
      fs.writeFileSync(cachePath, JSON.stringify(status, null, 2), "utf8");
    } catch {
      // Non-blocking telemetry cache write
    }
  }

  private mergeTokenStatus(
    previous: TokenStatus | undefined,
    current: TokenStatus | undefined,
  ): TokenStatus | undefined {
    if (!previous) return current;
    if (!current) return previous;

    return {
      ...previous,
      ...current,
      antigravityPercentage: current.antigravityPercentage ?? previous.antigravityPercentage,
      antigravityResetTime: current.antigravityResetTime ?? previous.antigravityResetTime,
      antigravityEstimatedAbsolute: current.antigravityEstimatedAbsolute ?? previous.antigravityEstimatedAbsolute,
      antigravityTokensLeft: current.antigravityTokensLeft || previous.antigravityTokensLeft,
      antigravityMax: current.antigravityMax || previous.antigravityMax,

      antigravityWeeklyPercentage: current.antigravityWeeklyPercentage ?? previous.antigravityWeeklyPercentage,
      antigravityWeeklyResetTime: current.antigravityWeeklyResetTime ?? previous.antigravityWeeklyResetTime,
      antigravityWeeklyTokensLeft: current.antigravityWeeklyTokensLeft || previous.antigravityWeeklyTokensLeft,
      antigravityWeeklyMax: current.antigravityWeeklyMax || previous.antigravityWeeklyMax,

      opusPercentage: current.opusPercentage ?? previous.opusPercentage,
      opusResetTime: current.opusResetTime ?? previous.opusResetTime,
      opusEstimatedAbsolute: current.opusEstimatedAbsolute ?? previous.opusEstimatedAbsolute,
      opusTokensLeft: current.opusTokensLeft || previous.opusTokensLeft,
      opusMax: current.opusMax || previous.opusMax,

      opusWeeklyPercentage: current.opusWeeklyPercentage ?? previous.opusWeeklyPercentage,
      opusWeeklyResetTime: current.opusWeeklyResetTime ?? previous.opusWeeklyResetTime,
      opusWeeklyEstimatedAbsolute: current.opusWeeklyEstimatedAbsolute ?? previous.opusWeeklyEstimatedAbsolute,
      opusWeeklyTokensLeft: current.opusWeeklyTokensLeft || previous.opusWeeklyTokensLeft,
      opusWeeklyMax: current.opusWeeklyMax || previous.opusWeeklyMax,

      codexPercentage: current.codexPercentage ?? previous.codexPercentage,
      codexResetTime: current.codexResetTime ?? previous.codexResetTime,
      codexEstimatedAbsolute: current.codexEstimatedAbsolute ?? previous.codexEstimatedAbsolute,
      codexTokensLeft: current.codexTokensLeft || previous.codexTokensLeft,
      codexMax: current.codexMax || previous.codexMax,

      codexWeeklyPercentage: current.codexWeeklyPercentage ?? previous.codexWeeklyPercentage,
      codexWeeklyResetTime: current.codexWeeklyResetTime ?? previous.codexWeeklyResetTime,
      codexWeeklyEstimatedAbsolute: current.codexWeeklyEstimatedAbsolute ?? previous.codexWeeklyEstimatedAbsolute,
      codexWeeklyTokensLeft: current.codexWeeklyTokensLeft || previous.codexWeeklyTokensLeft,
      codexWeeklyMax: current.codexWeeklyMax || previous.codexWeeklyMax,

      claudeDirectUsage: current.claudeDirectUsage ?? previous.claudeDirectUsage,
      localComputeStatus: {
        endpointHealth: current.localComputeStatus?.endpointHealth ?? previous.localComputeStatus?.endpointHealth ?? "offline",
        programName: current.localComputeStatus?.programName ?? previous.localComputeStatus?.programName ?? "Offline",
        loadedModels: (current.localComputeStatus?.loadedModels && current.localComputeStatus.loadedModels.length > 0)
          ? current.localComputeStatus.loadedModels
          : previous.localComputeStatus?.loadedModels || [],
        gpus: (current.localComputeStatus?.gpus && current.localComputeStatus.gpus.length > 0)
          ? current.localComputeStatus.gpus
          : previous.localComputeStatus?.gpus || [],
      },
      codexStatus: (current.codexStatus && current.codexStatus !== "offline") ? current.codexStatus : previous.codexStatus || "offline",
      llmStatus: (current.llmStatus && current.llmStatus !== "offline") ? current.llmStatus : previous.llmStatus || "offline",
      recommendedTaskWeight: (current.recommendedTaskWeight && current.recommendedTaskWeight !== "unknown")
        ? current.recommendedTaskWeight
        : previous.recommendedTaskWeight || "unknown",
      activity: (current.activity && current.activity.length) ? current.activity : previous.activity || [],
      errors: current.errors ?? previous.errors,
    };
  }

  private hasUsableTokenStatus(status: TokenStatus | undefined): boolean {
    if (!status) {
      return false;
    }

    return [
      status.antigravityMax,
      status.opusMax,
      status.codexMax,
      status.antigravityTokensLeft,
      status.opusTokensLeft,
      status.codexTokensLeft,
      status.antigravityEstimatedAbsolute,
      status.opusEstimatedAbsolute,
      status.codexEstimatedAbsolute,
      status.opusWeeklyEstimatedAbsolute,
      status.codexWeeklyEstimatedAbsolute,
      status.antigravityPercentage,
      status.antigravityWeeklyPercentage,
      status.opusPercentage,
      status.opusWeeklyPercentage,
      status.codexPercentage,
      status.codexWeeklyPercentage,
    ].some((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  }

  private seedVisibleState(state: Partial<DashboardState> | undefined): void {
    if (!state || typeof state !== "object") {
      return;
    }

    if (!this.hasUsableTokenStatus(this.state.tokenStatus) && this.hasUsableTokenStatus(state.tokenStatus)) {
      this.state = {
        ...this.state,
        tokenStatus: state.tokenStatus,
        updatedAt: state.updatedAt || this.state.updatedAt,
      };
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
      typed.type === "configureViews" ||
      typed.type === "openConfigurationCenter" ||
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
      refreshStartedAt: undefined,
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
      updatedAt: new Date().toISOString(),
      viewConfig: this.getViewConfig(),
    };
  }

  private getViewConfig() {
    const config = vscode.workspace.getConfiguration("integratedPower.view");
    return {
      showAntigravity: config.get<boolean>("showAntigravity", true),
      showCodex: config.get<boolean>("showCodex", true),
      showClaude: config.get<boolean>("showClaude", true),
      showLocalLlm: config.get<boolean>("showLocalLlm", true),
      showQueue: config.get<boolean>("showQueue", true),
      showMetrics: config.get<boolean>("showMetrics", true),
      showErrors: config.get<boolean>("showErrors", true),
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
