import * as cp from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import type {
  ClaudeDirectUsageStatus,
  JsonObject,
  TokenStatus,
  QuotaPoolStatus,
  LocalComputeStatus,
  QuotaSource,
  UsageConfidence,
  GpuStatus,
  UsageWindowSummary,
} from "./types";
import { AgyQuotaClient, AgyNotInstalledError, AgyNotAuthenticatedError } from "./AgyQuotaClient";
import matter from "gray-matter";
import { getLowestCodexModel, findCodexCliSync, CodexModelResolution, fetchLiveCodexRateLimits, LiveCodexRateLimits } from "./broker/codexAppServer";
import { getLowestAgyModel, AgyModelResolution } from "./broker/agyModelResolver";
export { getLowestCodexModel, findCodexCliSync, CodexModelResolution, getLowestAgyModel, AgyModelResolution, fetchLiveCodexRateLimits, LiveCodexRateLimits };

const QUOTA_CACHE_TTL_MS = 5_000;
const MAX_SESSION_SCAN_DEPTH = 5;
const MAX_SESSION_FILES = 80;
const MAX_SESSION_FILE_BYTES = 256 * 1024;
const MAX_SESSION_LINES_PER_FILE = 1_000;
const AGY_CREDITS_TIMEOUT_MS = 15_000;
const CLAUDE_USAGE_SCAN_DEPTH = 5;
const CLAUDE_USAGE_MAX_FILES = 120;
const CLAUDE_USAGE_MAX_FILE_BYTES = 512 * 1024;
const CLAUDE_USAGE_MAX_LINES_PER_FILE = 2_000;

interface ExecTextOptions {
  timeoutMs?: number;
  shell?: boolean;
}

interface NodePtyProcess {
  onData(callback: (data: string) => void): { dispose(): void } | void;
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } | void;
  kill(signal?: string): void;
}

interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
      name: string;
    },
  ): NodePtyProcess;
}

interface QuotaData {
  measuredAt?: string;
  quotaPools?: QuotaPoolStatus[];
  localComputeStatus?: LocalComputeStatus;
  claudeDirectUsage?: ClaudeDirectUsageStatus;
  antigravityPercentage?: number;
  antigravityResetTime?: string;
  antigravityWeeklyPercentage?: number;
  antigravityWeeklyResetTime?: string;
  opusPercentage?: number;
  opusResetTime?: string;
  opusWeeklyPercentage?: number;
  opusWeeklyResetTime?: string;
  codexPercentage?: number;
  codexResetTime?: string;
  codexWeeklyPercentage?: number;
  codexWeeklyResetTime?: string;
  antigravityEstimatedAbsolute?: number;
  opusEstimatedAbsolute?: number;
  opusWeeklyEstimatedAbsolute?: number;
  codexEstimatedAbsolute?: number;
  codexWeeklyEstimatedAbsolute?: number;
  codexMeasuredAt?: string;
  codexWeeklyMeasuredAt?: string;
  codexSource?: QuotaSource;
  errors: string[];
}

interface JsonlFileStat {
  fullPath: string;
  mtimeMs: number;
}

interface ClaudeUsageEvent {
  timestamp: number;
  eventId?: string;
  source: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  billableTokens?: number;
}

interface StatusOptions {
  refreshQuota?: boolean;
  forceRefresh?: boolean;
}

export interface TokenFileUri {
  fsPath: string;
}

export interface TokenManagerHost {
  readFile(uri: TokenFileUri): Promise<Uint8Array>;
  notifyAgyMissing(): void | Promise<void>;
  notifyAgyAuthRequired(): void | Promise<void>;
}

function createIdeTokenManagerHost(): TokenManagerHost {
  return {
    readFile: async (uri) => {
      const vscode = await import("vscode");
      return vscode.workspace.fs.readFile(vscode.Uri.file(uri.fsPath));
    },
    notifyAgyMissing: async () => {
      const vscode = await import("vscode");
      const selection = await vscode.window.showErrorMessage(
        "Antigravity CLI (agy) is not installed. It is required for accurate quota telemetry.",
        "Install Agy CLI",
      );
      if (selection === "Install Agy CLI") {
        const terminal = vscode.window.createTerminal("Install Antigravity CLI");
        terminal.show();
        terminal.sendText("powershell -NoProfile -ExecutionPolicy Bypass -Command \"iex ((New-Object System.Net.WebClient).DownloadString('https://antigravity.google/cli/install.ps1'))\"");
      }
    },
    notifyAgyAuthRequired: async () => {
      const vscode = await import("vscode");
      const selection = await vscode.window.showErrorMessage(
        "Antigravity CLI is not authenticated. Please sign in to view accurate quota usage.",
        "Sign In",
      );
      if (selection === "Sign In") {
        const terminal = vscode.window.createTerminal("Antigravity Auth");
        terminal.show();
        terminal.sendText("& \"$env:LOCALAPPDATA\\agy\\bin\\agy.exe\" auth login");
      }
    },
  };
}

export function createHeadlessTokenManagerHost(): TokenManagerHost {
  return {
    readFile: async (uri) => fs.promises.readFile(uri.fsPath),
    notifyAgyMissing: () => {},
    notifyAgyAuthRequired: () => {},
  };
}

/**
 * TokenManager
 *
 * Central telemetry orchestrator and quota tracking manager for Integrated Power.
 *
 * Primary Responsibilities:
 * 1. Multi-Provider Quota Collection:
 *    - Google Antigravity IDE (Gemini / Claude via AgyQuotaClient & Cloud Code API)
 *    - OpenAI Codex (live rate limit probe & CLI session logs)
 *    - Anthropic Claude (direct usage logs & CLI sessions)
 *    - Local Compute (Ollama / vLLM / LM Studio models & multi-GPU VRAM metrics)
 * 2. Caching & Resilience:
 *    - 5-second in-memory TTL quota cache (QUOTA_CACHE_TTL_MS)
 *    - Circuit breaker pattern for failing external providers (30s cooldown)
 *    - Dual-mode host support: IDE mode (VS Code workspace fs) & Headless mode (Node fs)
 */
export class TokenManager {
  private readonly host: TokenManagerHost;
  private readonly agyQuotaClient: AgyQuotaClient;
  private quotaCache?: { lastFetchTime: number; data: QuotaData };
  private fetchPromise?: Promise<QuotaData>;
  private hasShownAgyMissingPrompt = false;
  private hasShownAgyAuthPrompt = false;
  private lastGpuMetrics?: GpuStatus[];
  private lastCodexLiveRefreshAt = 0;
  private readonly circuitBreakers = new Map<string, { failures: number; cooldownUntil: number }>();

  public constructor(host?: TokenManagerHost, resourceRoot = path.join(__dirname, "..")) {
    this.host = host ?? createIdeTokenManagerHost();
    this.agyQuotaClient = new AgyQuotaClient(resourceRoot);
  }

  private isCircuitOpen(providerKey: string): boolean {
    const state = this.circuitBreakers.get(providerKey);
    if (!state) {
      return false;
    }
    if (Date.now() > state.cooldownUntil) {
      return false;
    }
    return state.failures >= 3;
  }

  private recordProviderSuccess(providerKey: string): void {
    this.circuitBreakers.delete(providerKey);
  }

