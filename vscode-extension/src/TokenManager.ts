import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
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

const QUOTA_CACHE_TTL_MS = 60_000;
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
  errors: string[];
}

interface JsonlFileStat {
  fullPath: string;
  mtimeMs: number;
}

interface ClaudeUsageEvent {
  timestamp: number;
  source: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  billableTokens: number;
}

interface StatusOptions {
  refreshQuota?: boolean;
  forceRefresh?: boolean;
}

export class TokenManager {
  private quotaCache?: { lastFetchTime: number; data: QuotaData };
  private fetchPromise?: Promise<QuotaData>;
  private hasShownAgyMissingPrompt = false;
  private hasShownAgyAuthPrompt = false;
  private readonly circuitBreakers = new Map<string, { failures: number; cooldownUntil: number }>();

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

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
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
    fileUri: vscode.Uri | undefined,
    options: StatusOptions = {},
  ): Promise<TokenStatus | undefined> {
    const activity: string[] = ["Token manager initialized."];
    const tokenStatus: TokenStatus = {
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

  private async readDashboardFile(fileUri: vscode.Uri): Promise<{ data: JsonObject; content: string }> {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
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
      tokenStatus.antigravityTokensLeft = antigravityEstimated;
      tokenStatus.antigravityMax = this.estimateMaxTokens(antigravityEstimated, antigravityPercentage);
    }
    if (antigravityReset !== undefined) {
      tokenStatus.antigravityResetTime = antigravityReset;
    }
    if (antigravityWeeklyPercentage !== undefined) {
      tokenStatus.antigravityWeeklyPercentage = antigravityWeeklyPercentage;
    }
    if (antigravityWeeklyEstimated !== undefined) {
      tokenStatus.antigravityWeeklyTokensLeft = antigravityWeeklyEstimated;
      tokenStatus.antigravityWeeklyMax = this.estimateMaxTokens(antigravityWeeklyEstimated, antigravityWeeklyPercentage);
    }
    if (antigravityWeeklyReset !== undefined) {
      tokenStatus.antigravityWeeklyResetTime = antigravityWeeklyReset;
    }

    if (opusPercentage !== undefined) {
      tokenStatus.opusPercentage = opusPercentage;
    }
    if (opusEstimated !== undefined) {
      tokenStatus.opusEstimatedAbsolute = opusEstimated;
      tokenStatus.opusTokensLeft = opusEstimated;
      tokenStatus.opusMax = this.estimateMaxTokens(opusEstimated, opusPercentage);
    }
    if (opusReset !== undefined) {
      tokenStatus.opusResetTime = opusReset;
    }
    if (opusWeeklyPercentage !== undefined) {
      tokenStatus.opusWeeklyPercentage = opusWeeklyPercentage;
    }
    if (opusWeeklyEstimated !== undefined) {
      tokenStatus.opusWeeklyTokensLeft = opusWeeklyEstimated;
      tokenStatus.opusWeeklyMax = this.estimateMaxTokens(opusWeeklyEstimated, opusWeeklyPercentage);
    }
    if (opusWeeklyReset !== undefined) {
      tokenStatus.opusWeeklyResetTime = opusWeeklyReset;
    }

    if (codexPercentage !== undefined) {
      tokenStatus.codexPercentage = codexPercentage;
    }
    if (codexEstimated !== undefined) {
      tokenStatus.codexEstimatedAbsolute = codexEstimated;
      tokenStatus.codexTokensLeft = codexEstimated;
      tokenStatus.codexMax = this.estimateMaxTokens(codexEstimated, codexPercentage);
    }
    if (codexReset !== undefined) {
      tokenStatus.codexResetTime = codexReset;
    }
    if (codexWeeklyPercentage !== undefined) {
      tokenStatus.codexWeeklyPercentage = codexWeeklyPercentage;
    }
    if (codexWeeklyEstimated !== undefined) {
      tokenStatus.codexWeeklyTokensLeft = codexWeeklyEstimated;
      tokenStatus.codexWeeklyMax = this.estimateMaxTokens(codexWeeklyEstimated, codexWeeklyPercentage);
    }
    if (codexWeeklyReset !== undefined) {
      tokenStatus.codexWeeklyResetTime = codexWeeklyReset;
    }

    tokenStatus.recommendedTaskWeight = this.taskWeightFromCodexPercentage(tokenStatus.codexPercentage, tokenStatus.codexWeeklyPercentage);
  }

  private estimateMaxTokens(estimated: number, percentage: number | undefined): number {
    if (percentage === undefined || percentage <= 0) {
      return 0;
    }

    return Math.round(estimated / (percentage / 100));
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
      tokenStatus.antigravityTokensLeft = quotaData.antigravityEstimatedAbsolute;
      tokenStatus.antigravityMax = this.estimateMaxTokens(
        quotaData.antigravityEstimatedAbsolute,
        tokenStatus.antigravityPercentage,
      );
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
      tokenStatus.opusTokensLeft = quotaData.opusEstimatedAbsolute;
      tokenStatus.opusMax = this.estimateMaxTokens(
        quotaData.opusEstimatedAbsolute,
        tokenStatus.opusPercentage,
      );
    }
    if (quotaData.opusWeeklyEstimatedAbsolute !== undefined) {
      tokenStatus.opusWeeklyEstimatedAbsolute = quotaData.opusWeeklyEstimatedAbsolute;
      tokenStatus.opusWeeklyTokensLeft = quotaData.opusWeeklyEstimatedAbsolute;
      tokenStatus.opusWeeklyMax = this.estimateMaxTokens(
        quotaData.opusWeeklyEstimatedAbsolute,
        tokenStatus.opusWeeklyPercentage,
      );
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
      tokenStatus.codexTokensLeft = quotaData.codexEstimatedAbsolute;
      tokenStatus.codexMax = this.estimateMaxTokens(
        quotaData.codexEstimatedAbsolute,
        tokenStatus.codexPercentage,
      );
    }
    if (quotaData.codexWeeklyEstimatedAbsolute !== undefined) {
      tokenStatus.codexWeeklyEstimatedAbsolute = quotaData.codexWeeklyEstimatedAbsolute;
      tokenStatus.codexWeeklyTokensLeft = quotaData.codexWeeklyEstimatedAbsolute;
      tokenStatus.codexWeeklyMax = this.estimateMaxTokens(
        quotaData.codexWeeklyEstimatedAbsolute,
        tokenStatus.codexWeeklyPercentage,
      );
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

  private withFallbackQuota(fetched: QuotaData, fallback: QuotaData): QuotaData {
    return {
      quotaPools: fetched.quotaPools ?? fallback.quotaPools,
      localComputeStatus: fetched.localComputeStatus ?? fallback.localComputeStatus,
      claudeDirectUsage: fetched.claudeDirectUsage ?? fallback.claudeDirectUsage,
      antigravityPercentage: fetched.antigravityPercentage ?? fallback.antigravityPercentage,
      antigravityResetTime: fetched.antigravityResetTime ?? fallback.antigravityResetTime,
      antigravityWeeklyPercentage: fetched.antigravityWeeklyPercentage ?? fallback.antigravityWeeklyPercentage,
      antigravityWeeklyResetTime: fetched.antigravityWeeklyResetTime ?? fallback.antigravityWeeklyResetTime,
      antigravityEstimatedAbsolute: fetched.antigravityEstimatedAbsolute ?? fallback.antigravityEstimatedAbsolute,
      opusPercentage: fetched.opusPercentage ?? fallback.opusPercentage,
      opusResetTime: fetched.opusResetTime ?? fallback.opusResetTime,
      opusEstimatedAbsolute: fetched.opusEstimatedAbsolute ?? fallback.opusEstimatedAbsolute,
      opusWeeklyPercentage: fetched.opusWeeklyPercentage ?? fallback.opusWeeklyPercentage,
      opusWeeklyResetTime: fetched.opusWeeklyResetTime ?? fallback.opusWeeklyResetTime,
      opusWeeklyEstimatedAbsolute: fetched.opusWeeklyEstimatedAbsolute ?? fallback.opusWeeklyEstimatedAbsolute,
      codexPercentage: fetched.codexPercentage ?? fallback.codexPercentage,
      codexResetTime: fetched.codexResetTime ?? fallback.codexResetTime,
      codexWeeklyPercentage: fetched.codexWeeklyPercentage ?? fallback.codexWeeklyPercentage,
      codexWeeklyResetTime: fetched.codexWeeklyResetTime ?? fallback.codexWeeklyResetTime,
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
          const codexQuota = await this.withTimeout(this.fetchCodexQuota(forceRefresh), 3000, {});
          this.recordProviderSuccess("codex");
          data.codexPercentage = codexQuota.codexPercentage;
          data.codexResetTime = codexQuota.codexResetTime;
          data.codexEstimatedAbsolute = codexQuota.codexEstimatedAbsolute;
          data.codexWeeklyPercentage = codexQuota.codexWeeklyPercentage;
          data.codexWeeklyResetTime = codexQuota.codexWeeklyResetTime;
          data.codexWeeklyEstimatedAbsolute = codexQuota.codexWeeklyEstimatedAbsolute;
          if (codexQuota.codexPercentage !== undefined || codexQuota.codexResetTime !== undefined || codexQuota.codexEstimatedAbsolute !== undefined) {
            data.quotaPools!.push({
              id: "codex.5h",
              provider: "codex",
              remainingPercentage: codexQuota.codexPercentage,
              remainingTokens: codexQuota.codexEstimatedAbsolute,
              resetTime: codexQuota.codexResetTime,
              source: "cli-json",
              confidence: "reported-quota"
            });
          }
          if (codexQuota.codexWeeklyPercentage !== undefined || codexQuota.codexWeeklyResetTime !== undefined || codexQuota.codexWeeklyEstimatedAbsolute !== undefined) {
            data.quotaPools!.push({
              id: "codex.weekly",
              provider: "codex",
              remainingPercentage: codexQuota.codexWeeklyPercentage,
              remainingTokens: codexQuota.codexWeeklyEstimatedAbsolute,
              resetTime: codexQuota.codexWeeklyResetTime,
              source: "cli-json",
              confidence: "reported-quota"
            });
          }
        } catch (error) {
          this.recordProviderFailure("codex");
          data.errors.push(`Codex: ${this.errorMessage(error)}`);
        }
      })(),

      // 2. Antigravity
      (async () => {
        if (this.isCircuitOpen("antigravity") && !forceRefresh) {
          return;
        }
        try {
          const antigravityQuota = await this.withTimeout(this.fetchAntigravityQuota(), 3000, {});
          this.recordProviderSuccess("antigravity");
          data.antigravityPercentage = antigravityQuota.antigravityPercentage;
          data.antigravityResetTime = antigravityQuota.antigravityResetTime;
          data.antigravityWeeklyPercentage = antigravityQuota.antigravityWeeklyPercentage;
          data.antigravityWeeklyResetTime = antigravityQuota.antigravityWeeklyResetTime;
          data.opusPercentage = antigravityQuota.opusPercentage;
          data.opusResetTime = antigravityQuota.opusResetTime;
          data.opusWeeklyPercentage = antigravityQuota.opusWeeklyPercentage;
          data.opusWeeklyResetTime = antigravityQuota.opusWeeklyResetTime;
          data.quotaPools!.push({
            id: "antigravity.default",
            provider: "antigravity",
            remainingPercentage: antigravityQuota.antigravityPercentage,
            resetTime: antigravityQuota.antigravityResetTime,
            source: "cli-text",
            confidence: "reported-quota"
          });
          data.quotaPools!.push({
            id: "antigravity.weekly",
            provider: "antigravity",
            remainingPercentage: antigravityQuota.antigravityWeeklyPercentage,
            resetTime: antigravityQuota.antigravityWeeklyResetTime,
            source: "cli-text",
            confidence: "reported-quota"
          });
          data.quotaPools!.push({
            id: "opus.default",
            provider: "anthropic",
            remainingPercentage: antigravityQuota.opusPercentage,
            resetTime: antigravityQuota.opusResetTime,
            source: "cli-text",
            confidence: "reported-quota"
          });
          data.quotaPools!.push({
            id: "opus.weekly",
            provider: "anthropic",
            remainingPercentage: antigravityQuota.opusWeeklyPercentage,
            resetTime: antigravityQuota.opusWeeklyResetTime,
            source: "cli-text",
            confidence: "reported-quota"
          });
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
          return;
        }
        try {
          const { localComputeStatus, quotaPool } = await this.withTimeout(
            this.fetchLocalLlmStatus(),
            2500,
            { localComputeStatus: { endpointHealth: "offline", programName: "Offline", loadedModels: [], gpus: [] } }
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
          return;
        }
        try {
          const usage = await this.withTimeout(
            this.fetchClaudeDirectUsage(workspaceStateRoot),
            2000,
            {
              status: "no-data",
              today: this.emptyUsageSummary(),
              sevenDays: this.emptyUsageSummary(),
              sources: [],
              lastMeasuredAt: new Date().toISOString(),
              errors: [],
            }
          );
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

  private async fetchClaudeDirectUsage(workspaceStateRoot: string | undefined): Promise<ClaudeDirectUsageStatus> {
    const events: ClaudeUsageEvent[] = [];
    const errors: string[] = [];
    const sources = new Set<string>();

    const readJsonl = async (filePath: string, source: string, trustClaudePath = false): Promise<void> => {
      try {
        const content = await this.readFileTail(filePath, CLAUDE_USAGE_MAX_FILE_BYTES);
        const lines = content.split(/\r?\n/).reverse().slice(0, CLAUDE_USAGE_MAX_LINES_PER_FILE).reverse();
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

    return {
      status: events.length ? "measured" : "no-data",
      today,
      sevenDays,
      sources: Array.from(sources).sort(),
      lastUsedAt,
      lastMeasuredAt: new Date().toISOString(),
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
        if (!Number.isFinite(timestamp)) {
          continue;
        }

        const inputTokens = this.safePositiveNumber(value("InputTokens"));
        const cachedInputTokens = this.safePositiveNumber(value("CachedInputTokens"));
        const outputTokens = this.safePositiveNumber(value("OutputTokens"));
        const reasoningOutputTokens = this.safePositiveNumber(value("ReasoningOutputTokens"));
        const totalTokens =
          this.safePositiveNumber(value("TotalTokens")) ||
          inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;

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
          billableTokens: this.safePositiveNumber(value("BillableTokens")),
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
    const cachedInputTokens = this.safePositiveNumber(
      usage.cached_tokens ??
        usage.cache_read_input_tokens ??
        usage.cache_creation_input_tokens ??
        usage.cachedInputTokens,
    );
    const outputTokens = this.safePositiveNumber(
      usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.completionTokens,
    );
    const reasoningOutputTokens = this.safePositiveNumber(
      usage.reasoning_tokens ?? usage.reasoning_output_tokens ?? usage.reasoningOutputTokens,
    );
    const totalTokens =
      this.safePositiveNumber(usage.total_tokens ?? usage.totalTokens) ||
      inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;
    const billableTokens = this.safePositiveNumber(usage.billable_tokens ?? usage.billableTokens);

    if (totalTokens <= 0) {
      return undefined;
    }

    const timestamp = this.timestampFromUsageEvent(event);
    return {
      timestamp,
      source,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens,
      billableTokens,
    };
  }

  private timestampFromUsageEvent(event: JsonObject): number {
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

    return Date.now();
  }

  private summarizeClaudeUsage(events: ClaudeUsageEvent[]): UsageWindowSummary {
    return events.reduce<UsageWindowSummary>(
      (summary, event) => ({
        inputTokens: summary.inputTokens + event.inputTokens,
        cachedInputTokens: summary.cachedInputTokens + event.cachedInputTokens,
        outputTokens: summary.outputTokens + event.outputTokens,
        reasoningOutputTokens: summary.reasoningOutputTokens + event.reasoningOutputTokens,
        totalTokens: summary.totalTokens + event.totalTokens,
        billableTokens: summary.billableTokens + event.billableTokens,
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
      billableTokens: 0,
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

  private workspaceStateRootFromTokenReport(fileUri: vscode.Uri | undefined): string | undefined {
    if (!fileUri?.fsPath) {
      return undefined;
    }

    return path.dirname(path.dirname(fileUri.fsPath));
  }

  private async fetchGpuMetrics(): Promise<GpuStatus[] | undefined> {
    try {
      const output = await this.execFileText(
        "nvidia-smi",
        ["--query-gpu=index,name,utilization.gpu,memory.used,memory.total,power.draw,power.limit,enforced.power.limit", "--format=csv,noheader,nounits"],
        { timeoutMs: 5_000 },
      );
      const rows = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(",").map((part) => part.trim()));

      if (rows.length === 0) {
        return undefined;
      }

      const gpus: GpuStatus[] = rows.map(parts => {
        const powerLimit = parseFloat(parts[6]);
        const enforcedLimit = parseFloat(parts[7]);
        const userConfiguredLimit = Number.isFinite(powerLimit) && powerLimit > 0 ? powerLimit : (Number.isFinite(enforcedLimit) ? enforcedLimit : 0);
        return {
          id: parseInt(parts[0], 10),
          name: parts[1],
          utilizationPercentage: parseFloat(parts[2]),
          vramUsedMb: parseFloat(parts[3]),
          vramTotalMb: parseFloat(parts[4]),
          powerDrawW: parseFloat(parts[5]),
          powerLimitW: userConfiguredLimit
        };
      }).filter(gpu => Number.isFinite(gpu.utilizationPercentage));
      
      return gpus.length > 0 ? gpus : undefined;
    } catch {
      return undefined;
    }
  }

  // Collector for Local LLM
  private async fetchLocalLlmStatus(): Promise<{ localComputeStatus: LocalComputeStatus; quotaPool?: QuotaPoolStatus }> {
    const gpuMetrics = await this.fetchGpuMetrics();
    const withGpuMetrics = (status: LocalComputeStatus): LocalComputeStatus => ({
      ...status,
      gpus: gpuMetrics,
    });

    const probes: Array<{
      programName: string;
      quotaPoolId: string;
      url: string;
      modelsFromJson: (parsed: JsonObject) => string[];
    }> = [
      {
        programName: "Ollama",
        quotaPoolId: "local.ollama",
        url: "http://localhost:11434/api/ps",
        modelsFromJson: (parsed) => {
          const models = Array.isArray(parsed.models) ? parsed.models : [];
          return models.map((model: any) => String(model?.name || "")).filter(Boolean);
        },
      },
      {
        programName: "LM Studio",
        quotaPoolId: "local.lm-studio",
        url: "http://localhost:1234/v1/models",
        modelsFromJson: (parsed) => {
          const models = Array.isArray(parsed.data) ? parsed.data : [];
          return models.map((model: any) => String(model?.id || "")).filter(Boolean);
        },
      },
      {
        programName: "vLLM",
        quotaPoolId: "local.vllm",
        url: "http://localhost:8000/v1/models",
        modelsFromJson: (parsed) => {
          const models = Array.isArray(parsed.data) ? parsed.data : [];
          return models.map((model: any) => String(model?.id || "")).filter(Boolean);
        },
      },
    ];

    for (const probe of probes) {
      try {
        const response = await this.execFileText("curl", ["-s", "--max-time", "2", probe.url], { timeoutMs: 3_000 });
        const parsed = JSON.parse(response) as JsonObject;
        const loadedModels = probe.modelsFromJson(parsed);

        return {
          localComputeStatus: withGpuMetrics({
            endpointHealth: "ok",
            programName: probe.programName,
            loadedModels,
          }),
          quotaPool: {
            id: probe.quotaPoolId,
            provider: "local",
            source: "local-service",
            confidence: "exact",
          },
        };
      } catch {
        // Continue probing the next common local LLM endpoint.
      }
    }

    return {
      localComputeStatus: withGpuMetrics({
        endpointHealth: "offline",
        loadedModels: [],
      }),
    };
  }

  private findCodexCli(): string | undefined {
    const envPath = process.env.CODEX_PATH;
    if (envPath && fs.existsSync(envPath)) {
      return envPath;
    }

    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const codexBinDir = path.join(localAppData, "OpenAI", "Codex", "bin");
      if (fs.existsSync(codexBinDir)) {
        try {
          const dirs = fs
            .readdirSync(codexBinDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => path.join(codexBinDir, d.name, "codex.exe"))
            .filter((p) => fs.existsSync(p));
          if (dirs.length > 0) {
            return dirs[0];
          }
        } catch {
          // Ignore filesystem errors
        }
      }
    }

    const localBinExe = path.join(os.homedir(), ".local", "bin", "codex.exe");
    if (fs.existsSync(localBinExe)) {
      return localBinExe;
    }
    const localBinCmd = path.join(os.homedir(), ".local", "bin", "codex.cmd");
    if (fs.existsSync(localBinCmd)) {
      return localBinCmd;
    }

    return "codex";
  }

  private async triggerCodexLiveRefresh(): Promise<void> {
    const cli = this.findCodexCli();
    if (!cli) {
      return;
    }

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
        } catch {
          // Ignore kill error
        }
        finish();
      }, 12000);

      const child = cp.spawn(cli, ["exec", "--skip-git-repo-check", "reply ok"], {
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
        shell: cli === "codex" || cli.endsWith(".cmd")
      });

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

  private async fetchCodexQuota(forceRefresh = false): Promise<
    Pick<
      QuotaData,
      | "codexPercentage"
      | "codexResetTime"
      | "codexEstimatedAbsolute"
      | "codexWeeklyPercentage"
      | "codexWeeklyResetTime"
      | "codexWeeklyEstimatedAbsolute"
    >
  > {
    if (forceRefresh) {
      await this.triggerCodexLiveRefresh();
    }

    const sessionsDir = path.join(os.homedir(), ".codex", "sessions");
    const files = await this.walkJsonlFiles(sessionsDir);

    if (files.length === 0) {
      throw new Error("No Codex session files found");
    }

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
          if (quota) {
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
  ):
    | Pick<
        QuotaData,
        | "codexPercentage"
        | "codexResetTime"
        | "codexEstimatedAbsolute"
        | "codexWeeklyPercentage"
        | "codexWeeklyResetTime"
        | "codexWeeklyEstimatedAbsolute"
      >
    | undefined {
    const payload = this.objectValue(event.payload);
    const rateLimits = this.objectValue(payload?.rate_limits);
    const primary = this.objectValue(rateLimits?.primary);
    const secondary = this.objectValue(rateLimits?.secondary);

    if (event.type !== "event_msg" || payload?.type !== "token_count" || !primary) {
      return undefined;
    }

    const limits = [primary, secondary].filter((limit): limit is JsonObject => Boolean(limit));
    const fiveHour =
      limits.find((limit) => {
        const win = this.numberValue(limit, ["window_minutes"]);
        return win !== undefined && win <= 1440;
      }) ?? (this.numberValue(primary, ["window_minutes"]) === undefined ? primary : undefined);
    const weekly =
      limits.find((limit) => {
        const win = this.numberValue(limit, ["window_minutes"]);
        return win !== undefined && win > 1440;
      }) ?? (secondary && this.numberValue(secondary, ["window_minutes"]) === undefined ? secondary : undefined);

    const fiveHourQuota = this.codexWindowQuota(fiveHour);
    const weeklyQuota = this.codexWindowQuota(weekly);

    return {
      codexPercentage: fiveHourQuota.percentage,
      codexResetTime: fiveHourQuota.resetTime,
      codexEstimatedAbsolute: fiveHourQuota.estimatedAbsolute,
      codexWeeklyPercentage: weeklyQuota.percentage,
      codexWeeklyResetTime: weeklyQuota.resetTime,
      codexWeeklyEstimatedAbsolute: weeklyQuota.estimatedAbsolute,
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
    const isReset = resetsAt !== undefined && resetsAt * 1000 < Date.now();

    const percentage =
      usedPercent !== undefined
        ? isReset
          ? 100
          : Math.max(0, Math.min(100, 100 - usedPercent))
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
      resetTime: resetsAt !== undefined ? new Date(resetsAt * 1000).toISOString() : undefined,
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
    if (depth > MAX_SESSION_SCAN_DEPTH || files.length >= MAX_SESSION_FILES) {
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
    const jsonlFiles = existing
      .filter(({ entry }) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    for (const file of jsonlFiles) {
      if (files.length >= MAX_SESSION_FILES) {
        return;
      }

      files.push({ fullPath: file.fullPath, mtimeMs: file.stat.mtimeMs });
    }

    const directories = existing
      .filter(({ entry }) => entry.isDirectory())
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    for (const child of directories) {
      if (files.length >= MAX_SESSION_FILES) {
        return;
      }

      await this.collectJsonlFiles(child.fullPath, depth + 1, files);
    }
  }

  private async readFileTail(filePath: string, maxBytes: number): Promise<string> {
    const handle = await fs.promises.open(filePath, "r");
    try {
      const stat = await handle.stat();
      const length = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  }

  private async fetchAntigravityQuota(): Promise<
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

    try {
      const client = new AgyQuotaClient(path.join(__dirname, ".."));
      const result = await client.fetchQuota();

      if (Array.isArray(result.quota?.groups)) {
        for (const group of result.quota.groups) {
          const label = group.displayName || "";
          if (label.includes("Gemini")) {
            for (const bucket of group.buckets || []) {
              const window = bucket.window;
              const percentage = typeof bucket.remainingFraction === "number" ? bucket.remainingFraction * 100 : undefined;
              if (window === "5h") {
                antigravityPercentage = percentage;
                antigravityResetTime = bucket.resetTime;
              } else if (window === "weekly" || window === "7d") {
                antigravityWeeklyPercentage = percentage;
                antigravityWeeklyResetTime = bucket.resetTime;
              }
            }
          } else if (label.includes("Claude") || label.includes("Opus")) {
            for (const bucket of group.buckets || []) {
              const window = bucket.window;
              const percentage = typeof bucket.remainingFraction === "number" ? bucket.remainingFraction * 100 : undefined;
              if (window === "5h") {
                opusPercentage = percentage;
                opusResetTime = bucket.resetTime;
              } else if (window === "weekly" || window === "7d") {
                opusWeeklyPercentage = percentage;
                opusWeeklyResetTime = bucket.resetTime;
              }
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

    return {
      antigravityPercentage,
      antigravityResetTime,
      antigravityWeeklyPercentage,
      antigravityWeeklyResetTime,
      opusPercentage,
      opusResetTime,
      opusWeeklyPercentage,
      opusWeeklyResetTime,
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
    if (value === undefined) {
      return undefined;
    }

    return Math.min(Math.max(value, 0), 100);
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
    const number = typeof value === "string" && value.trim() ? Number(value) : Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
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
    vscode.window.showErrorMessage(
      "Antigravity CLI (agy) is not installed. It is required for accurate quota telemetry.",
      "Install Agy CLI"
    ).then(selection => {
      if (selection === "Install Agy CLI") {
        const terminal = vscode.window.createTerminal("Install Antigravity CLI");
        terminal.show();
        terminal.sendText("powershell -NoProfile -ExecutionPolicy Bypass -Command \"iex ((New-Object System.Net.WebClient).DownloadString('https://antigravity.google/cli/install.ps1'))\"");
      }
    });
  }

  private handleAgyAuthRequired(): void {
    if (this.hasShownAgyAuthPrompt) return;
    this.hasShownAgyAuthPrompt = true;
    vscode.window.showErrorMessage(
      "Antigravity CLI is not authenticated. Please sign in to view accurate quota usage.",
      "Sign In"
    ).then(selection => {
      if (selection === "Sign In") {
        const terminal = vscode.window.createTerminal("Antigravity Auth");
        terminal.show();
        terminal.sendText("& \"$env:LOCALAPPDATA\\agy\\bin\\agy.exe\" auth login");
      }
    });
  }
}


