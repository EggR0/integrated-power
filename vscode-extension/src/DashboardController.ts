import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { randomUUID } from "crypto";
import { DashboardOutboundMessage, DashboardState, RunSummary, WebviewToExtensionMessage, TokenStatus, LocalLlmMetric, PrewarmMode, BrokerDashboardState } from "./types";
import { RunStore } from "./RunStore";
import { TokenManager, getLowestCodexModel, getLowestAgyModel } from "./TokenManager";
import { WorkspacePaths } from "./WorkspacePaths";
import { resolveIntegratedPowerStateRoot } from "./storagePath";
import { detectRefilledQuotaWindows } from "./quotaNotifications";
import { BrokerController } from "./BrokerController";
import { ApprovalRequest, TaskEnvelope } from "./broker/protocol";
import { WorkspaceScope } from "./broker/client";
import type { QuotaSettings } from "./broker/quotaSettingsStore";

type PostMessage = (message: DashboardOutboundMessage) => void;

const QUOTA_NOTIFICATION_KEYS = [
  "antigravityGemini5h",
  "antigravityGeminiWeekly",
  "antigravityClaude5h",
  "antigravityClaudeWeekly",
  "chatgpt5h",
  "chatgptWeekly",
  "claude5h",
  "claudeWeekly",
] as const;

/**
 * DashboardController
 *
 * Core coordinator between the Webview UI, local TokenManager, RunStore,
 * and the background Integrated Power Broker.
 *
 * Primary Responsibilities:
 * 1. Webview ↔ Extension PostMessage Protocol:
 *    - Bidirectional message dispatching and typed message handling.
 * 2. State Aggregation & Synchronization:
 *    - Merges local token status, runs history, work queue tasks, and broker approvals.
 * 3. Prewarm & Quota Automation:
 *    - Arbitrates per-target 5-hour quota prewarming and refill notification dispatch.
 * 4. Task Queue Lifecycle & AI Tag Classification:
 *    - Manages task creation, classification delegation, and platform routing.
 */