  private recordProviderFailure(providerKey: string): void {
    const state = this.circuitBreakers.get(providerKey) || { failures: 0, cooldownUntil: 0 };
    state.failures += 1;
    if (state.failures >= 3) {
      state.cooldownUntil = Date.now() + 30_000;
    }
    this.circuitBreakers.set(providerKey, state);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue?: T): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => fallbackValue === undefined
        ? reject(new Error(`Quota source timed out after ${timeoutMs}ms.`))
        : resolve(fallbackValue), timeoutMs);
      if (typeof timer.unref === "function") {
        timer.unref();
      }
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  public async getStatus(
    fileUri: TokenFileUri | undefined,
    options: StatusOptions = {},
  ): Promise<TokenStatus | undefined> {
    const activity: string[] = ["Token manager initialized."];
    const tokenStatus: TokenStatus = {
      codexStatus: "Idle",
      llmStatus: "Active",
      recommendedTaskWeight: "unknown",
      activity,
      errors: [],
    };

    // We no longer read agent-dashboard.md for fallback token data 
    // as it causes phantom UI values (e.g. 74%) during initial load.

    const fallbackQuota = this.quotaFromStatus(tokenStatus);
    const workspaceStateRoot = this.workspaceStateRootFromTokenReport(fileUri);
    if (options.refreshQuota === false) {
      const cachedQuota = this.getFreshCachedQuota(activity);
      if (cachedQuota) {
        this.applyQuotaData(tokenStatus, cachedQuota);
      } else if (this.fetchPromise) {
        activity.push("Quota refresh is already in progress; using dashboard fallback data.");
      }

      tokenStatus.activity = activity;
      return tokenStatus;
    }

    const quotaData = await this.getQuotaData(activity, fallbackQuota, options.forceRefresh, workspaceStateRoot);
    this.applyQuotaData(tokenStatus, quotaData);

    if (quotaData.errors.length > 0) {
      activity.push(...quotaData.errors.map((error) => `Info: ${error}`));
      tokenStatus.errors!.push(...quotaData.errors);
    }

    tokenStatus.activity = activity;
    return tokenStatus;
  }

  private async readDashboardFile(fileUri: TokenFileUri): Promise<{ data: JsonObject; content: string }> {
    const bytes = await this.host.readFile(fileUri);
    return this.parseDashboardMarkdown(Buffer.from(bytes).toString("utf8"));
  }

  private parseDashboardMarkdown(text: string): { data: JsonObject; content: string } {
    try {
      const parsed = matter(text.replace(/^\uFEFF/, ""));
      return { data: parsed.data as JsonObject, content: parsed.content };
    } catch {
      return { data: {}, content: text };
    }
  }

  private taskFromContent(content: string): string | undefined {
    const normalized = content.trim().replace(/^#+.*$/gm, "").trim();
    return normalized || undefined;
  }

  private applyFrontMatterStatus(tokenStatus: TokenStatus, data: JsonObject): void {
    const antigravityPercentage = this.percentageValue(data, [
      "antigravityRemaining",
      "antigravityPercentage",
      "antigravityPercent",
    ]);
    const antigravityEstimated = this.numberValue(data, [
      "antigravityEstimated",
      "antigravityEstimatedAbsolute",
    ]);
    const antigravityReset = this.stringValue(data, ["antigravityReset", "antigravityResetTime"]);
    const antigravityWeeklyPercentage = this.percentageValue(data, [
      "antigravityWeeklyRemaining",
      "antigravityWeeklyPercentage",
      "antigravityWeeklyPercent",
    ]);
    const antigravityWeeklyReset = this.stringValue(data, [
      "antigravityWeeklyReset",
      "antigravityWeeklyResetTime",
    ]);
    const opusPercentage = this.percentageValue(data, [
      "opusRemaining",
      "opusPercentage",
      "opusPercent",
    ]);
    const opusEstimated = this.numberValue(data, [
      "opusEstimated",
      "opusEstimatedAbsolute",
    ]);
    const opusReset = this.stringValue(data, ["opusReset", "opusResetTime"]);
    const opusWeeklyPercentage = this.percentageValue(data, [
      "opusWeeklyRemaining",
      "opusWeeklyPercentage",
      "opusWeeklyPercent",
    ]);
    const opusWeeklyReset = this.stringValue(data, [
      "opusWeeklyReset",
      "opusWeeklyResetTime",
    ]);
    const codexPercentage = this.percentageValue(data, [
      "codexRemaining",
      "codexPercentage",
      "codexPercent",
    ]);
    const codexEstimated = this.numberValue(data, ["codexEstimated", "codexEstimatedAbsolute"]);
    const codexReset = this.stringValue(data, ["codexReset", "codexResetTime"]);
    const codexWeeklyPercentage = this.percentageValue(data, [
      "codexWeeklyRemaining",
      "codexWeeklyPercentage",
      "codexWeeklyPercent",
    ]);
    const codexWeeklyEstimated = this.numberValue(data, ["codexWeeklyEstimated", "codexWeeklyEstimatedAbsolute"]);
    const codexWeeklyReset = this.stringValue(data, ["codexWeeklyReset", "codexWeeklyResetTime"]);

    const antigravityWeeklyEstimated = this.numberValue(data, ["antigravityWeeklyEstimated", "antigravityWeeklyEstimatedAbsolute"]);
    const opusWeeklyEstimated = this.numberValue(data, ["opusWeeklyEstimated", "opusWeeklyEstimatedAbsolute"]);

    if (antigravityPercentage !== undefined) {
      tokenStatus.antigravityPercentage = antigravityPercentage;
    }
    if (antigravityEstimated !== undefined) {
      tokenStatus.antigravityEstimatedAbsolute = antigravityEstimated;
    }
    if (antigravityReset !== undefined) {
      tokenStatus.antigravityResetTime = antigravityReset;
    }
    if (antigravityWeeklyPercentage !== undefined) {
      tokenStatus.antigravityWeeklyPercentage = antigravityWeeklyPercentage;
    }
    if (antigravityWeeklyEstimated !== undefined) {
    }
    if (antigravityWeeklyReset !== undefined) {
      tokenStatus.antigravityWeeklyResetTime = antigravityWeeklyReset;
    }

    if (opusPercentage !== undefined) {
      tokenStatus.opusPercentage = opusPercentage;
    }
    if (opusEstimated !== undefined) {
      tokenStatus.opusEstimatedAbsolute = opusEstimated;
    }
    if (opusReset !== undefined) {
      tokenStatus.opusResetTime = opusReset;
    }
    if (opusWeeklyPercentage !== undefined) {
      tokenStatus.opusWeeklyPercentage = opusWeeklyPercentage;
    }
    if (opusWeeklyEstimated !== undefined) {
    }
    if (opusWeeklyReset !== undefined) {
      tokenStatus.opusWeeklyResetTime = opusWeeklyReset;
    }

    if (codexPercentage !== undefined) {
      tokenStatus.codexPercentage = codexPercentage;
    }
    if (codexEstimated !== undefined) {
      tokenStatus.codexEstimatedAbsolute = codexEstimated;
    }
    if (codexReset !== undefined) {
      tokenStatus.codexResetTime = codexReset;
    }
    if (codexWeeklyPercentage !== undefined) {
      tokenStatus.codexWeeklyPercentage = codexWeeklyPercentage;
    }
    if (codexWeeklyEstimated !== undefined) {
    }
    if (codexWeeklyReset !== undefined) {
      tokenStatus.codexWeeklyResetTime = codexWeeklyReset;
    }

    tokenStatus.recommendedTaskWeight = this.taskWeightFromCodexPercentage(tokenStatus.codexPercentage, tokenStatus.codexWeeklyPercentage);
  }

  private quotaFromStatus(tokenStatus: TokenStatus): QuotaData {
    return {
      antigravityPercentage: tokenStatus.antigravityPercentage,
      antigravityResetTime: tokenStatus.antigravityResetTime,
      antigravityWeeklyPercentage: tokenStatus.antigravityWeeklyPercentage,
      antigravityWeeklyResetTime: tokenStatus.antigravityWeeklyResetTime,
      antigravityEstimatedAbsolute: tokenStatus.antigravityEstimatedAbsolute,
      opusPercentage: tokenStatus.opusPercentage,
      opusResetTime: tokenStatus.opusResetTime,
      opusWeeklyPercentage: tokenStatus.opusWeeklyPercentage,
      opusWeeklyResetTime: tokenStatus.opusWeeklyResetTime,
      opusEstimatedAbsolute: tokenStatus.opusEstimatedAbsolute,
      opusWeeklyEstimatedAbsolute: tokenStatus.opusWeeklyEstimatedAbsolute,
      codexPercentage: tokenStatus.codexPercentage,
      codexResetTime: tokenStatus.codexResetTime,
      codexWeeklyPercentage: tokenStatus.codexWeeklyPercentage,
      codexWeeklyResetTime: tokenStatus.codexWeeklyResetTime,
      codexEstimatedAbsolute: tokenStatus.codexEstimatedAbsolute,
      codexWeeklyEstimatedAbsolute: tokenStatus.codexWeeklyEstimatedAbsolute,
      quotaPools: tokenStatus.quotaPools,
      localComputeStatus: tokenStatus.localComputeStatus,
      claudeDirectUsage: tokenStatus.claudeDirectUsage,
      errors: [],
    };
  }

  private applyQuotaData(tokenStatus: TokenStatus, quotaData: QuotaData): void {
    if (quotaData.quotaPools) {
      tokenStatus.quotaPools = quotaData.quotaPools;
    }
    if (quotaData.localComputeStatus) {
      tokenStatus.localComputeStatus = quotaData.localComputeStatus;
    }
    if (quotaData.claudeDirectUsage) {
      tokenStatus.claudeDirectUsage = quotaData.claudeDirectUsage;
    }
    if (quotaData.antigravityPercentage !== undefined) {
      tokenStatus.antigravityPercentage = quotaData.antigravityPercentage;
    }
    if (quotaData.antigravityResetTime !== undefined) {
      tokenStatus.antigravityResetTime = quotaData.antigravityResetTime;
    }
    if (quotaData.antigravityWeeklyPercentage !== undefined) {
      tokenStatus.antigravityWeeklyPercentage = quotaData.antigravityWeeklyPercentage;
    }
    if (quotaData.antigravityWeeklyResetTime !== undefined) {
      tokenStatus.antigravityWeeklyResetTime = quotaData.antigravityWeeklyResetTime;
    }
    if (quotaData.antigravityEstimatedAbsolute !== undefined) {
      tokenStatus.antigravityEstimatedAbsolute = quotaData.antigravityEstimatedAbsolute;
    }
    if (quotaData.opusPercentage !== undefined) {
      tokenStatus.opusPercentage = quotaData.opusPercentage;
    }
    if (quotaData.opusResetTime !== undefined) {
      tokenStatus.opusResetTime = quotaData.opusResetTime;
    }
    if (quotaData.opusWeeklyPercentage !== undefined) {
      tokenStatus.opusWeeklyPercentage = quotaData.opusWeeklyPercentage;
    }
    if (quotaData.opusWeeklyResetTime !== undefined) {
      tokenStatus.opusWeeklyResetTime = quotaData.opusWeeklyResetTime;
    }
    if (quotaData.opusEstimatedAbsolute !== undefined) {
      tokenStatus.opusEstimatedAbsolute = quotaData.opusEstimatedAbsolute;
    }
    if (quotaData.opusWeeklyEstimatedAbsolute !== undefined) {
      tokenStatus.opusWeeklyEstimatedAbsolute = quotaData.opusWeeklyEstimatedAbsolute;
    }
    if (quotaData.codexPercentage !== undefined) {
      tokenStatus.codexPercentage = quotaData.codexPercentage;
    }
    if (quotaData.codexWeeklyPercentage !== undefined) {
      tokenStatus.codexWeeklyPercentage = quotaData.codexWeeklyPercentage;
    }
    if (quotaData.codexResetTime !== undefined) {
      tokenStatus.codexResetTime = quotaData.codexResetTime;
    }
    if (quotaData.codexWeeklyResetTime !== undefined) {
      tokenStatus.codexWeeklyResetTime = quotaData.codexWeeklyResetTime;
    }
    if (quotaData.codexEstimatedAbsolute !== undefined) {
      tokenStatus.codexEstimatedAbsolute = quotaData.codexEstimatedAbsolute;
    }
    if (quotaData.codexWeeklyEstimatedAbsolute !== undefined) {
      tokenStatus.codexWeeklyEstimatedAbsolute = quotaData.codexWeeklyEstimatedAbsolute;
    }

    tokenStatus.recommendedTaskWeight = this.taskWeightFromCodexPercentage(
      tokenStatus.codexPercentage,
      tokenStatus.codexWeeklyPercentage,
    );

    if (tokenStatus.localComputeStatus) {
      if (tokenStatus.localComputeStatus.endpointHealth === "ok") {
        tokenStatus.llmStatus = `Online (${tokenStatus.localComputeStatus.loadedModels.length} models)`;
      } else {
        tokenStatus.llmStatus = "Offline";
      }
    }
  }

  private taskWeightFromCodexPercentage(
    codexPercentage: number | undefined,
    codexWeeklyPercentage?: number,
  ): TokenStatus["recommendedTaskWeight"] {
    const normalizePercentage = (percentage: number | undefined): number | undefined => {
      if (percentage === undefined || !Number.isFinite(percentage)) {
        return undefined;
      }

      return Math.max(0, Math.min(100, percentage));
    };

    const fiveHourPercentage = normalizePercentage(codexPercentage);
    const weeklyPercentage = normalizePercentage(codexWeeklyPercentage);

    if (fiveHourPercentage === undefined && weeklyPercentage === undefined) {
      return "unknown";
    }

    const effectivePercentage =
      fiveHourPercentage === undefined
        ? (weeklyPercentage as number)
        : weeklyPercentage === undefined
          ? fiveHourPercentage
          : Math.min(fiveHourPercentage, weeklyPercentage);

    if (effectivePercentage <= 15) {
      return "restricted";
    }
    if (effectivePercentage <= 50) {
      return "degraded";
    }

    return "normal";
  }

  private getFreshCachedQuota(activity: string[]): QuotaData | undefined {
    const now = Date.now();
    if (this.quotaCache && now - this.quotaCache.lastFetchTime < QUOTA_CACHE_TTL_MS) {
      activity.push(`Using cached quota telemetry from ${new Date(this.quotaCache.lastFetchTime).toLocaleTimeString()}.`);
      return this.quotaCache.data;
    }

    return undefined;
  }

  private async getQuotaData(
    activity: string[],
    fallback: QuotaData,
    forceRefresh?: boolean,
    workspaceStateRoot?: string,
  ): Promise<QuotaData> {
    if (!forceRefresh) {
      const cached = this.getFreshCachedQuota(activity);
      if (cached) {
        return cached;
      }
    }

    if (this.fetchPromise) {
      if (forceRefresh) {
        this.fetchPromise = this.fetchQuotaData(forceRefresh, workspaceStateRoot);
      } else {
        activity.push("Waiting for in-flight quota telemetry request.");
      }
    } else {
      this.fetchPromise = this.fetchQuotaData(forceRefresh, workspaceStateRoot);
    }

    const currentFetch = this.fetchPromise;
    try {
      const fetched = await currentFetch;
      const data = this.withFallbackQuota(fetched, fallback);
      this.quotaCache = { lastFetchTime: Date.now(), data };
      activity.push(`Parsed real-time quota at ${new Date().toLocaleTimeString()}`);
      return data;
    } catch (error) {
      const data = {
        ...fallback,
        errors: [`Quota telemetry: ${this.errorMessage(error)}`],
      };
      this.quotaCache = { lastFetchTime: Date.now(), data };
      return data;
    } finally {
      if (this.fetchPromise === currentFetch) {
        this.fetchPromise = undefined;
      }
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
    // Preserve a valid provider-reported deadline without treating it as proof of an active recharge.
    return resetTime;
  }

  private withFallbackQuota(fetched: QuotaData, fallback: QuotaData): QuotaData {
    const antigravityPct = fetched.antigravityPercentage ?? fallback.antigravityPercentage;
    const antigravityWeeklyPct = fetched.antigravityWeeklyPercentage ?? fallback.antigravityWeeklyPercentage;
    const opusPct = fetched.opusPercentage ?? fallback.opusPercentage;
    const opusWeeklyPct = fetched.opusWeeklyPercentage ?? fallback.opusWeeklyPercentage;
    const codexPct = fetched.codexPercentage ?? fallback.codexPercentage;
    const codexWeeklyPct = fetched.codexWeeklyPercentage ?? fallback.codexWeeklyPercentage;

    return {
      quotaPools: fetched.quotaPools ?? fallback.quotaPools,
      localComputeStatus: fetched.localComputeStatus ?? fallback.localComputeStatus,
      claudeDirectUsage: fetched.claudeDirectUsage ?? fallback.claudeDirectUsage,
      antigravityPercentage: antigravityPct,
      antigravityResetTime: fetched.antigravityPercentage !== undefined
        ? this.sanitizeResetTime(fetched.antigravityResetTime, antigravityPct, true)
        : this.sanitizeResetTime(fetched.antigravityResetTime ?? fallback.antigravityResetTime, antigravityPct, true),
      antigravityWeeklyPercentage: antigravityWeeklyPct,
      antigravityWeeklyResetTime: fetched.antigravityWeeklyPercentage !== undefined
        ? this.sanitizeResetTime(fetched.antigravityWeeklyResetTime, antigravityWeeklyPct, false)
        : this.sanitizeResetTime(fetched.antigravityWeeklyResetTime ?? fallback.antigravityWeeklyResetTime, antigravityWeeklyPct, false),
      antigravityEstimatedAbsolute: fetched.antigravityEstimatedAbsolute ?? fallback.antigravityEstimatedAbsolute,
      opusPercentage: opusPct,
      opusResetTime: fetched.opusPercentage !== undefined
        ? this.sanitizeResetTime(fetched.opusResetTime, opusPct, true)
        : this.sanitizeResetTime(fetched.opusResetTime ?? fallback.opusResetTime, opusPct, true),
      opusEstimatedAbsolute: fetched.opusEstimatedAbsolute ?? fallback.opusEstimatedAbsolute,
      opusWeeklyPercentage: opusWeeklyPct,
      opusWeeklyResetTime: fetched.opusWeeklyPercentage !== undefined
        ? this.sanitizeResetTime(fetched.opusWeeklyResetTime, opusWeeklyPct, false)
        : this.sanitizeResetTime(fetched.opusWeeklyResetTime ?? fallback.opusWeeklyResetTime, opusWeeklyPct, false),
      opusWeeklyEstimatedAbsolute: fetched.opusWeeklyEstimatedAbsolute ?? fallback.opusWeeklyEstimatedAbsolute,
      codexPercentage: codexPct,
      codexResetTime: fetched.codexPercentage !== undefined
        ? this.sanitizeResetTime(fetched.codexResetTime, codexPct, true)
        : this.sanitizeResetTime(fetched.codexResetTime ?? fallback.codexResetTime, codexPct, true),
      codexWeeklyPercentage: codexWeeklyPct,
      codexWeeklyResetTime: fetched.codexWeeklyPercentage !== undefined
        ? this.sanitizeResetTime(fetched.codexWeeklyResetTime, codexWeeklyPct, false)
        : this.sanitizeResetTime(fetched.codexWeeklyResetTime ?? fallback.codexWeeklyResetTime, codexWeeklyPct, false),
      codexEstimatedAbsolute: fetched.codexEstimatedAbsolute ?? fallback.codexEstimatedAbsolute,
      codexWeeklyEstimatedAbsolute: fetched.codexWeeklyEstimatedAbsolute ?? fallback.codexWeeklyEstimatedAbsolute,
      errors: fetched.errors,
    };
  }

  private async fetchQuotaData(forceRefresh = false, workspaceStateRoot?: string): Promise<QuotaData> {
    const data: QuotaData = { errors: [], quotaPools: [] };

    const tasks = [
      // 1. Codex
      (async () => {
        if (this.isCircuitOpen("codex") && !forceRefresh) {
          return;
        }
        try {
          const codexQuota = await this.withTimeout(this.fetchCodexQuota(forceRefresh), 5000);
          this.recordProviderSuccess("codex");
          data.codexPercentage = codexQuota.codexPercentage;
          data.codexResetTime = codexQuota.codexResetTime;
          data.codexEstimatedAbsolute = codexQuota.codexEstimatedAbsolute;
          data.codexWeeklyPercentage = codexQuota.codexWeeklyPercentage;
          data.codexWeeklyResetTime = codexQuota.codexWeeklyResetTime;
          data.codexWeeklyEstimatedAbsolute = codexQuota.codexWeeklyEstimatedAbsolute;
          data.codexMeasuredAt = codexQuota.codexMeasuredAt;
          data.codexWeeklyMeasuredAt = codexQuota.codexWeeklyMeasuredAt;
          data.codexSource = codexQuota.codexSource;
          if (codexQuota.codexPercentage !== undefined) {
            data.quotaPools!.push({
              id: "codex.5h",
              provider: "codex",
              remainingPercentage: codexQuota.codexPercentage,
              remainingTokens: codexQuota.codexEstimatedAbsolute,
              resetTime: codexQuota.codexResetTime,
              measuredAt: codexQuota.codexMeasuredAt,
              windowDurationMins: 300,
              source: codexQuota.codexSource ?? "cli-json",
              confidence: "reported-quota"
            });
          }
          if (codexQuota.codexWeeklyPercentage !== undefined) {
            data.quotaPools!.push({
              id: "codex.weekly",
              provider: "codex",
              remainingPercentage: codexQuota.codexWeeklyPercentage,
              remainingTokens: codexQuota.codexWeeklyEstimatedAbsolute,
              resetTime: codexQuota.codexWeeklyResetTime,
              measuredAt: codexQuota.codexWeeklyMeasuredAt,
              windowDurationMins: 10080,
              source: codexQuota.codexSource ?? "cli-json",
              confidence: "reported-quota"
            });
          }
          if (codexQuota.codexPercentage === undefined && codexQuota.codexWeeklyPercentage === undefined) {
            data.errors.push("Codex: quota reader returned no supported 5-hour or weekly window.");
          }
        } catch (error) {
          this.recordProviderFailure("codex");
          data.errors.push(`Codex: ${this.errorMessage(error)}`);
        }
      })(),

      // 2. Antigravity
      (async () => {
        if (this.isCircuitOpen("antigravity") && !forceRefresh) {
          data.errors.push("Antigravity: quota source is cooling down after repeated failures.");
          return;
        }
        try {
          const poolsBefore = data.quotaPools!.length;
          const antigravityQuota = await this.withTimeout(this.fetchAntigravityQuota(), 7000);
          this.recordProviderSuccess("antigravity");
          data.antigravityPercentage = antigravityQuota.antigravityPercentage;
          data.antigravityResetTime = antigravityQuota.antigravityResetTime;
          data.antigravityWeeklyPercentage = antigravityQuota.antigravityWeeklyPercentage;
          data.antigravityWeeklyResetTime = antigravityQuota.antigravityWeeklyResetTime;
          data.opusPercentage = antigravityQuota.opusPercentage;
          data.opusResetTime = antigravityQuota.opusResetTime;
          data.opusWeeklyPercentage = antigravityQuota.opusWeeklyPercentage;
          data.opusWeeklyResetTime = antigravityQuota.opusWeeklyResetTime;
          if (antigravityQuota.antigravityPercentage !== undefined) data.quotaPools!.push({
            id: "antigravity.default",
            provider: "antigravity",
            remainingPercentage: antigravityQuota.antigravityPercentage,
            resetTime: antigravityQuota.antigravityResetTime,
            measuredAt: antigravityQuota.measuredAt,
            windowDurationMins: 300,
            source: "provider-api",
            confidence: "reported-quota"
          });
          if (antigravityQuota.antigravityWeeklyPercentage !== undefined) data.quotaPools!.push({
            id: "antigravity.weekly",
            provider: "antigravity",
            remainingPercentage: antigravityQuota.antigravityWeeklyPercentage,
            resetTime: antigravityQuota.antigravityWeeklyResetTime,
            measuredAt: antigravityQuota.measuredAt,
            windowDurationMins: 10080,
            source: "provider-api",
            confidence: "reported-quota"
          });
          if (antigravityQuota.opusPercentage !== undefined) data.quotaPools!.push({
            id: "opus.default",
            provider: "anthropic",
            remainingPercentage: antigravityQuota.opusPercentage,
            resetTime: antigravityQuota.opusResetTime,
            measuredAt: antigravityQuota.measuredAt,
            windowDurationMins: 300,
            source: "provider-api",
            confidence: "reported-quota"
          });
          if (antigravityQuota.opusWeeklyPercentage !== undefined) data.quotaPools!.push({
            id: "opus.weekly",
            provider: "anthropic",
            remainingPercentage: antigravityQuota.opusWeeklyPercentage,
            resetTime: antigravityQuota.opusWeeklyResetTime,
            measuredAt: antigravityQuota.measuredAt,
            windowDurationMins: 10080,
            source: "provider-api",
            confidence: "reported-quota"
          });
          if (data.quotaPools!.length === poolsBefore) data.errors.push("Antigravity: provider returned no supported Gemini or Claude quota windows.");
        } catch (error) {
          this.recordProviderFailure("antigravity");
          if (error instanceof AgyNotInstalledError) {
            this.handleAgyMissing();
            data.errors.push(`Antigravity: CLI is missing.`);
          } else if (error instanceof AgyNotAuthenticatedError) {
            this.handleAgyAuthRequired();
            data.errors.push(`Antigravity: Authentication required.`);
          } else {
            data.errors.push(`Antigravity: ${this.errorMessage(error)}`);
          }
        }
      })(),

      // 3. Local LLM / GPU
      (async () => {
        if (this.isCircuitOpen("localLlm") && !forceRefresh) {
          data.errors.push("LocalLLM: telemetry source is cooling down after repeated failures.");
          return;
        }
        try {
          const { localComputeStatus, quotaPool } = await this.withTimeout(
            this.fetchLocalLlmStatus(),
            10_000,
          );
          this.recordProviderSuccess("localLlm");
          data.localComputeStatus = localComputeStatus;
          if (quotaPool) {
            data.quotaPools!.push(quotaPool);
          }
        } catch (error) {
          this.recordProviderFailure("localLlm");
          data.errors.push(`LocalLLM: ${this.errorMessage(error)}`);
        }
      })(),

      // 4. Claude Direct Telemetry
      (async () => {
        if (this.isCircuitOpen("claude") && !forceRefresh) {
          data.errors.push("Claude Direct: usage source is cooling down after repeated failures.");
          return;
        }
        try {
          const usage = await this.withTimeout(this.fetchClaudeDirectUsage(workspaceStateRoot), 2000);
          this.recordProviderSuccess("claude");
          data.claudeDirectUsage = usage;
          if (usage.errors?.length) {
            data.errors.push(...usage.errors.map((error) => `Claude Direct: ${error}`));
          }
        } catch (error) {
          this.recordProviderFailure("claude");
          data.errors.push(`Claude Direct: ${this.errorMessage(error)}`);
        }
      })(),
    ];

    await Promise.allSettled(tasks);
    return data;
  }

  protected async fetchClaudeDirectUsage(workspaceStateRoot: string | undefined): Promise<ClaudeDirectUsageStatus> {
    const events: ClaudeUsageEvent[] = [];
    const errors: string[] = [];
    const sources = new Set<string>();
    const eventIndexById = new Map<string, number>();
    const seenFiles = new Set<string>();

    const readJsonl = async (filePath: string, source: string, trustClaudePath = false): Promise<void> => {
      try {
        const canonicalPath = (await fs.promises.realpath(filePath).catch(() => path.resolve(filePath))).toLowerCase();
        if (seenFiles.has(canonicalPath)) return;
        seenFiles.add(canonicalPath);
        const file = await this.readFileTailDetailed(filePath, CLAUDE_USAGE_MAX_FILE_BYTES);
        if (file.truncated) errors.push(`${source}: scan was partial because the file exceeded the local byte limit.`);
        const allLines = file.content.split(/\r?\n/);
        const lines = allLines.length > CLAUDE_USAGE_MAX_LINES_PER_FILE
          ? allLines.slice(-CLAUDE_USAGE_MAX_LINES_PER_FILE)
          : allLines;
        if (allLines.length > CLAUDE_USAGE_MAX_LINES_PER_FILE) errors.push(`${source}: scan was partial because the file exceeded the local line limit.`);
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.includes("{")) {
            return;
          }

          const jsonStart = trimmed.indexOf("{");
          try {
            const parsed = JSON.parse(trimmed.slice(jsonStart)) as JsonObject;
            const event = this.claudeUsageEventFromObject(parsed, source, trustClaudePath);
            if (event) {
              if (event.eventId && eventIndexById.has(event.eventId)) {
                const priorIndex = eventIndexById.get(event.eventId)!;
                if (event.timestamp >= events[priorIndex].timestamp) events[priorIndex] = { ...event, source };
                return;
              }
              if (event.eventId) eventIndexById.set(event.eventId, events.length);
              events.push({ ...event, source });
              sources.add(source);
            }
          } catch {
            // Log files can contain non-JSON diagnostic lines. Ignore those lines.
          }
        });
      } catch (error: any) {
        if (!this.isFileNotFound(error) && error?.code !== "EBUSY" && error?.code !== "EPERM") {
          errors.push(`${source}: ${this.errorMessage(error)}`);
        }
      }
    };

    if (workspaceStateRoot) {
      await readJsonl(path.join(workspaceStateRoot, "telemetry", "events.jsonl"), "Integrated Power telemetry");
      await this.readClaudeCsvUsage(path.join(workspaceStateRoot, "reports", "token_usage.csv"), events, sources, errors);
    }

    const claudeFiles = await this.findClaudeUsageFiles();
    if (claudeFiles.length >= CLAUDE_USAGE_MAX_FILES) errors.push("Claude usage scan was partial because it reached the file-count limit.");
    await Promise.all(
      claudeFiles.map((file) => readJsonl(file.fullPath, this.claudeSourceLabel(file.fullPath), true)),
    );

    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sevenDaysStart = now - 7 * 24 * 60 * 60 * 1000;
    const today = this.summarizeClaudeUsage(events.filter((event) => event.timestamp >= todayStart.getTime()));
    const sevenDays = this.summarizeClaudeUsage(events.filter((event) => event.timestamp >= sevenDaysStart));
    const lastUsedAt = events.length
      ? new Date(Math.max(...events.map((event) => event.timestamp))).toISOString()
      : undefined;
    const partial = errors.length > 0;

    return {
      status: events.length ? (partial ? "partial" : "measured") : "no-data",
      today,
      sevenDays,
      sources: Array.from(sources).sort(),
      lastUsedAt,
      lastMeasuredAt: lastUsedAt,
      errors: errors.slice(0, 6),
    };
  }

  private async readClaudeCsvUsage(
    filePath: string,
    events: ClaudeUsageEvent[],
    sources: Set<string>,
    errors: string[],
  ): Promise<void> {
    try {
      const content = await fs.promises.readFile(filePath, "utf8");
      const lines = content.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        return;
      }

      const headers = this.parseCsvLine(lines[0]).map((header) => header.trim());
      for (const line of lines.slice(1)) {
        const row = this.parseCsvLine(line);
        const value = (name: string): string | undefined => {
          const index = headers.indexOf(name);
          return index >= 0 ? row[index] : undefined;
        };
        const providerText = [
          value("Provider"),
          value("Method"),
          value("Operation"),
          value("Model"),
          value("Source"),
        ].join(" ").toLowerCase();

        if (!/(anthropic|claude|cowork)/.test(providerText)) {
          continue;
        }

        const timestamp = Date.parse(value("Timestamp") || "");
        if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5 * 60_000) {
          continue;
        }

        const inputTokens = this.safePositiveNumber(value("InputTokens"));
        const cachedInputTokens = this.safePositiveNumber(value("CachedInputTokens"));
        const outputTokens = this.safePositiveNumber(value("OutputTokens"));
        const reasoningOutputTokens = this.safePositiveNumber(value("ReasoningOutputTokens"));
        const totalTokens = this.safePositiveNumber(value("TotalTokens")) || inputTokens + outputTokens;

        if (totalTokens <= 0) {
          continue;
        }

        events.push({
          timestamp,
          source: "Integrated Power token_usage.csv",
          inputTokens,
          cachedInputTokens,
          outputTokens,
          reasoningOutputTokens,
          totalTokens,
          billableTokens: this.optionalNonnegativeNumber(value("BillableTokens")),
        });
        sources.add("Integrated Power token_usage.csv");
      }
    } catch (error) {
      if (!this.isFileNotFound(error)) {
        errors.push(`token_usage.csv: ${this.errorMessage(error)}`);
      }
    }
  }

  private claudeUsageEventFromObject(
    event: JsonObject,
    source: string,
    trustClaudePath: boolean,
  ): ClaudeUsageEvent | undefined {
    const producer = this.objectValue(event.producer);
    const usage = this.firstObjectValue([
      event.usage,
      this.objectValue(event.message)?.usage,
      this.objectValue(event.response)?.usage,
      this.objectValue(event.result)?.usage,
      event,
    ]);

    if (!usage) {
      return undefined;
    }

    const providerText = [
      producer?.provider,
      producer?.model,
      event.provider,
      event.model,
      this.objectValue(event.message)?.model,
      this.objectValue(event.response)?.model,
      source,
    ].join(" ").toLowerCase();

    if (!trustClaudePath && !/(anthropic|claude|cowork)/.test(providerText)) {
      return undefined;
    }

    const inputTokens = this.safePositiveNumber(
      usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens,
    );
    const hasAnthropicCacheSchema = usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined;
    const cachedInputTokens = hasAnthropicCacheSchema
      ? this.safePositiveNumber(usage.cache_read_input_tokens) + this.safePositiveNumber(usage.cache_creation_input_tokens)
      : this.safePositiveNumber(usage.cached_tokens ?? usage.cachedInputTokens);
    const outputTokens = this.safePositiveNumber(
      usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.completionTokens,
    );
    const reasoningOutputTokens = this.safePositiveNumber(
      usage.reasoning_tokens ?? usage.reasoning_output_tokens ?? usage.reasoningOutputTokens,
    );
    const reportedTotal = this.safePositiveNumber(usage.total_tokens ?? usage.totalTokens);
    const totalTokens = reportedTotal || inputTokens + (hasAnthropicCacheSchema ? cachedInputTokens : 0) + outputTokens;
    const billableTokens = this.optionalNonnegativeNumber(usage.billable_tokens ?? usage.billableTokens);

    if (totalTokens <= 0) {
      return undefined;
    }

    const timestamp = this.timestampFromUsageEvent(event);
    if (timestamp === undefined || timestamp > Date.now() + 5 * 60_000) return undefined;
    const rawId = [this.objectValue(event.message)?.id, event.request_id, event.requestId, event.id]
      .find((value) => typeof value === "string" && value.trim());
    return {
      timestamp,
      eventId: typeof rawId === "string" ? rawId : undefined,
      source,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens,
      billableTokens,
    };
  }

  private timestampFromUsageEvent(event: JsonObject): number | undefined {
    const candidates = [
      event.timestamp,
      event.created_at,
      event.createdAt,
      this.objectValue(event.message)?.created_at,
      this.objectValue(event.message)?.createdAt,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate > 10_000_000_000 ? candidate : candidate * 1000;
      }
      if (typeof candidate === "string" && candidate.trim()) {
        const parsed = Date.parse(candidate);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return undefined;
  }

  private summarizeClaudeUsage(events: ClaudeUsageEvent[]): UsageWindowSummary {
    return events.reduce<UsageWindowSummary>(
      (summary, event) => ({
        inputTokens: summary.inputTokens + event.inputTokens,
        cachedInputTokens: summary.cachedInputTokens + event.cachedInputTokens,
        outputTokens: summary.outputTokens + event.outputTokens,
        reasoningOutputTokens: summary.reasoningOutputTokens + event.reasoningOutputTokens,
        totalTokens: summary.totalTokens + event.totalTokens,
        billableTokens: summary.eventCount === 0
          ? event.billableTokens
          : summary.billableTokens !== undefined && event.billableTokens !== undefined
            ? summary.billableTokens + event.billableTokens
            : undefined,
        eventCount: summary.eventCount + 1,
      }),
      this.emptyUsageSummary(),
    );
  }

  private emptyUsageSummary(): UsageWindowSummary {
    return {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      billableTokens: undefined,
      eventCount: 0,
    };
  }

  private async findClaudeUsageFiles(): Promise<JsonlFileStat[]> {
    const roots = [
      path.join(os.homedir(), ".claude"),
      process.env.APPDATA ? path.join(process.env.APPDATA, "Claude") : undefined,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "AnthropicClaude") : undefined,
      process.env.CLAUDE_USAGE_LOG_DIR,
      process.env.COWORK_USAGE_LOG_DIR,
    ].filter((value): value is string => Boolean(value));

    const files: JsonlFileStat[] = [];
    for (const root of roots) {
      await this.collectClaudeUsageFiles(root, 0, files);
    }

    return files
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, CLAUDE_USAGE_MAX_FILES);
  }

  private async collectClaudeUsageFiles(directory: string, depth: number, files: JsonlFileStat[]): Promise<void> {
    if (depth > CLAUDE_USAGE_SCAN_DEPTH || files.length >= CLAUDE_USAGE_MAX_FILES) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    const inspected = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        try {
          return { entry, fullPath, stat: await fs.promises.stat(fullPath) };
        } catch {
          return undefined;
        }
      }),
    );

    const existing = inspected.filter((entry): entry is { entry: fs.Dirent; fullPath: string; stat: fs.Stats } => Boolean(entry));
    const jsonFiles = existing
      .filter(({ entry }) => entry.isFile() && /\.(jsonl|log)$/i.test(entry.name))
      .filter(({ fullPath }) => !fullPath.toLowerCase().includes(`${path.sep}node_modules${path.sep}`))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    for (const file of jsonFiles) {
      if (files.length >= CLAUDE_USAGE_MAX_FILES) {
        return;
      }

      files.push({ fullPath: file.fullPath, mtimeMs: file.stat.mtimeMs });
    }

    const directories = existing
      .filter(({ entry, fullPath }) => entry.isDirectory() && !fullPath.toLowerCase().includes(`${path.sep}node_modules${path.sep}`))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    for (const child of directories) {
      if (files.length >= CLAUDE_USAGE_MAX_FILES) {
        return;
      }

      await this.collectClaudeUsageFiles(child.fullPath, depth + 1, files);
    }
  }

  private claudeSourceLabel(filePath: string): string {
    const normalized = filePath.toLowerCase();
    if (normalized.includes(`${path.sep}.claude${path.sep}`)) {
      return "Claude CLI";
    }
    if (normalized.includes("cowork")) {
      return "Cowork";
    }
    if (normalized.includes("anthropicclaude") || normalized.includes(`${path.sep}claude${path.sep}`)) {
      return "Claude app";
    }
    return "Claude log";
  }

  private workspaceStateRootFromTokenReport(fileUri: TokenFileUri | undefined): string | undefined {
    if (!fileUri?.fsPath) {
      return undefined;
    }

    return path.dirname(path.dirname(fileUri.fsPath));
  }

  private async fetchGpuMetrics(): Promise<GpuStatus[] | undefined> {
    try {
      const output = await this.execFileText(
        "nvidia-smi",
        [
          "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,power.draw,power.limit,enforced.power.limit",
          "--format=csv,noheader,nounits",
        ],
        { timeoutMs: 3_000 },
      );
      const rows = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(",").map((part) => part.trim()));

      if (rows.length === 0) {
        return this.lastGpuMetrics;
      }

      const gpus: GpuStatus[] = rows
        .map((parts) => {
          const powerLimit = parseFloat(parts[6]);
          const enforcedLimit = parseFloat(parts[7]);
          const userConfiguredLimit =
            Number.isFinite(powerLimit) && powerLimit > 0
              ? powerLimit
              : Number.isFinite(enforcedLimit)
              ? enforcedLimit
              : 0;
          return {
            id: parseInt(parts[0], 10),
            name: parts[1],
            utilizationPercentage: parseFloat(parts[2]),
            vramUsedMb: parseFloat(parts[3]),
            vramTotalMb: parseFloat(parts[4]),
            powerDrawW: parseFloat(parts[5]),
            powerLimitW: userConfiguredLimit,
          };
        })
        .filter((gpu) => Number.isFinite(gpu.utilizationPercentage));

      if (gpus.length > 0) {
        this.lastGpuMetrics = gpus;
        return gpus;
      }
      return this.lastGpuMetrics;
    } catch {
      return this.lastGpuMetrics;
    }
  }

  private httpGetJson(urlStr: string, timeoutMs = 800): Promise<JsonObject> {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(urlStr);
        const req = http.get(
          url,
          {
            timeout: timeoutMs,
            headers: { Accept: "application/json" },
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
              try {
                const parsed = JSON.parse(body);
                resolve(parsed as JsonObject);
              } catch (e) {
                reject(e);
              }
            });
          },
        );
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy(new Error("Probe timeout"));
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Collector for Local LLM
  protected async fetchLocalLlmStatus(): Promise<{ localComputeStatus: LocalComputeStatus; quotaPool?: QuotaPoolStatus }> {
    const gpuMetrics = await this.fetchGpuMetrics();
    const withGpuMetrics = (status: LocalComputeStatus): LocalComputeStatus => ({
      ...status,
      gpus: gpuMetrics || this.lastGpuMetrics,
    });

    const configuredEndpoint = (process.env.INTEGRATED_POWER_LOCAL_ENDPOINT || process.env.OLLAMA_HOST || "").trim();
    const defaultEndpoints = configuredEndpoint
      ? [configuredEndpoint.includes("://") ? configuredEndpoint : `http://${configuredEndpoint}`]
      : ["http://127.0.0.1:11435", "http://127.0.0.1:11434"];
    for (const rawBaseUrl of defaultEndpoints) {
      const baseUrl = rawBaseUrl.replace("0.0.0.0", "127.0.0.1").replace(/\/+$/, "");
      if (/\/v1$/i.test(baseUrl)) {
        try {
          const modelsData = await this.httpGetJson(`${baseUrl}/models`, 800);
          const models = Array.isArray(modelsData.data) ? modelsData.data : [];
          const loadedModels = models.map((model: any) => String(model?.id || "")).filter(Boolean);
          return {
            localComputeStatus: withGpuMetrics({
              endpointHealth: loadedModels.length ? "ok" : "idle",
              programName: loadedModels.length ? `Local endpoint (${loadedModels[0]})` : "Local endpoint (Idle)",
              loadedModels,
            }),
            quotaPool: { id: "local.openai-compatible", provider: "local", source: "local-service", confidence: "exact" },
          };
        } catch {
          // Fall through to other known local service probes.
        }
      }
      try {
        const psData = await this.httpGetJson(`${baseUrl}/api/ps`, 800);
        const models = Array.isArray(psData.models) ? psData.models : [];
        const loadedModels = models.map((m: any) => String(m?.name || "")).filter(Boolean);
        const isModelLoaded = loadedModels.length > 0;
        return {
          localComputeStatus: withGpuMetrics({
            endpointHealth: isModelLoaded ? "ok" : "idle",
            programName: isModelLoaded ? `Ollama (${loadedModels[0]})` : "Ollama (Idle)",
            loadedModels,
          }),
          quotaPool: {
            id: "local.ollama",
            provider: "local",
            source: "local-service",
            confidence: "exact",
          },
        };
      } catch {
        if (configuredEndpoint) {
          try {
            const modelsData = await this.httpGetJson(`${baseUrl}/v1/models`, 800);
            const models = Array.isArray(modelsData.data) ? modelsData.data : [];
            const loadedModels = models.map((model: any) => String(model?.id || "")).filter(Boolean);
            return {
              localComputeStatus: withGpuMetrics({
                endpointHealth: loadedModels.length ? "ok" : "idle",
                programName: loadedModels.length ? `Local endpoint (${loadedModels[0]})` : "Local endpoint (Idle)",
                loadedModels,
              }),
              quotaPool: { id: "local.openai-compatible", provider: "local", source: "local-service", confidence: "exact" },
            };
          } catch {
            // Configured endpoint did not expose an OpenAI-compatible model list.
          }
        }
        try {
          const tagsData = await this.httpGetJson(`${baseUrl}/api/tags`, 600);
          if (tagsData && (Array.isArray(tagsData.models) || tagsData.models)) {
            return {
              localComputeStatus: withGpuMetrics({ endpointHealth: "idle", programName: "Ollama (Idle)", loadedModels: [] }),
              quotaPool: { id: "local.ollama", provider: "local", source: "local-service", confidence: "exact" },
            };
          }
        } catch {
          // Try the next configured or documented/legacy local endpoint.
        }
      }
      if (configuredEndpoint) break;
    }

    // 2. LM Studio Probe
    try {
      const lmsData = await this.httpGetJson("http://127.0.0.1:1234/v1/models", 600);
      const models = Array.isArray(lmsData.data) ? lmsData.data : [];
      const loadedModels = models.map((m: any) => String(m?.id || "")).filter(Boolean);
      const isModelLoaded = loadedModels.length > 0;
      return {
        localComputeStatus: withGpuMetrics({
          endpointHealth: isModelLoaded ? "ok" : "idle",
          programName: isModelLoaded ? `LM Studio (${loadedModels[0]})` : "LM Studio (Idle)",
          loadedModels,
        }),
        quotaPool: {
          id: "local.lm-studio",
          provider: "local",
          source: "local-service",
          confidence: "exact",
        },
      };
    } catch {
      // LM Studio offline
    }

    // 3. vLLM Probe
    try {
      const vllmData = await this.httpGetJson("http://127.0.0.1:8000/v1/models", 600);
      const models = Array.isArray(vllmData.data) ? vllmData.data : [];
      const loadedModels = models.map((m: any) => String(m?.id || "")).filter(Boolean);
      const isModelLoaded = loadedModels.length > 0;
      return {
        localComputeStatus: withGpuMetrics({
          endpointHealth: isModelLoaded ? "ok" : "idle",
          programName: isModelLoaded ? `vLLM (${loadedModels[0]})` : "vLLM (Idle)",
          loadedModels,
        }),
        quotaPool: {
          id: "local.vllm",
          provider: "local",
          source: "local-service",
          confidence: "exact",
        },
      };
    } catch {
      // vLLM offline
    }

    return {
      localComputeStatus: withGpuMetrics({
        endpointHealth: "offline",
        programName: "Offline",
        loadedModels: [],
      }),
    };
  }

  public findCodexCli(): string | undefined {
    return findCodexCliSync();
  }

  private async triggerCodexLiveRefresh(): Promise<void> {
    // 15-minute strict cooldown to prevent quota drains
    const now = Date.now();
    if (now - this.lastCodexLiveRefreshAt < 15 * 60 * 1000) {
      return;
    }
    this.lastCodexLiveRefreshAt = now;

    const cli = this.findCodexCli();
    if (!cli) {
      return;
    }

    const lowest = getLowestCodexModel();

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      // TRUE Instant Abort: kill after 250ms to prevent heavy model token consumption
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Ignore kill error
        }
        finish();
      }, 250);

      // Explicitly specify lowest verified model from models_cache.json (e.g. gpt-6-luna), low effort, ephemeral session, and ignore heavy rules
      const child = cp.spawn(
        cli,
        [
          "exec",
          "-m",
          lowest.model,
          "--skip-git-repo-check",
          "--ephemeral",
          "--ignore-rules",
          "--disable",
          "skills",
          "-c",
          `model="${lowest.model}"`,
          "-c",
          `model_reasoning_effort="${lowest.reasoningEffort}"`,
          "1",
        ],
        {
          stdio: ["ignore", "ignore", "ignore"],
          windowsHide: true,
          shell: cli === "codex" || cli.endsWith(".cmd"),
        }
      );

      child.on("error", () => {
        clearTimeout(timer);
        finish();
      });

      child.on("close", () => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  protected async fetchCodexQuota(forceRefresh = false): Promise<
    Pick<
      QuotaData,
      | "codexPercentage"
      | "codexResetTime"
      | "codexEstimatedAbsolute"
      | "codexWeeklyPercentage"
      | "codexWeeklyResetTime"
      | "codexWeeklyEstimatedAbsolute"
      | "codexMeasuredAt"
      | "codexWeeklyMeasuredAt"
      | "codexSource"
    >
  > {
    // 1. Live zero-token RPC telemetry via Codex app-server account/rateLimits/read
    try {
      const live = await fetchLiveCodexRateLimits(forceRefresh);
      if (live && (live.codexPercentage !== undefined || live.codexWeeklyPercentage !== undefined)) {
        return {
          codexPercentage: live.codexPercentage,
          codexResetTime: live.codexResetTime,
          codexEstimatedAbsolute: undefined,
          codexWeeklyPercentage: live.codexWeeklyPercentage,
          codexWeeklyResetTime: live.codexWeeklyResetTime,
          codexWeeklyEstimatedAbsolute: undefined,
          codexMeasuredAt: live.measuredAt,
          codexWeeklyMeasuredAt: live.measuredAt,
          codexSource: "official-api",
        };
      }
    } catch {
      // Best-effort live query; fall through to passive session scanning
    }

    const sessionsDir = path.join(os.homedir(), ".codex", "sessions");

    // Fallback: read existing session files passively when app-server is unreachable.
    const files = await this.walkJsonlFiles(sessionsDir);
    for (const file of files) {
      const content = await this.readFileTail(file.fullPath, MAX_SESSION_FILE_BYTES);
      const lines = content.split(/\r?\n/).reverse().slice(0, MAX_SESSION_LINES_PER_FILE);

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          const event = JSON.parse(line) as JsonObject;
          const quota = this.codexQuotaFromEvent(event);
          const measuredAt = quota?.codexMeasuredAt ? Date.parse(quota.codexMeasuredAt) : NaN;
          if (quota && Number.isFinite(measuredAt) && Date.now() - measuredAt <= 5 * 60_000 && measuredAt <= Date.now() + 60_000
            && (quota.codexPercentage !== undefined || quota.codexWeeklyPercentage !== undefined)) {
            return quota;
          }
        } catch {
          // Ignore malformed or partial JSONL lines and keep scanning older events.
        }
      }
    }

    throw new Error("No token_count event found in recent Codex sessions");
  }

  private codexQuotaFromEvent(
    event: JsonObject,
    _fileMtimeMs?: number,
  ):
    | Pick<
        QuotaData,
        | "codexPercentage"
        | "codexResetTime"
        | "codexEstimatedAbsolute"
        | "codexWeeklyPercentage"
        | "codexWeeklyResetTime"
        | "codexWeeklyEstimatedAbsolute"
        | "codexMeasuredAt"
        | "codexWeeklyMeasuredAt"
        | "codexSource"
      >
    | undefined {
    const payload = this.objectValue(event.payload);
    const rateLimits = this.objectValue(payload?.rate_limits);
    const rawLimitId = rateLimits?.limit_id ?? rateLimits?.limitId;
    const limitId = typeof rawLimitId === "string" ? rawLimitId : undefined;
    if (limitId && limitId.toLowerCase() !== "codex") return undefined;
    const primary = this.objectValue(rateLimits?.primary);
    const secondary = this.objectValue(rateLimits?.secondary);

    if (event.type !== "event_msg" || payload?.type !== "token_count" || !primary) {
      return undefined;
    }

    const limits = [primary, secondary].filter((limit): limit is JsonObject => Boolean(limit));
    const hasWindowDurations = limits.some((limit) => this.numberValue(limit, ["window_minutes"]) !== undefined);
    const fiveHour = hasWindowDurations
      ? limits.find((limit) => this.numberValue(limit, ["window_minutes"]) === 300)
      : primary;
    const weekly = hasWindowDurations
      ? limits.find((limit) => this.numberValue(limit, ["window_minutes"]) === 10080)
      : secondary;

    const fiveHourQuota = this.codexWindowQuota(fiveHour);
    const weeklyQuota = this.codexWindowQuota(weekly);

    const eventTimestamp = this.timestampFromUsageEvent(event);
    if (eventTimestamp === undefined || eventTimestamp < Date.now() - 5 * 60_000 || eventTimestamp > Date.now() + 60_000) return undefined;
    const measuredAt = new Date(eventTimestamp).toISOString();

    return {
      codexPercentage: fiveHourQuota.percentage,
      codexResetTime: fiveHourQuota.resetTime,
      codexEstimatedAbsolute: fiveHourQuota.estimatedAbsolute,
      codexWeeklyPercentage: weeklyQuota.percentage,
      codexWeeklyResetTime: weeklyQuota.resetTime,
      codexWeeklyEstimatedAbsolute: weeklyQuota.estimatedAbsolute,
      codexMeasuredAt: fiveHour ? measuredAt : undefined,
      codexWeeklyMeasuredAt: weekly ? measuredAt : undefined,
      codexSource: "cli-json",
    };
  }

  private codexWindowQuota(limit: JsonObject | undefined): {
    percentage?: number;
    resetTime?: string;
    estimatedAbsolute?: number;
  } {
    if (!limit) {
      return {};
    }

    const usedPercent = this.numberValue(limit, ["used_percent"]);
    const resetsAt = this.numberValue(limit, ["resets_at"]);
    // Session token_count events are passive observations. Once their reported
    // window has expired they cannot establish the next window's quota.
    if (resetsAt !== undefined && resetsAt * 1000 <= Date.now()) return {};
    const percentage = usedPercent !== undefined && usedPercent >= 0 && usedPercent <= 100
      ? 100 - usedPercent
      : undefined;

    const remaining = this.numberValue(limit, [
      "remaining_tokens",
      "tokens_left",
      "remaining",
      "remaining_quota",
    ]);
    const max = this.numberValue(limit, ["max_tokens", "token_limit", "limit", "max", "quota"]);
    const used = this.numberValue(limit, ["used_tokens", "tokens_used", "used"]);

    return {
      percentage,
      resetTime: (resetsAt !== undefined && resetsAt * 1000 > Date.now()) ? new Date(resetsAt * 1000).toISOString() : undefined,
      estimatedAbsolute: remaining ?? (max !== undefined && used !== undefined ? Math.max(0, max - used) : undefined),
    };
  }

  private async walkJsonlFiles(directory: string): Promise<JsonlFileStat[]> {
    const files: JsonlFileStat[] = [];
    await this.collectJsonlFiles(directory, 0, files);
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_SESSION_FILES);
  }

  private async collectJsonlFiles(
    directory: string,
    depth: number,
    files: JsonlFileStat[],
  ): Promise<void> {
    if (depth > MAX_SESSION_SCAN_DEPTH) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (this.isFileNotFound(error)) {
        return;
      }

      throw error;
    }

    const inspected = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        try {
          return { entry, fullPath, stat: await fs.promises.stat(fullPath) };
        } catch {
          return undefined;
        }
      }),
    );

    const existing = inspected.filter((entry): entry is { entry: fs.Dirent; fullPath: string; stat: fs.Stats } => Boolean(entry));
    for (const item of existing) {
      if (item.entry.isFile() && item.entry.name.endsWith(".jsonl")) {
        files.push({ fullPath: item.fullPath, mtimeMs: item.stat.mtimeMs });
      }
    }

    const directories = existing
      .filter(({ entry }) => entry.isDirectory())
      .sort((a, b) => {
        const nameCmp = b.entry.name.localeCompare(a.entry.name, undefined, { numeric: true });
        if (nameCmp !== 0) return nameCmp;
        return b.stat.mtimeMs - a.stat.mtimeMs;
      });

    for (const child of directories) {
      await this.collectJsonlFiles(child.fullPath, depth + 1, files);
    }
  }

  private async readFileTail(filePath: string, maxBytes: number): Promise<string> {
    return (await this.readFileTailDetailed(filePath, maxBytes)).content;
  }

  private async readFileTailDetailed(filePath: string, maxBytes: number): Promise<{ content: string; truncated: boolean }> {
    const handle = await fs.promises.open(filePath, "r");
    try {
      const stat = await handle.stat();
      const length = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
      return { content: buffer.toString("utf8"), truncated: stat.size > maxBytes };
    } finally {
      await handle.close();
    }
  }

  protected async fetchAntigravityQuota(): Promise<
    Pick<
      QuotaData,
      | "antigravityPercentage"
      | "antigravityResetTime"
      | "antigravityWeeklyPercentage"
      | "antigravityWeeklyResetTime"
      | "opusPercentage"
      | "opusResetTime"
      | "opusWeeklyPercentage"
      | "opusWeeklyResetTime"
      | "measuredAt"
    >
  > {
    let antigravityPercentage: number | undefined;
    let antigravityResetTime: string | undefined;
    let antigravityWeeklyPercentage: number | undefined;
    let antigravityWeeklyResetTime: string | undefined;
    let opusPercentage: number | undefined;
    let opusResetTime: string | undefined;
    let opusWeeklyPercentage: number | undefined;
    let opusWeeklyResetTime: string | undefined;
    let measuredAt: string | undefined;
    const bucketCandidates: Array<{ provider: "gemini" | "claude"; window: "5h" | "weekly"; percentage?: number; resetTime?: string; isPrimary?: boolean }> = [];

    try {
      const result = await this.agyQuotaClient.fetchQuota();
      measuredAt = new Date(result.fetchedAt).toISOString();

      if (Array.isArray(result.quota?.groups)) {
        for (const group of result.quota.groups) {
          const label = group.displayName || "";
          const isPrimaryGemini = label === "Gemini Models" || (label.includes("Gemini") && !label.includes("Argon"));
          if (label.includes("Gemini")) {
            for (const bucket of group.buckets || []) {
              const window = bucket.window;
              const percentage = typeof bucket.remainingFraction === "number" && bucket.remainingFraction >= 0 && bucket.remainingFraction <= 1 ? bucket.remainingFraction * 100 : undefined;
              if (window === "5h") bucketCandidates.push({ provider: "gemini", window, percentage, resetTime: bucket.resetTime, isPrimary: isPrimaryGemini });
              else if (window === "weekly" || window === "7d") bucketCandidates.push({ provider: "gemini", window: "weekly", percentage, resetTime: bucket.resetTime, isPrimary: isPrimaryGemini });
            }
          } else if (label.includes("Claude") || label.includes("Opus")) {
            for (const bucket of group.buckets || []) {
              const window = bucket.window;
              const percentage = typeof bucket.remainingFraction === "number" && bucket.remainingFraction >= 0 && bucket.remainingFraction <= 1 ? bucket.remainingFraction * 100 : undefined;
              if (window === "5h") bucketCandidates.push({ provider: "claude", window, percentage, resetTime: bucket.resetTime, isPrimary: true });
              else if (window === "weekly" || window === "7d") bucketCandidates.push({ provider: "claude", window: "weekly", percentage, resetTime: bucket.resetTime, isPrimary: true });
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof AgyNotInstalledError || error instanceof AgyNotAuthenticatedError) {
        throw error;
      }
      throw new Error(`Failed to fetch agy quota natively: ${this.errorMessage(error)}`);
    }

    const oneUnambiguousValue = (provider: "gemini" | "claude", window: "5h" | "weekly") => {
      let candidates = bucketCandidates.filter((candidate) => candidate.provider === provider && candidate.window === window);
      if (!candidates.length) return undefined;
      const primary = candidates.filter((candidate) => candidate.isPrimary);
      if (primary.length > 0) candidates = primary;
      if (candidates.some((candidate) => candidate.percentage === undefined)) return undefined;
      const first = candidates[0];
      return candidates.every((candidate) => candidate.percentage === first.percentage && candidate.resetTime === first.resetTime)
        ? first
        : undefined;
    };
    const gemini5h = oneUnambiguousValue("gemini", "5h");
    const geminiWeekly = oneUnambiguousValue("gemini", "weekly");
    const claude5h = oneUnambiguousValue("claude", "5h");
    const claudeWeekly = oneUnambiguousValue("claude", "weekly");
    antigravityPercentage = gemini5h?.percentage;
    antigravityResetTime = gemini5h?.resetTime;
    antigravityWeeklyPercentage = geminiWeekly?.percentage;
    antigravityWeeklyResetTime = geminiWeekly?.resetTime;
    opusPercentage = claude5h?.percentage;
    opusResetTime = claude5h?.resetTime;
    opusWeeklyPercentage = claudeWeekly?.percentage;
    opusWeeklyResetTime = claudeWeekly?.resetTime;

    return {
      antigravityPercentage,
      antigravityResetTime,
      antigravityWeeklyPercentage,
      antigravityWeeklyResetTime,
      opusPercentage,
      opusResetTime,
      opusWeeklyPercentage,
      opusWeeklyResetTime,
      measuredAt,
    };
  }
  private execFileText(file: string, args: string[], options: ExecTextOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      cp.execFile(
        file,
        args,
        {
          timeout: options.timeoutMs ?? 10_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          shell: options.shell ?? process.platform === "win32",
        },
        (error, stdout, stderr) => {
          const stdoutText = String(stdout ?? "");
          const stderrText = String(stderr ?? "");

          if (error) {
            const detailText = [stdoutText, stderrText].filter((text) => text.trim()).join("\n");
            const detail = detailText ? `: ${detailText}` : "";
            reject(new Error(`${error.message}${detail}`));
            return;
          }

          resolve(stdoutText.length > 0 ? stdoutText : stderrText);
        },
      );
    });
  }



  private percentageValue(data: JsonObject, keys: string[]): number | undefined {
    const value = this.numberValue(data, keys);
    if (value === undefined || value < 0 || value > 100) {
      return undefined;
    }

    return value;
  }

  private numberValue(data: JsonObject, keys: string[]): number | undefined {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number.parseFloat(value.replace(/%$/, "").trim());
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return undefined;
  }

  private stringValue(data: JsonObject, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }

    return undefined;
  }

  private objectValue(value: unknown): JsonObject | undefined {
    return this.isObject(value) ? value : undefined;
  }

  private firstObjectValue(values: unknown[]): JsonObject | undefined {
    for (const value of values) {
      const object = this.objectValue(value);
      if (object) {
        return object;
      }
    }

    return undefined;
  }

  private safePositiveNumber(value: unknown): number {
    if (typeof value !== "number" && typeof value !== "string") return 0;
    if (typeof value === "string" && !value.trim()) return 0;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  private optionalNonnegativeNumber(value: unknown): number | undefined {
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
    if (typeof value !== "string" || !value.trim()) return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
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

  private isObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private isFileNotFound(error: unknown): boolean {
    return /file.*not.*found|enoent/i.test(this.errorMessage(error));
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private handleAgyMissing(): void {
    if (this.hasShownAgyMissingPrompt) return;
    this.hasShownAgyMissingPrompt = true;
    void Promise.resolve(this.host.notifyAgyMissing()).catch(() => {});
  }

  private handleAgyAuthRequired(): void {
    if (this.hasShownAgyAuthPrompt) return;
    this.hasShownAgyAuthPrompt = true;
    void Promise.resolve(this.host.notifyAgyAuthRequired()).catch(() => {});
  }
}


