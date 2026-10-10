import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { DashboardOutboundMessage, DashboardState, RunSummary, WebviewToExtensionMessage, TokenStatus, LocalLlmMetric, PrewarmMode } from "./types";
import { RunStore } from "./RunStore";
import { TokenManager } from "./TokenManager";
import { WorkspacePaths } from "./WorkspacePaths";
import { resolveIntegratedPowerStateRoot } from "./storagePath";
import { detectRefilledQuotaWindows } from "./quotaNotifications";

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
  private pendingRefreshForce?: boolean;
  private tokenRefreshGeneration = 0;
  private notifiedFullWindows = new Set<string>();
  private currentPrewarmMode: PrewarmMode = "click";
  private currentPrewarmModes: Record<string, PrewarmMode> = {
    antigravity: "click",
    opus: "click",
    codex: "click",
  };
  private lastAutoPrewarmByTarget: Record<string, number> = {};
  private state: DashboardState = this.emptyState();

  constructor(private readonly context: vscode.ExtensionContext, private readonly postMessage: PostMessage) {
    this.paths = new WorkspacePaths(context);
    this.disposables.push(this.output);
    this.currentPrewarmModes = this.loadPrewarmModesFromConfig();
    this.currentPrewarmMode = this.currentPrewarmModes.antigravity;
    this.state.prewarmMode = this.currentPrewarmMode;
    this.state.prewarmModes = { ...this.currentPrewarmModes };
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
        if (e.affectsConfiguration("integratedPower.quota")) {
          const newModes = this.loadPrewarmModesFromConfig();
          this.currentPrewarmModes = newModes;
          this.currentPrewarmMode = newModes.antigravity;
          this.state.prewarmMode = this.currentPrewarmMode;
          this.state.prewarmModes = { ...newModes };
          this.postState();
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
      case "prewarm":
        await this.handlePrewarm((message as { model?: string }).model);
        return;
      case "setPrewarmMode":
        const prewarmMsg = message as { mode: PrewarmMode; target?: string };
        await this.setPrewarmMode(prewarmMsg.mode, prewarmMsg.target);
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
        void this.checkAutoPrewarm(this.state.tokenStatus);
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
      prewarmMode: this.currentPrewarmMode,
      prewarmModes: { ...this.currentPrewarmModes },
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
      void this.checkAutoPrewarm(safeTokenStatus);
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
    const masterEnabled = config.get<boolean>("notifications.notifyOnFullTokens", true);
    if (!masterEnabled) return;

    const { notifications, updatedNotifiedSet } = detectRefilledQuotaWindows(
      previous,
      current,
      this.notifiedFullWindows,
    );
    this.notifiedFullWindows = updatedNotifiedSet;

    for (const item of notifications) {
      const targetEnabled = config.get<boolean>(item.target.configKey, true);
      if (targetEnabled) {
        void vscode.window.showInformationMessage(
          `⚡ [Integrated Power] ${item.target.message}`,
        );
      }
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
      typed.type === "openRunsFile" ||
      typed.type === "prewarm" ||
      typed.type === "setPrewarmMode"
    ) {
      return true;
    }

    return typed.type === "openArtifact" && typeof typed.artifactId === "string" && typed.artifactId.length > 0;
  }

  private getPrewarmEligibility(
    modelKey?: string,
    status?: TokenStatus
  ): { eligible: boolean; reason: string; prefix: string; targetModel: string; label: string } {
    const raw = (modelKey || "antigravity").toLowerCase();
    let prefix = "antigravity";
    let weeklyPrefix = "antigravityWeekly";
    let targetModel = "gemini-3.8-flash-low";
    let label = "Gemini 5Hours";

    if (raw.includes("opus") || raw.includes("claude")) {
      prefix = "opus";
      weeklyPrefix = "opusWeekly";
      targetModel = "claude-sonnet-5-5-low";
      label = "Claude 5Hours";
    } else if (raw.includes("codex") || raw.includes("chatgpt")) {
      prefix = "codex";
      weeklyPrefix = "codexWeekly";
      targetModel = "gpt-4o-mini";
      label = "ChatGPT 5Hours";
    }

    if (!status) {
      return { eligible: false, reason: "No quota telemetry data available yet", prefix, targetModel, label };
    }

    // Check provider online status
    if (prefix === "codex" && (status.codexStatus === "offline" || status.codexStatus === "unauthenticated")) {
      return { eligible: false, reason: "ChatGPT / Codex provider is offline", prefix, targetModel, label };
    }

    // Check weekly quota exhaustion
    const weeklyPct = typeof (status as any)[`${weeklyPrefix}Percentage`] === "number"
      ? Number((status as any)[`${weeklyPrefix}Percentage`])
      : undefined;
    const weeklyLeft = typeof (status as any)[`${weeklyPrefix}TokensLeft`] === "number"
      ? Number((status as any)[`${weeklyPrefix}TokensLeft`])
      : undefined;
    const weeklyMax = typeof (status as any)[`${weeklyPrefix}Max`] === "number"
      ? Number((status as any)[`${weeklyPrefix}Max`])
      : 0;

    let isWeeklyExhausted = false;
    if (typeof weeklyPct === "number") {
      isWeeklyExhausted = weeklyPct <= 0.05;
    } else if (weeklyMax > 0 && typeof weeklyLeft === "number") {
      isWeeklyExhausted = weeklyLeft === 0;
    }

    if (isWeeklyExhausted) {
      return { eligible: false, reason: `${label} weekly quota is exhausted (${(weeklyPct ?? 0).toFixed(1)}% remaining). All 5-hour capacity is locked.`, prefix, targetModel, label };
    }

    // Check 5-hour percentage
    const fiveHPct = typeof (status as any)[`${prefix}Percentage`] === "number"
      ? Number((status as any)[`${prefix}Percentage`])
      : 0;
    if (fiveHPct < 99.95) {
      return { eligible: false, reason: `${label} quota is not 100% full (${fiveHPct.toFixed(1)}% remaining). Pre-warm only operates on 100% Ready windows.`, prefix, targetModel, label };
    }

    // Check recent pre-warm cooldown (minimum 30 minutes per model to prevent quota burns)
    const lastPrewarm = this.lastAutoPrewarmByTarget[prefix] || 0;
    const elapsed = Date.now() - lastPrewarm;
    const COOLDOWN_MS = 30 * 60 * 1000;
    if (elapsed < COOLDOWN_MS) {
      const waitMin = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
      return { eligible: false, reason: `${label} was pre-warmed recently. Cooldown active (${waitMin}m remaining).`, prefix, targetModel, label };
    }

    return { eligible: true, reason: "Ready", prefix, targetModel, label };
  }

  private async handlePrewarm(modelKey?: string): Promise<void> {
    const check = this.getPrewarmEligibility(modelKey, this.state.tokenStatus);
    if (!check.eligible) {
      this.output.appendLine(`[prewarm] Refusing pre-warm for ${check.label}: ${check.reason}`);
      void vscode.window.showWarningMessage(`[Integrated Power] Pre-warm skipped: ${check.reason}`);
      return;
    }

    this.output.appendLine(`[prewarm] 5-hour quota pre-warm approved for ${check.label} (100% Ready). Starting instant abort ping...`);
    this.lastAutoPrewarmByTarget[check.prefix] = Date.now();

    if (check.prefix === "codex") {
      // Codex / ChatGPT: Use codex CLI with lowest model (gpt-4o-mini), ephemeral flag, and instant abort
      const codexCli = this.tokenManager.findCodexCli();
      if (codexCli) {
        try {
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (!settled) {
                settled = true;
                resolve();
              }
            };

            const timer = setTimeout(() => {
              try {
                child.kill();
              } catch {}
              finish();
            }, 250);

            const child = cp.spawn(
              codexCli,
              [
                "exec",
                "-m",
                "gpt-4o-mini",
                "--skip-git-repo-check",
                "--ephemeral",
                "--ignore-rules",
                "--disable",
                "skills",
                "-c",
                "model=\"gpt-4o-mini\"",
                "1",
              ],
              {
                stdio: ["ignore", "ignore", "ignore"],
                windowsHide: true,
                shell: codexCli === "codex" || codexCli.endsWith(".cmd"),
              }
            );

            child.on("error", (err) => {
              clearTimeout(timer);
              this.output.appendLine(`[prewarm] codex spawn error: ${this.errorMessage(err)}`);
              finish();
            });

            child.on("close", () => {
              clearTimeout(timer);
              finish();
            });
          });

          this.output.appendLine(`[prewarm] codex minimal ping dispatched with instant abort (model: gpt-4o-mini)`);
        } catch (err) {
          this.output.appendLine(`[prewarm] codex execution error: ${this.errorMessage(err)}`);
        }
      }
    } else {
      // Gemini & Claude: Use agy CLI with low-tier model and instant abort
      const agyBin = path.join(process.env.LOCALAPPDATA || "C:\\Users\\jsp0\\AppData\\Local", "agy", "bin", "agy.exe");
      if (fs.existsSync(agyBin)) {
        try {
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (!settled) {
                settled = true;
                resolve();
              }
            };

            const timer = setTimeout(() => {
              try {
                proc.kill();
              } catch {}
              finish();
            }, 250);

            const proc = cp.spawn(
              agyBin,
              [
                "-p",
                "1",
                "--model",
                check.targetModel,
                "--effort",
                "low",
                "--disable-slash-commands",
                "--print-timeout",
                "1s",
              ],
              { windowsHide: true }
            );

            proc.on("error", (err) => {
              clearTimeout(timer);
              this.output.appendLine(`[prewarm] agy spawn error: ${this.errorMessage(err)}`);
              finish();
            });

            proc.on("close", () => {
              clearTimeout(timer);
              finish();
            });
          });

          this.output.appendLine(`[prewarm] agy minimal ping dispatched with instant abort (model: ${check.targetModel})`);
        } catch (err) {
          this.output.appendLine(`[prewarm] agy execution error: ${this.errorMessage(err)}`);
        }
      }
    }

    try {
      // Safe refresh without forceRefresh to prevent spawning secondary sessions
      const refreshed = await this.tokenManager.getStatus(this.paths.tokenReportUri(), {
        refreshQuota: true,
        forceRefresh: false,
      });
      if (refreshed) {
        this.state = {
          ...this.state,
          tokenStatus: refreshed,
          updatedAt: new Date().toISOString(),
        };
        this.postState();
      }
    } catch (err) {
      this.output.appendLine(`[prewarm] Telemetry refresh notice: ${this.errorMessage(err)}`);
    }

    void vscode.window.showInformationMessage(
      `[Integrated Power] Instant pre-warm probe dispatched for ${check.label}. Live quota clock initiated.`
    );
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
      prewarmMode: this.currentPrewarmMode,
      prewarmModes: { ...this.currentPrewarmModes },
    };
  }

  private loadPrewarmModesFromConfig(): Record<string, PrewarmMode> {
    const config = vscode.workspace.getConfiguration("integratedPower.quota");
    const globalMode = this.normalizeMode(config.get<string>("prewarmMode", "click"));
    const gemini = this.normalizeMode(config.get<string>("prewarmModeGemini", globalMode));
    const claude = this.normalizeMode(config.get<string>("prewarmModeClaude", globalMode));
    const chatgpt = this.normalizeMode(config.get<string>("prewarmModeChatGPT", globalMode));
    return {
      antigravity: gemini,
      opus: claude,
      codex: chatgpt,
    };
  }

  private normalizeMode(value: unknown): PrewarmMode {
    if (value === "always" || value === "once" || value === "click") {
      return value;
    }
    return "click";
  }

  private getPrewarmMode(target?: string): PrewarmMode {
    if (target && target in this.currentPrewarmModes) {
      return this.currentPrewarmModes[target];
    }
    return this.currentPrewarmMode;
  }

  private async setPrewarmMode(mode: PrewarmMode, target?: string): Promise<void> {
    const validMode = this.normalizeMode(mode);
    const targetKey = target?.toLowerCase();

    if (targetKey && (targetKey.includes("gemini") || targetKey.includes("antigravity"))) {
      this.currentPrewarmModes.antigravity = validMode;
    } else if (targetKey && (targetKey.includes("claude") || targetKey.includes("opus"))) {
      this.currentPrewarmModes.opus = validMode;
    } else if (targetKey && (targetKey.includes("codex") || targetKey.includes("chatgpt"))) {
      this.currentPrewarmModes.codex = validMode;
    } else {
      this.currentPrewarmModes = {
        antigravity: validMode,
        opus: validMode,
        codex: validMode,
      };
    }

    this.currentPrewarmMode = this.currentPrewarmModes.antigravity;
    this.state = {
      ...this.state,
      prewarmMode: this.currentPrewarmMode,
      prewarmModes: { ...this.currentPrewarmModes },
    };
    this.postState();

    try {
      const config = vscode.workspace.getConfiguration("integratedPower.quota");
      if (targetKey && (targetKey.includes("gemini") || targetKey.includes("antigravity"))) {
        await config.update("prewarmModeGemini", validMode, vscode.ConfigurationTarget.Global);
      } else if (targetKey && (targetKey.includes("claude") || targetKey.includes("opus"))) {
        await config.update("prewarmModeClaude", validMode, vscode.ConfigurationTarget.Global);
      } else if (targetKey && (targetKey.includes("codex") || targetKey.includes("chatgpt"))) {
        await config.update("prewarmModeChatGPT", validMode, vscode.ConfigurationTarget.Global);
      } else {
        await config.update("prewarmMode", validMode, vscode.ConfigurationTarget.Global);
        await config.update("prewarmModeGemini", validMode, vscode.ConfigurationTarget.Global);
        await config.update("prewarmModeClaude", validMode, vscode.ConfigurationTarget.Global);
        await config.update("prewarmModeChatGPT", validMode, vscode.ConfigurationTarget.Global);
      }
    } catch (err) {
      this.output.appendLine(`[prewarm] Notice: Settings persistence for prewarmMode: ${this.errorMessage(err)}`);
    }
  }

  private async checkAutoPrewarm(status: TokenStatus | undefined): Promise<void> {
    if (!status) return;

    const targets = ["antigravity", "opus", "codex"];
    for (const target of targets) {
      const targetMode = this.currentPrewarmModes[target] || "click";
      if (targetMode === "click") {
        continue;
      }

      const check = this.getPrewarmEligibility(target, status);
      if (check.eligible) {
        this.output.appendLine(`[prewarm] Auto-triggering pre-warm in mode '${targetMode}' for ${check.label}`);
        await this.handlePrewarm(target);

        if (targetMode === "once") {
          this.output.appendLine(`[prewarm] 'Once Pre-warm' executed for ${check.label}. Reverting target mode to 'click'.`);
          await this.setPrewarmMode("click", target);
          void vscode.window.showInformationMessage(
            `[Integrated Power] Once Pre-warm executed for ${check.label}. Mode returned to 'Click to Pre-warm'.`
          );
        }
        break; // Arm at most one target per 5s check cycle
      }
    }
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