export class DashboardController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watchers: vscode.Disposable[] = [];
  private readonly output = vscode.window.createOutputChannel("Integrated Power Agent Runs");
  private readonly runStore = new RunStore();
  private readonly tokenManager = new TokenManager();
  private readonly paths: WorkspacePaths;
  private readonly brokerState: BrokerDashboardState = { workspaceName: "Current workspace", tasks: [], approvals: [], loading: true };
  private readonly brokerTasks = new Map<string, TaskEnvelope>();
  private readonly brokerApprovals = new Map<string, ApprovalRequest>();
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
  private quotaSettingsRevision?: number;
  private sharedQuotaSettingsReady = false;
  private sharedQuotaSettingsCapabilityKnown = false;
  private sharedQuotaSettingsSupported = false;
  private brokerStartupFailed = false;
  private syncedQuotaSettingsFingerprint = "";
  private applyingQuotaSettings = false;
  private quotaSettingsRefresh?: Promise<void>;
  private quotaSettingsRetryAt = 0;
  private isTokenRefreshing = false;
  private state: DashboardState = this.emptyState();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly postMessage: PostMessage,
    private readonly brokerController?: BrokerController,
  ) {
    this.paths = new WorkspacePaths(context);
    this.disposables.push(this.output);
    const cachedTokenStatus = this.loadCachedTokenStatus();
    if (cachedTokenStatus) {
      this.state.tokenStatus = cachedTokenStatus;
      this.state.isTokenLoading = false;
    }
    this.currentPrewarmModes = this.loadPrewarmModesFromConfig();
    this.currentPrewarmMode = this.currentPrewarmModes.antigravity;
    this.state.prewarmMode = this.currentPrewarmMode;
    this.state.prewarmModes = { ...this.currentPrewarmModes };
    this.resetWatchers();
    void this.refreshQuotaSettings();

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
          if (e.affectsConfiguration("integratedPower.quota.pollInterval")) {
            this.restartTokenPolling();
          }
        }
        if (e.affectsConfiguration("integratedPower.notifications")) {
          if (!this.applyingQuotaSettings) void this.persistLocalQuotaSettings();
        }
        if (e.affectsConfiguration("integratedPower.quota") && !this.applyingQuotaSettings) {
          void this.persistLocalQuotaSettings();
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
        this.postBrokerState();
        void this.refreshQuotaSettings(true);
        void this.refreshBrokerControls();
        void this.refresh();
        return;
      case "refresh":
        void this.refresh(true);
        void this.refreshBrokerControls();
        return;
      case "refreshBroker":
        await this.refreshBrokerControls();
        return;
      case "createBrokerTask":
        await this.createBrokerTask(message.title, message.goal, message.originProvider, message.tags, message.recommendedProvider, message.rawInput);
        return;
      case "requestClassifyMenu":
        await this.requestClassifyMenu(message.taskId, message.expectedRevision);
        return;
      case "classifyBrokerTask":
        await this.classifyBrokerTask(message.taskId, message.expectedRevision, message.provider, message.mode);
        return;
      case "delegateBrokerTask":
        await this.delegateBrokerTask(message.taskId, message.expectedRevision, message.provider, message.prompt);
        return;
      case "cancelBrokerTask":
        await this.cancelBrokerTask(message.taskId, message.expectedRevision);
        return;
      case "resolveBrokerApproval":
        await this.resolveBrokerApproval(message.approvalId, message.expectedRevision, message.action);
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
        const prewarmPayload = message as { model?: string; window?: "5h" | "weekly" };
        await this.handlePrewarm(prewarmPayload.model, prewarmPayload.window || "5h", true);
        return;
      case "setPrewarmMode":
        const prewarmMsg = message as { mode: PrewarmMode; target?: string };
        await this.setPrewarmMode(prewarmMsg.mode, prewarmMsg.target);
        return;
    }
  }

  private brokerScope(): WorkspaceScope {
    const folder = this.paths.primaryFolder;
    if (!folder) throw new Error("Open a workspace before using broker tasks.");
    return { workspacePath: folder.uri.fsPath };
  }

  public async refreshBrokerControls(): Promise<void> {
    if (this.brokerController && typeof this.brokerController.getPort === "function") {
      const port = this.brokerController.getPort();
      if (!port) {
        this.brokerState.loading = true;
        this.brokerState.error = undefined;
        this.postMessage({ type: "brokerLoading" });
        return;
      }
    }
    this.brokerState.loading = true;
    this.brokerState.error = undefined;
    this.postMessage({ type: "brokerLoading" });
    try {
      const scope = this.brokerScope();
      this.brokerState.workspaceName = this.paths.workspaceName;
      const client = this.getBrokerClient();
      const [taskResult, approvalResult] = await Promise.all([
        client.listTasks(scope),
        client.listApprovals(scope),
      ]);
      if (!taskResult.ok || taskResult.errors.length || !approvalResult.ok || approvalResult.errors.length) {
        throw new Error([...taskResult.errors, ...approvalResult.errors].filter(Boolean).join("; ") || "Broker workspace data is unavailable.");
      }
      this.brokerState.tasks = taskResult.tasks;
      this.brokerState.approvals = approvalResult.approvals;
      this.brokerTasks.clear();
      this.brokerApprovals.clear();
      for (const task of taskResult.tasks) this.brokerTasks.set(task.id, task);
      for (const approval of approvalResult.approvals) this.brokerApprovals.set(approval.id, approval);

      const lcs = this.state.tokenStatus?.localComputeStatus;
      let localOnline = Boolean(
        (lcs && lcs.endpointHealth === "online") ||
        (lcs?.loadedModels && lcs.loadedModels.length > 0) ||
        (this.state.tokenStatus?.llmStatus === "online" || this.state.tokenStatus?.llmStatus === "active"),
      );
      const codexCli = this.tokenManager.findCodexCli();
      let codexOnline = Boolean(
        codexCli &&
        this.state.tokenStatus?.codexStatus !== "offline" &&
        (this.state.tokenStatus?.codexStatus === "online" || this.state.tokenStatus?.codexPercentage !== undefined),
      );
      let antigravityOnline = Boolean(
        process.env.ANTIGRAVITY_APP_DIR ||
        process.env.VSCODE_PID ||
        (process.platform === "win32" && process.env.LOCALAPPDATA && fs.existsSync(path.join(process.env.LOCALAPPDATA, "Programs", "Antigravity IDE", "bin", "antigravity-ide.cmd"))),
      );

      let localReason = localOnline ? undefined : "Local LLM 서버(Ollama/vLLM)가 오프라인입니다.";
      let codexReason = codexOnline ? undefined : (codexCli ? "Codex 서비스가 오프라인입니다." : "Codex CLI가 설치되어 있지 않거나 PATH에 없습니다.");
      let antigravityReason = antigravityOnline ? undefined : "Antigravity IDE 또는 agy CLI가 설치되어 있지 않습니다.";

      try {
        const caps = await client.listCapabilities();
        const codexCap = caps.find((c) => c.provider === "openai.codex.app");
        const agyCap = caps.find((c) => c.provider === "google.antigravity.ide");
        const localCap = caps.find((c) => c.provider === "local.openai-compatible");
        if (codexCap) {
          codexOnline = codexCap.available && codexOnline;
          if (!codexCap.available) codexReason = codexCap.reason || codexReason;
        }
        if (agyCap) {
          antigravityOnline = agyCap.available || antigravityOnline;
          if (!antigravityOnline) antigravityReason = agyCap.reason || antigravityReason;
        }
        if (localCap) {
          localOnline = localCap.available && localOnline;
          if (!localCap.available) localReason = localCap.reason || localReason;
        }
      } catch {}

      this.brokerState.platforms = {
        localOnline,
        codexOnline,
        antigravityOnline,
        localReason,
        codexReason,
        antigravityReason,
      };
    } catch (error) {
      this.brokerState.error = this.errorMessage(error);
      this.brokerState.tasks = [];
      this.brokerState.approvals = [];
      this.brokerTasks.clear();
      this.brokerApprovals.clear();
    } finally {
      this.brokerState.loading = false;
      this.postMessage({ type: "brokerState", state: { ...this.brokerState } });
    }
  }

  public postBrokerState(): void {
    this.postMessage({ type: "brokerState", state: { ...this.brokerState } });
  }

  private async runBrokerAction(action: () => Promise<void>): Promise<void> {
    this.brokerState.busy = true;
    this.brokerState.error = undefined;
    this.postMessage({ type: "brokerLoading", busy: true });
    let actionError: string | undefined;
    try {
      await action();
    } catch (error) {
      actionError = this.errorMessage(error);
    }
    this.brokerState.busy = false;
    await this.refreshBrokerControls();
    if (actionError) {
      this.brokerState.error = actionError;
      this.postMessage({ type: "brokerState", state: { ...this.brokerState } });
    }
  }

  public async createBrokerTask(
    title: string,
    goal: string,
    originProvider: import("./broker/protocol").ProviderId,
    tags?: string[],
    recommendedProvider?: import("./broker/protocol").ProviderId,
    rawInput?: string,
  ): Promise<void> {
    await this.runBrokerAction(async () => {
      const scope = this.brokerScope();
      await this.getBrokerClient().createTask({
        title: title.trim(),
        goal: goal.trim(),
        originProvider,
        tags,
        recommendedProvider,
        rawInput,
        workspacePath: scope.workspacePath,
        idempotencyKey: randomUUID(),
      });
    });
  }

  public async createTaskFromRawInput(rawInput: string): Promise<void> {
    const trimmed = rawInput.trim();
    if (!trimmed) return;
    const title = trimmed.length > 50 ? trimmed.slice(0, 47) + "..." : trimmed;
    await this.createBrokerTask(title, trimmed, "local.openai-compatible", undefined, undefined, trimmed);
  }

  public async requestClassifyMenu(taskId: string, expectedRevision: number): Promise<void> {
    const task = this.brokerTasks.get(taskId);
    if (!task) return;

    const platforms = this.brokerState.platforms;
    const localOnline = Boolean(platforms?.localOnline);
    const codexOnline = Boolean(platforms?.codexOnline);
    const antigravityOnline = Boolean(platforms?.antigravityOnline);

    interface ClassifyQuickPickItem extends vscode.QuickPickItem {
      mode: "offline" | "agent";
      provider?: import("./broker/protocol").ProviderId;
      terminalRegex?: RegExp;
      terminalName?: string;
      online?: boolean;
      offlineReason?: string;
    }

    const items: ClassifyQuickPickItem[] = [
      {
        label: "$(zap) ⚡ 오프라인 빠른 분류 (추천)",
        description: "토큰 소모 없음 (지연 시간 0ms)",
        detail: "단어 및 기존 태그 풀 매칭으로 안전하게 즉시 태그/추천 분류를 적용합니다.",
        mode: "offline",
        online: true,
      },
      {
        label: `$(globe) 🌐 Antigravity ${antigravityOnline ? "" : "(미설치/오프라인)"}`,
        description: antigravityOnline ? "Gemini 3.6 Flash Low-Tier" : "사용 불가",
        detail: antigravityOnline
          ? "Antigravity 에이전트를 통해 최저가 플래시 모델로 지능형 태그 분류를 수행합니다."
          : (platforms?.antigravityReason || "Antigravity IDE 또는 CLI가 감지되지 않았습니다."),
        mode: "agent",
        provider: "google.antigravity.ide",
        online: antigravityOnline,
        offlineReason: platforms?.antigravityReason,
      },
      {
        label: `$(hubot) 🤖 Codex ${codexOnline ? "" : "(미설치/오프라인)"}`,
        description: codexOnline ? "GPT-6 Luna Low-Tier" : "사용 불가",
        detail: codexOnline
          ? "Codex 에이전트를 통해 최저 토큰 루나 모델로 지능형 태그 분류를 수행합니다."
          : (platforms?.codexReason || "Codex CLI가 설치되어 있지 않거나 PATH에 없습니다."),
        mode: "agent",
        provider: "openai.codex.app",
        online: codexOnline,
        offlineReason: platforms?.codexReason,
      },
      {
        label: `$(server) 💻 Local LLM ${localOnline ? "(Online)" : "(오프라인 - 서버 미실행)"}`,
        description: localOnline ? "로컬 경량 모델" : "서버 꺼짐 (사용 불가)",
        detail: localOnline
          ? "로컬 VRAM 환경에서 경량 모델로 분류 작업을 수행합니다."
          : (platforms?.localReason || "로컬 Ollama/vLLM 서버가 실행 중이지 않아 사용할 수 없습니다."),
        mode: "agent",
        provider: "local.openai-compatible",
        online: localOnline,
        offlineReason: platforms?.localReason,
      },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `[${task.title}] 작업을 어떤 플랫폼으로 분류하시겠습니까?`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!pick) return;

    if (pick.mode === "agent" && !pick.online) {
      void vscode.window.showInformationMessage(
        `선택하신 플랫폼(${pick.provider})이 설치되어 있지 않거나 오프라인 상태입니다. 토큰 소모가 없는 안전한 오프라인 빠른 분류로 자동 진행합니다.`
      );
      await this.classifyBrokerTask(taskId, expectedRevision, undefined, "offline");
      return;
    }

    await this.classifyBrokerTask(taskId, expectedRevision, pick.provider, pick.mode);
  }

  private async classifyBrokerTask(
    taskId: string,
    expectedRevision: number,
    provider?: import("./broker/protocol").ProviderId,
    mode?: "offline" | "agent",
  ): Promise<void> {
    await this.runBrokerAction(async () => {
      const task = this.requireScopedTask(taskId, expectedRevision);
      await this.getBrokerClient().classifyTask(taskId, task.revision, provider, mode, randomUUID());
    });
  }

  private async delegateBrokerTask(
    taskId: string,
    expectedRevision: number,
    provider: import("./broker/protocol").ProviderId,
    prompt: string,
  ): Promise<void> {
    await this.runBrokerAction(async () => {
      const task = this.requireScopedTask(taskId, expectedRevision);

      await this.getBrokerClient().delegateTask({
        taskId, provider, prompt: prompt.trim(), expectedRevision: task.revision, idempotencyKey: randomUUID(),
      });
    });
  }

  private async cancelBrokerTask(taskId: string, expectedRevision: number): Promise<void> {
    await this.runBrokerAction(async () => {
      const task = this.requireScopedTask(taskId, expectedRevision);
      await this.getBrokerClient().cancelTask(taskId, task.revision, randomUUID());
    });
  }

  private async resolveBrokerApproval(approvalId: string, expectedRevision: number, action: "approve" | "reject"): Promise<void> {
    await this.runBrokerAction(async () => {
      const approval = this.brokerApprovals.get(approvalId);
      if (!approval || approval.expectedRevision !== expectedRevision) {
        throw new Error("This approval is no longer in the selected workspace or has changed. Refresh and review it again.");
      }
      const client = this.getBrokerClient();
      if (action === "approve") await client.approve(approvalId, expectedRevision, randomUUID());
      else await client.reject(approvalId, expectedRevision, randomUUID());
    });
  }

  private requireScopedTask(taskId: string, expectedRevision: number): TaskEnvelope {
    const task = this.brokerTasks.get(taskId);
    if (!task || task.revision !== expectedRevision) {
      throw new Error("This task is no longer in the selected workspace or has changed. Refresh and review it again.");
    }
    return task;
  }

  private getBrokerClient() {
    if (!this.brokerController) throw new Error("Broker controls are unavailable in this dashboard instance.");
    return this.brokerController.getClient();
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

  private getPollIntervalMs(): number {
    const config = vscode.workspace.getConfiguration("integratedPower.quota");
    const seconds = config.get<number>("pollInterval", 5);
    const ms = typeof seconds === "number" ? seconds * 1000 : 5000;
    return Math.min(Math.max(Math.round(ms), 1000), 60000);
  }

  public refreshQuotaSettings(force = false): Promise<void> {
    if (this.quotaSettingsRefresh) {
      return force
        ? this.quotaSettingsRefresh.then(() => this.refreshQuotaSettings(true))
        : this.quotaSettingsRefresh;
    }
    if (!force && Date.now() < this.quotaSettingsRetryAt) return Promise.resolve();
    const refresh = this.loadQuotaSettings();
    this.quotaSettingsRefresh = refresh.finally(() => { this.quotaSettingsRefresh = undefined; });
    return this.quotaSettingsRefresh;
  }

  public useLegacyQuotaSettingsFallback(): void {
    this.brokerStartupFailed = true;
    this.sharedQuotaSettingsCapabilityKnown = true;
    this.sharedQuotaSettingsSupported = false;
    void this.checkAutoPrewarm(this.state.tokenStatus);
  }

  private async loadQuotaSettings(): Promise<void> {
    const client = this.brokerController?.getClient();
    if (!client) return;
    try {
      let result = await client.getQuotaSettings();
      if (!result.initialized && result.revision === 0) {
        result = await client.putQuotaSettings({
          expectedRevision: 0,
          initializeFrom: "ide",
          idempotencyKey: randomUUID(),
          settings: this.readLocalQuotaSettings(),
        });
        if (result.conflict) result = await client.getQuotaSettings();
      }
      if (!result.initialized || result.revision < 0) {
        this.sharedQuotaSettingsCapabilityKnown = true;
        this.sharedQuotaSettingsSupported = true;
        this.sharedQuotaSettingsReady = false;
        return;
      }
      this.sharedQuotaSettingsCapabilityKnown = true;
      this.sharedQuotaSettingsSupported = true;
      this.quotaSettingsRetryAt = 0;
      await this.applyQuotaSettings(result.revision, result.settings);
    } catch (error) {
      // A legacy broker has no shared-settings capability; keep the validated IDE settings path.
      const health = this.brokerController?.getAttachedHealth?.() ?? await this.brokerController?.getClient().health().catch(() => undefined);
      this.sharedQuotaSettingsCapabilityKnown = Boolean(health);
      this.sharedQuotaSettingsSupported = Boolean(health?.capabilities?.includes("quota.settings.read"));
      this.sharedQuotaSettingsReady = false;
      this.quotaSettingsRetryAt = Date.now() + 30_000;
      this.output.appendLine(`[quota settings] Shared settings unavailable; using IDE fallback: ${this.errorMessage(error)}`);
    }
  }

  private readLocalQuotaSettings(): QuotaSettings {
    const quota = vscode.workspace.getConfiguration("integratedPower.quota");
    const notifications = vscode.workspace.getConfiguration("integratedPower.notifications");
    const legacyMode = this.normalizeMode(quota.get<string>("prewarmMode", "click"));
    const prewarmModes = {
      antigravity: this.normalizeMode(quota.get<string>("prewarmModeGemini", legacyMode)),
      opus: this.normalizeMode(quota.get<string>("prewarmModeClaude", legacyMode)),
      codex: this.normalizeMode(quota.get<string>("prewarmModeChatGPT", legacyMode)),
    };
    return {
      pollIntervalMs: this.getPollIntervalMs(),
      notifyOnFull: notifications.get<boolean>("notifyOnFullTokens", true),
      prewarmMode: prewarmModes.antigravity,
      prewarmModes,
      notifications: Object.fromEntries(QUOTA_NOTIFICATION_KEYS.map((key) => [key, notifications.get<boolean>(key, true)])),
    };
  }

  private quotaSettingsFingerprint(settings: QuotaSettings): string {
    return JSON.stringify({
      pollIntervalMs: settings.pollIntervalMs,
      notifyOnFull: settings.notifyOnFull,
      prewarmModes: settings.prewarmModes,
      notifications: Object.fromEntries(QUOTA_NOTIFICATION_KEYS.map((key) => [key, settings.notifications[key] !== false])),
    });
  }

  private async applyQuotaSettings(revision: number, settings: QuotaSettings): Promise<void> {
    this.quotaSettingsRevision = revision;
    this.sharedQuotaSettingsReady = true;
    this.syncedQuotaSettingsFingerprint = this.quotaSettingsFingerprint(settings);
    this.currentPrewarmModes = {
      antigravity: this.normalizeMode(settings.prewarmModes?.antigravity ?? settings.prewarmMode),
      opus: this.normalizeMode(settings.prewarmModes?.opus ?? settings.prewarmMode),
      codex: this.normalizeMode(settings.prewarmModes?.codex ?? settings.prewarmMode),
    };
    this.currentPrewarmMode = this.currentPrewarmModes.antigravity;
    this.state = {
      ...this.state,
      prewarmMode: this.currentPrewarmMode,
      prewarmModes: { ...this.currentPrewarmModes },
    };
    this.postState();

    const current = this.readLocalQuotaSettings();
    if (this.quotaSettingsFingerprint(current) === this.syncedQuotaSettingsFingerprint) return;
    this.applyingQuotaSettings = true;
    try {
      const quota = vscode.workspace.getConfiguration("integratedPower.quota");
      const notifications = vscode.workspace.getConfiguration("integratedPower.notifications");
      const pollInterval = Math.min(60, Math.max(1, Math.round(settings.pollIntervalMs / 1000)));
      if (current.pollIntervalMs !== pollInterval * 1000) await quota.update("pollInterval", pollInterval, vscode.ConfigurationTarget.Global);
      if (current.prewarmMode !== settings.prewarmMode) await quota.update("prewarmMode", settings.prewarmMode, vscode.ConfigurationTarget.Global);
      if (current.prewarmModes.antigravity !== settings.prewarmModes.antigravity) await quota.update("prewarmModeGemini", settings.prewarmModes.antigravity, vscode.ConfigurationTarget.Global);
      if (current.prewarmModes.opus !== settings.prewarmModes.opus) await quota.update("prewarmModeClaude", settings.prewarmModes.opus, vscode.ConfigurationTarget.Global);
      if (current.prewarmModes.codex !== settings.prewarmModes.codex) await quota.update("prewarmModeChatGPT", settings.prewarmModes.codex, vscode.ConfigurationTarget.Global);
      if (current.notifyOnFull !== settings.notifyOnFull) await notifications.update("notifyOnFullTokens", settings.notifyOnFull, vscode.ConfigurationTarget.Global);
      for (const key of QUOTA_NOTIFICATION_KEYS) {
        if (current.notifications[key] !== settings.notifications[key]) {
          await notifications.update(key, settings.notifications[key], vscode.ConfigurationTarget.Global);
        }
      }
    } finally {
      this.applyingQuotaSettings = false;
    }
    this.restartTokenPolling();
  }

  private async persistLocalQuotaSettings(): Promise<void> {
    if (!this.brokerController || !this.sharedQuotaSettingsReady || this.applyingQuotaSettings || this.quotaSettingsRevision === undefined) return;
    const settings = this.readLocalQuotaSettings();
    if (this.quotaSettingsFingerprint(settings) === this.syncedQuotaSettingsFingerprint) return;
    await this.writeSharedQuotaSettings(settings);
  }

  private async writeSharedQuotaSettings(settings: QuotaSettings): Promise<boolean> {
    if (!this.brokerController || this.quotaSettingsRevision === undefined) return false;
    try {
      const result = await this.brokerController.getClient().putQuotaSettings({
        expectedRevision: this.quotaSettingsRevision,
        idempotencyKey: randomUUID(),
        settings,
      });
      if (result.conflict) {
        await this.applyQuotaSettings(result.revision, result.settings);
        return false;
      }
      if (!result.ok || !result.initialized) {
        this.output.appendLine(`[quota settings] Shared settings save failed: ${result.errors.join("; ")}`);
        return false;
      }
      await this.applyQuotaSettings(result.revision, result.settings);
      return true;
    } catch (error) {
      this.output.appendLine(`[quota settings] Shared settings save failed: ${this.errorMessage(error)}`);
      return false;
    }
  }

  private restartTokenPolling(): void {
    this.stopTokenPolling(false);
    this.startTokenPolling();
  }

  private startTokenPolling(): void {
    if (this.tokenPollingTimer) {
      return;
    }

    const interval = this.getPollIntervalMs();
    this.tokenPollingTimer = setInterval(async () => {
      if (this.isRefreshing || this.isTokenRefreshing) {
        return;
      }
      void this.refreshQuotaSettings();
      const pollGeneration = ++this.tokenRefreshGeneration;
      try {
        await this.refreshTokenStatus(pollGeneration, false);
      } catch {
        // Silent periodic background refresh
      }
    }, interval);
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

    if (!resolvedTokenStatus || !this.hasUsableTokenStatus(resolvedTokenStatus)) {
      resolvedTokenStatus = this.loadCachedTokenStatus();
    }

    const hasUsable = this.hasUsableTokenStatus(resolvedTokenStatus);
    if (!hasUsable) {
      resolvedTokenStatus = undefined;
    }

    const backgroundJobErrors = runs
      .filter((run) => run.status === "error" || run.status === "failed" || (run.exitCode !== undefined && run.exitCode !== 0))
      .map((run) => `Run failed: ${run.title} (ID: ${run.id})`);

    const nonPartialTokenErrors = (resolvedTokenStatus?.errors || []).filter(
      (err) => !err.includes("scan was partial"),
    );

    const combinedSystemErrors = Array.from(new Set([
      ...(this.state.systemErrors || []).filter((err) => !err.includes("scan was partial")),
      ...nonPartialTokenErrors,
      ...backgroundJobErrors,
    ])).slice(0, 10);

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
      isTokenLoading: !hasUsable,
      isStale: false,
      refreshStartedAt: this.state.refreshStartedAt,
      updatedAt: new Date().toISOString(),
      viewConfig: this.getViewConfig(),
      prewarmMode: this.currentPrewarmMode,
      prewarmModes: { ...this.currentPrewarmModes },
    };
  }

  private async refreshTokenStatus(generation: number, force: boolean = false): Promise<void> {
    if (this.isTokenRefreshing && !force) return;
    this.isTokenRefreshing = true;
    try {
      const tokenStatus = await this.tokenManager.getStatus(this.paths.tokenReportUri(), {
        refreshQuota: true,
        forceRefresh: force,
      });

      const previousTokenStatus = this.state.tokenStatus;
      const safeTokenStatus: TokenStatus | undefined = this.mergeTokenStatus(previousTokenStatus, tokenStatus);

      if (safeTokenStatus) {
        void this.checkFullTokenNotification(previousTokenStatus, safeTokenStatus);
        this.persistTokenStatusCache(safeTokenStatus);
      }

      this.state = {
        ...this.state,
        tokenStatus: safeTokenStatus ?? this.state.tokenStatus,
        isTokenLoading: false,
        refreshStartedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      this.postState();
      if (safeTokenStatus) {
        void this.checkAutoPrewarm(safeTokenStatus);
      }
    } catch (error) {
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
    } finally {
      this.isTokenRefreshing = false;
    }
  }

  private async checkFullTokenNotification(
    previous: TokenStatus | undefined,
    current: TokenStatus | undefined,
  ): Promise<void> {
    if (!current) return;

    if (this.brokerStartupFailed) {
      this.notifyFromLegacyQuotaState(previous, current);
      return;
    }

    const client = this.brokerController?.getClient();
    if (client) {
      let health;
      try {
        health = await client.health();
      } catch (error) {
        // A running broker may own cross-client deduplication. If its health is
        // unavailable, fail closed rather than emitting a duplicate locally.
        this.output.appendLine(`[quota notifications] Broker capability check failed: ${this.errorMessage(error)}`);
        return;
      }
      if (health.capabilities?.includes("quota.notifications.claim")) {
        try {
          const result = await client.claimQuotaRefillNotifications();
          if (!result.ok || result.errors.length > 0) {
            this.output.appendLine(`[quota notifications] Shared claim failed: ${result.errors.join("; ") || "broker returned an unsuccessful claim"}`);
            return;
          }
          for (const item of result.notifications) {
            void vscode.window.showInformationMessage(
              `${item.title}: ${item.message}`,
            );
          }
        } catch (error) {
          this.output.appendLine(`[quota notifications] Shared claim request failed: ${this.errorMessage(error)}`);
        }
        return;
      }
    }

    this.notifyFromLegacyQuotaState(previous, current);
  }

  private notifyFromLegacyQuotaState(
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

  private sanitizeResetTime(
    resetTime: string | undefined,
    _percentage: number | undefined,
    _is5Hour: boolean,
  ): string | undefined {
    if (!resetTime) return undefined;
    const time = new Date(resetTime).getTime();
    if (!Number.isFinite(time) || time <= Date.now()) {
      return undefined;
    }
    // Future reset time is a genuine active recharge cycle and must be preserved
    return resetTime;
  }

  private loadCachedTokenStatus(): TokenStatus | undefined {
    try {
      const stateRoot = resolveIntegratedPowerStateRoot();
      const cachePath = path.join(stateRoot, "token_status.json");
      if (fs.existsSync(cachePath)) {
        const raw = fs.readFileSync(cachePath, "utf8");
        const parsed = JSON.parse(raw);
        if (this.hasUsableTokenStatus(parsed)) {
          return parsed;
        }
      }
    } catch {
      // Ignore cache read errors
    }
    return undefined;
  }

  private mergeTokenStatus(
    previous: TokenStatus | undefined,
    current: TokenStatus | undefined,
  ): TokenStatus | undefined {
    if (!previous) return current;
    if (!current) return previous;

    const antigravityPct = current.antigravityPercentage;
    const antigravityReset = antigravityPct !== undefined
      ? this.sanitizeResetTime(current.antigravityResetTime, antigravityPct, true)
      : undefined;

    const antigravityWeeklyPct = current.antigravityWeeklyPercentage;
    const antigravityWeeklyReset = antigravityWeeklyPct !== undefined
      ? this.sanitizeResetTime(current.antigravityWeeklyResetTime, antigravityWeeklyPct, false)
      : undefined;

    const opusPct = current.opusPercentage;
    const opusReset = opusPct !== undefined
      ? this.sanitizeResetTime(current.opusResetTime, opusPct, true)
      : undefined;

    const opusWeeklyPct = current.opusWeeklyPercentage;
    const opusWeeklyReset = opusWeeklyPct !== undefined
      ? this.sanitizeResetTime(current.opusWeeklyResetTime, opusWeeklyPct, false)
      : undefined;

    const codexPct = current.codexPercentage;
    const codexReset = codexPct !== undefined
      ? this.sanitizeResetTime(current.codexResetTime, codexPct, true)
      : undefined;

    const codexWeeklyPct = current.codexWeeklyPercentage;
    const codexWeeklyReset = codexWeeklyPct !== undefined
      ? this.sanitizeResetTime(current.codexWeeklyResetTime, codexWeeklyPct, false)
      : undefined;

    return {
      ...previous,
      ...current,
      antigravityPercentage: antigravityPct,
      antigravityResetTime: antigravityReset,
      antigravityEstimatedAbsolute: antigravityPct !== undefined ? current.antigravityEstimatedAbsolute : undefined,
      antigravityTokensLeft: antigravityPct !== undefined ? current.antigravityTokensLeft : undefined,
      antigravityMax: antigravityPct !== undefined ? current.antigravityMax : undefined,

      antigravityWeeklyPercentage: antigravityWeeklyPct,
      antigravityWeeklyResetTime: antigravityWeeklyReset,
      antigravityWeeklyTokensLeft: antigravityWeeklyPct !== undefined ? current.antigravityWeeklyTokensLeft : undefined,
      antigravityWeeklyMax: antigravityWeeklyPct !== undefined ? current.antigravityWeeklyMax : undefined,

      opusPercentage: opusPct,
      opusResetTime: opusReset,
      opusEstimatedAbsolute: opusPct !== undefined ? current.opusEstimatedAbsolute : undefined,
      opusTokensLeft: opusPct !== undefined ? current.opusTokensLeft : undefined,
      opusMax: opusPct !== undefined ? current.opusMax : undefined,

      opusWeeklyPercentage: opusWeeklyPct,
      opusWeeklyResetTime: opusWeeklyReset,
      opusWeeklyEstimatedAbsolute: opusWeeklyPct !== undefined ? current.opusWeeklyEstimatedAbsolute : undefined,
      opusWeeklyTokensLeft: opusWeeklyPct !== undefined ? current.opusWeeklyTokensLeft : undefined,
      opusWeeklyMax: opusWeeklyPct !== undefined ? current.opusWeeklyMax : undefined,

      codexPercentage: codexPct,
      codexResetTime: codexReset,
      codexEstimatedAbsolute: codexPct !== undefined ? current.codexEstimatedAbsolute : undefined,
      codexTokensLeft: codexPct !== undefined ? current.codexTokensLeft : undefined,
      codexMax: codexPct !== undefined ? current.codexMax : undefined,

      codexWeeklyPercentage: codexWeeklyPct,
      codexWeeklyResetTime: codexWeeklyReset,
      codexWeeklyEstimatedAbsolute: codexWeeklyPct !== undefined ? current.codexWeeklyEstimatedAbsolute : undefined,
      codexWeeklyTokensLeft: codexWeeklyPct !== undefined ? current.codexWeeklyTokensLeft : undefined,
      codexWeeklyMax: codexWeeklyPct !== undefined ? current.codexWeeklyMax : undefined,

      claudeDirectUsage: current.claudeDirectUsage ?? previous.claudeDirectUsage,
      localComputeStatus: current.localComputeStatus ?? previous.localComputeStatus,
      quotaPools: (current.quotaPools && current.quotaPools.length > 0) ? current.quotaPools : previous.quotaPools,
      codexStatus: current.codexStatus ?? previous.codexStatus ?? "offline",
      llmStatus: current.llmStatus ?? previous.llmStatus ?? "offline",
      recommendedTaskWeight: current.recommendedTaskWeight ?? previous.recommendedTaskWeight ?? "unknown",
      activity: (current.activity && current.activity.length > 0) ? current.activity : previous.activity ?? [],
      errors: current.errors ?? previous.errors,
    };
  }

  private hasUsableTokenStatus(status: TokenStatus | undefined): boolean {
    if (!status) {
      return false;
    }

    const exactPercentages = [
      status.antigravityPercentage,
      status.antigravityWeeklyPercentage,
      status.opusPercentage,
      status.opusWeeklyPercentage,
      status.codexPercentage,
      status.codexWeeklyPercentage,
    ];
    if (exactPercentages.some((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100)) {
      return true;
    }
    return [
      status.antigravityEstimatedAbsolute,
      status.opusEstimatedAbsolute,
      status.codexEstimatedAbsolute,
      status.opusWeeklyEstimatedAbsolute,
      status.codexWeeklyEstimatedAbsolute,
    ].some((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
      || [[status.antigravityTokensLeft, status.antigravityMax], [status.antigravityWeeklyTokensLeft, status.antigravityWeeklyMax],
        [status.opusTokensLeft, status.opusMax], [status.opusWeeklyTokensLeft, status.opusWeeklyMax],
        [status.codexTokensLeft, status.codexMax], [status.codexWeeklyTokensLeft, status.codexWeeklyMax]]
        .some(([left, max]) => typeof left === "number" && Number.isFinite(left) && left >= 0 && typeof max === "number" && Number.isFinite(max) && max > 0);
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
      typed.type === "refreshBroker" ||
      typed.type === "configureViews" ||
      typed.type === "openConfigurationCenter" ||
      typed.type === "openRunsFile" ||
      typed.type === "prewarm" ||
      typed.type === "setPrewarmMode"
    ) {
      return true;
    }

    const input = message as Record<string, unknown>;
    const knownProvider = (value: unknown): value is import("./broker/protocol").ProviderId =>
      value === "local.openai-compatible" || value === "openai.codex.app" || value === "google.antigravity.ide";
    if (input.type === "createBrokerTask") {
      return typeof input.title === "string" && input.title.trim().length > 0 && input.title.length <= 120
        && typeof input.goal === "string" && input.goal.trim().length > 0 && input.goal.length <= 12000
        && knownProvider(input.originProvider);
    }
    if (input.type === "requestClassifyMenu") {
      return typeof input.taskId === "string" && input.taskId.length > 0
        && typeof input.expectedRevision === "number" && Number.isInteger(input.expectedRevision);
    }
    if (input.type === "classifyBrokerTask") {
      return typeof input.taskId === "string" && input.taskId.length > 0
        && typeof input.expectedRevision === "number" && Number.isInteger(input.expectedRevision)
        && (input.provider === undefined || knownProvider(input.provider))
        && (input.mode === undefined || input.mode === "offline" || input.mode === "agent");
    }
    if (input.type === "delegateBrokerTask") {
      return typeof input.taskId === "string" && input.taskId.length > 0
        && typeof input.expectedRevision === "number" && Number.isInteger(input.expectedRevision) && knownProvider(input.provider)
        && typeof input.prompt === "string" && input.prompt.trim().length > 0 && input.prompt.length <= 12000;
    }
    if (input.type === "cancelBrokerTask") {
      return typeof input.taskId === "string" && input.taskId.length > 0
        && typeof input.expectedRevision === "number" && Number.isInteger(input.expectedRevision);
    }
    if (input.type === "resolveBrokerApproval") {
      return typeof input.approvalId === "string" && input.approvalId.length > 0
        && typeof input.expectedRevision === "number" && Number.isInteger(input.expectedRevision)
        && (input.action === "approve" || input.action === "reject");
    }

    return typed.type === "openArtifact" && typeof typed.artifactId === "string" && typed.artifactId.length > 0;
  }

  private getPrewarmEligibility(
    modelKey?: string,
    windowType: "5h" | "weekly" = "5h",
    status?: TokenStatus,
    isManual = false
  ): { eligible: boolean; reason: string; prefix: string; targetModel: string; cliModel: string; label: string } {
    const raw = (modelKey || "antigravity").toLowerCase();
    let prefix = "antigravity";
    let weeklyPrefix = "antigravityWeekly";
    const agyGemini = getLowestAgyModel("gemini");
    let targetModel = agyGemini.model;
    let cliModel = agyGemini.displayName;
    let label = windowType === "weekly" ? "Gemini Weekly" : "Gemini 5Hours";

    if (raw.includes("opus") || raw.includes("claude")) {
      prefix = "opus";
      weeklyPrefix = "opusWeekly";
      const agyClaude = getLowestAgyModel("claude");
      targetModel = agyClaude.model;
      cliModel = agyClaude.displayName;
      label = windowType === "weekly" ? "Claude Weekly" : "Claude 5Hours";
    } else if (raw.includes("codex") || raw.includes("chatgpt")) {
      prefix = "codex";
      weeklyPrefix = "codexWeekly";
      targetModel = getLowestCodexModel().model;
      cliModel = targetModel;
      label = windowType === "weekly" ? "ChatGPT Weekly" : "ChatGPT 5Hours";
    }

    if (!status) {
      return { eligible: false, reason: "No quota telemetry data available yet", prefix, targetModel, cliModel, label };
    }

    // Check provider online status
    if (prefix === "codex" && (status.codexStatus === "offline" || status.codexStatus === "unauthenticated")) {
      return { eligible: false, reason: "ChatGPT / Codex provider is offline", prefix, targetModel, cliModel, label };
    }

    const fallbackTimestamp = (status as any).updatedAt ?? (status as any).lastSync ?? "";

    if (windowType === "5h") {
      // Check 5-hour percentage
      const fiveHPct = typeof (status as any)[`${prefix}Percentage`] === "number"
        ? Number((status as any)[`${prefix}Percentage`])
        : 0;
      if (fiveHPct < 99.95) {
        return { eligible: false, reason: `${label} quota is not 100% full (${fiveHPct.toFixed(1)}% remaining). Pre-warm only operates on 100% Ready windows.`, prefix, targetModel, cliModel, label };
      }

      // Check if 5-hour time window is full (not actively counting down)
      const resetTimeStr = (status as any)[`${prefix}ResetTime`];
      const resetEpoch = resetTimeStr ? Date.parse(resetTimeStr) : NaN;
      const diffMs = Number.isFinite(resetEpoch) ? resetEpoch - Date.now() : undefined;
      if (diffMs !== undefined && diffMs > 0 && diffMs < 5 * 3600 * 1000 - 15 * 60 * 1000) {
        const waitMin = Math.ceil(diffMs / 60000);
        return { eligible: false, reason: `${label} 5시간 타이머가 이미 시작되어 재충전 중입니다 (${waitMin}분 남음). 5시간이 꽉 차 있을 때만 실행할 수 있습니다.`, prefix, targetModel, cliModel, label };
      }

      // Check weekly quota exhaustion only (do not require weekly data freshness for 5h prewarm)
      const weeklyPct = typeof (status as any)[`${weeklyPrefix}Percentage`] === "number"
        ? Number((status as any)[`${weeklyPrefix}Percentage`])
        : undefined;
      if (weeklyPct !== undefined && weeklyPct <= 0.05) {
        return { eligible: false, reason: `${label} weekly quota is exhausted (${weeklyPct.toFixed(1)}% remaining). All 5-hour capacity is locked.`, prefix, targetModel, cliModel, label };
      }

      const poolId = prefix === "antigravity" ? "antigravity.default" : prefix === "opus" ? "opus.default" : "codex.5h";
      const quotaPool = status.quotaPools?.find((pool) => pool.id === poolId);
      const measuredAt = Date.parse(quotaPool?.measuredAt ?? "") || Date.parse(fallbackTimestamp);
      if (Number.isFinite(measuredAt) && (Date.now() - measuredAt > 5 * 60_000 || measuredAt > Date.now() + 60_000)) {
        return { eligible: false, reason: `${label} quota data is not fresh; pre-warm requires a recent provider measurement.`, prefix, targetModel, cliModel, label };
      }
    } else {
      // windowType === "weekly"
      const weeklyPct = typeof (status as any)[`${weeklyPrefix}Percentage`] === "number"
        ? Number((status as any)[`${weeklyPrefix}Percentage`])
        : undefined;
      if (weeklyPct === undefined) {
        return { eligible: false, reason: `${label} weekly quota data unavailable.`, prefix, targetModel, cliModel, label };
      }
      if (weeklyPct < 99.95) {
        return { eligible: false, reason: `${label} quota is not 100% full (${weeklyPct.toFixed(1)}% remaining). Pre-warm only operates on 100% Ready windows.`, prefix, targetModel, cliModel, label };
      }

      // Check if weekly time window is full (not actively counting down)
      const weeklyResetTimeStr = (status as any)[`${weeklyPrefix}ResetTime`];
      const weeklyResetEpoch = weeklyResetTimeStr ? Date.parse(weeklyResetTimeStr) : NaN;
      const weeklyDiffMs = Number.isFinite(weeklyResetEpoch) ? weeklyResetEpoch - Date.now() : undefined;
      if (weeklyDiffMs !== undefined && weeklyDiffMs > 0 && weeklyDiffMs < 168 * 3600 * 1000 - 4 * 3600 * 1000) {
        const waitHours = Math.ceil(weeklyDiffMs / 3600000);
        return { eligible: false, reason: `${label} 주간 타이머가 이미 시작되어 재충전 중입니다 (${waitHours}시간 남음). 일주일(168시간)이 꽉 차 있을 때만 실행할 수 있습니다.`, prefix, targetModel, cliModel, label };
      }

      const weeklyPool = status.quotaPools?.find((pool) => pool.id === `${prefix}.weekly`);
      const measuredAt = Date.parse(weeklyPool?.measuredAt ?? "") || Date.parse(fallbackTimestamp);
      if (Number.isFinite(measuredAt) && (Date.now() - measuredAt > 5 * 60_000 || measuredAt > Date.now() + 60_000)) {
        return { eligible: false, reason: `${label} weekly quota data is not fresh; pre-warm requires a recent provider measurement.`, prefix, targetModel, cliModel, label };
      }
    }

    const targetKey = `${prefix}-${windowType}`;
    if (!isManual) {
      // Auto-prewarm cooldown (minimum 30 minutes to prevent repeated automated pings)
      const lastPrewarm = this.lastAutoPrewarmByTarget[targetKey] || 0;
      const elapsed = Date.now() - lastPrewarm;
      const COOLDOWN_MS = 30 * 60 * 1000;
      if (elapsed < COOLDOWN_MS) {
        const waitMin = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
        return { eligible: false, reason: `${label} was pre-warmed recently. Cooldown active (${waitMin}m remaining).`, prefix, targetModel, cliModel, label };
      }
    } else {
      // Manual click: debounce rapid accidental double-clicks (5 seconds)
      const lastPrewarm = this.lastAutoPrewarmByTarget[targetKey] || 0;
      const elapsed = Date.now() - lastPrewarm;
      if (elapsed < 5000) {
        return { eligible: false, reason: `${label} pre-warm was recently initiated. Please wait a few seconds.`, prefix, targetModel, cliModel, label };
      }
    }

    return { eligible: true, reason: "Ready", prefix, targetModel, cliModel, label };
  }

  private async handlePrewarm(modelKey?: string, windowType: "5h" | "weekly" = "5h", isManual = false): Promise<void> {
    if (this.sharedQuotaSettingsReady && this.brokerController) {
      if (!isManual) return; // Once/Always scheduling belongs to the shared broker.
      try {
        const result = await this.brokerController.getClient().prewarm({
          model: modelKey,
          window: windowType,
          manual: true,
          idempotencyKey: randomUUID(),
          expectedSettingsRevision: this.quotaSettingsRevision,
        });
        this.output.appendLine(`[prewarm] Shared broker result: ${result.status}; window: ${windowType}; timer confirmed: ${result.timerConfirmed}.`);
        if (result.status === "failed" || result.status === "skipped") {
          void vscode.window.showWarningMessage(`[Integrated Power] Pre-warm ${result.status}: ${result.error || "The broker did not dispatch the request."}`);
        } else if (result.status === "dispatched" && !result.timerConfirmed) {
          void vscode.window.showInformationMessage(`[Integrated Power] ${windowType === "weekly" ? "Weekly (168h)" : "5-hour"} pre-warm dispatch accepted; the remote timer is not confirmed yet.`);
        }
      } catch (error) {
        this.output.appendLine(`[prewarm] Shared broker request failed: ${this.errorMessage(error)}`);
        void vscode.window.showWarningMessage(`[Integrated Power] Pre-warm request failed: ${this.errorMessage(error)}`);
      }
      return;
    }

    const check = this.getPrewarmEligibility(modelKey, windowType, this.state.tokenStatus, isManual);
    if (!check.eligible) {
      this.output.appendLine(`[prewarm] Refusing pre-warm for ${check.label}: ${check.reason}`);
      if (isManual) {
        void vscode.window.showWarningMessage(`[Integrated Power] Pre-warm skipped: ${check.reason}`);
      }
      return;
    }

    this.output.appendLine(`[prewarm] ${windowType === "weekly" ? "Weekly" : "5-hour"} quota pre-warm approved for ${check.label} (100% Ready). Dispatching ping...`);
    const now = Date.now();
    this.lastAutoPrewarmByTarget[`${check.prefix}-${windowType}`] = now;

    if (check.prefix === "codex") {
      // Codex / ChatGPT: Use codex CLI with lowest verified model (e.g. gpt-6-luna), ephemeral flag, and instant abort
      const codexCli = this.tokenManager.findCodexCli();
      if (codexCli) {
        const codexLowest = getLowestCodexModel();
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
            }, 3000);

            const child = cp.spawn(
              codexCli,
              [
                "exec",
                "-m",
                codexLowest.model,
                "--skip-git-repo-check",
                "--ephemeral",
                "--ignore-rules",
                "--disable",
                "skills",
                "-c",
                `model="${codexLowest.model}"`,
                "-c",
                `model_reasoning_effort="${codexLowest.reasoningEffort}"`,
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

          this.output.appendLine(`[prewarm] codex minimal ping dispatched with instant abort (model: ${codexLowest.model}, effort: ${codexLowest.reasoningEffort})`);
        } catch (err) {
          this.output.appendLine(`[prewarm] codex execution error: ${this.errorMessage(err)}`);
        }
      }
    } else {
      // Gemini & Claude: Use agy CLI with verified lowest-tier model and print-timeout
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

            // Watchdog timer: 15 seconds to ensure agy finishes or cleanly exits without freezing UI
            const watchdog = setTimeout(() => {
              try {
                proc.kill();
              } catch {}
              finish();
            }, 15000);

            const proc = cp.spawn(
              agyBin,
              [
                "-p",
                "1",
                "--model",
                check.cliModel,
                "--disable-slash-commands",
                "--print-timeout",
                "1s",
              ],
              {
                windowsHide: true,
                stdio: ["ignore", "ignore", "ignore"],
              }
            );

            proc.on("error", (err) => {
              clearTimeout(watchdog);
              this.output.appendLine(`[prewarm] agy spawn error: ${this.errorMessage(err)}`);
              finish();
            });

            proc.on("close", () => {
              clearTimeout(watchdog);
              finish();
            });
          });

          this.output.appendLine(`[prewarm] agy minimal ping dispatched successfully (target: ${check.label}, model: ${check.cliModel})`);
        } catch (err) {
          this.output.appendLine(`[prewarm] agy execution error: ${this.errorMessage(err)}`);
        }
      } else {
        this.output.appendLine(`[prewarm] agy binary not found at ${agyBin}`);
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
          tokenStatus: this.mergeTokenStatus(this.state.tokenStatus, refreshed),
          updatedAt: new Date().toISOString(),
        };
        this.postState();
      }
    } catch (err) {
      this.output.appendLine(`[prewarm] Telemetry refresh notice: ${this.errorMessage(err)}`);
    }

    if (isManual) {
      void vscode.window.showInformationMessage(
        `[Integrated Power] Pre-warm probe dispatched for ${check.label} (model: ${check.cliModel}). Provider quota and timer state remain unconfirmed until fresh telemetry arrives.`
      );
    }
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
    const nextModes = { ...this.currentPrewarmModes };

    if (targetKey && (targetKey.includes("gemini") || targetKey.includes("antigravity"))) {
      nextModes.antigravity = validMode;
    } else if (targetKey && (targetKey.includes("claude") || targetKey.includes("opus"))) {
      nextModes.opus = validMode;
    } else if (targetKey && (targetKey.includes("codex") || targetKey.includes("chatgpt"))) {
      nextModes.codex = validMode;
    } else {
      Object.assign(nextModes, {
        antigravity: validMode,
        opus: validMode,
        codex: validMode,
      });
    }

    if (this.sharedQuotaSettingsReady) {
      const settings = this.readLocalQuotaSettings();
      settings.prewarmModes = {
        antigravity: nextModes.antigravity,
        opus: nextModes.opus,
        codex: nextModes.codex,
      };
      settings.prewarmMode = nextModes.antigravity;
      await this.writeSharedQuotaSettings(settings);
      return;
    }

    this.currentPrewarmModes = nextModes;
    this.currentPrewarmMode = this.currentPrewarmModes.antigravity;
    this.state = {
      ...this.state,
      prewarmMode: this.currentPrewarmMode,
      prewarmModes: { ...this.currentPrewarmModes },
    };
    this.postState();

    if (!this.sharedQuotaSettingsReady && (validMode === "once" || validMode === "always")) {
      void this.checkAutoPrewarm(this.state.tokenStatus);
    }

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
    if (!this.sharedQuotaSettingsCapabilityKnown || this.sharedQuotaSettingsSupported) return;
    if (!status) return;

    const targets = ["antigravity", "opus", "codex"];
    for (const target of targets) {
      const targetMode = this.currentPrewarmModes[target] || "click";
      if (targetMode === "click") {
        continue;
      }

      const check = this.getPrewarmEligibility(target, "5h", status, false);
      if (check.eligible) {
        this.output.appendLine(`[prewarm] Auto-triggering pre-warm in mode '${targetMode}' for ${check.label}`);
        await this.handlePrewarm(target, "5h", false);

        if (targetMode === "once") {
          this.output.appendLine(`[prewarm] 'Once Pre-warm' executed for ${check.label}. Reverting target mode to 'click'.`);
          await this.setPrewarmMode("click", target);
          void vscode.window.showInformationMessage(
            `[Integrated Power] Once Pre-warm executed for ${check.label}. Mode returned to 'Click to Pre-warm'.`
          );
        }
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
