import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { JsonObject, TokenStatus, QuotaPoolStatus, LocalComputeStatus, QuotaSource, UsageConfidence, GpuStatus } from "./types";
import { AgyQuotaClient, AgyNotInstalledError, AgyNotAuthenticatedError } from "./AgyQuotaClient";
import matter from "gray-matter";

const QUOTA_CACHE_TTL_MS = 60_000;
const MAX_SESSION_SCAN_DEPTH = 5;
const MAX_SESSION_FILES = 80;
const MAX_SESSION_FILE_BYTES = 256 * 1024;
const MAX_SESSION_LINES_PER_FILE = 1_000;
const AGY_CREDITS_TIMEOUT_MS = 15_000;

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

interface StatusOptions {
  refreshQuota?: boolean;
  forceRefresh?: boolean;
}

export class TokenManager {
  private quotaCache?: { lastFetchTime: number; data: QuotaData };
  private fetchPromise?: Promise<QuotaData>;
  private hasShownAgyMissingPrompt = false;
  private hasShownAgyAuthPrompt = false;

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

    const quotaData = await this.getQuotaData(activity, fallbackQuota, options.forceRefresh);
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

  private async getQuotaData(activity: string[], fallback: QuotaData, forceRefresh?: boolean): Promise<QuotaData> {
    if (!forceRefresh) {
      const cached = this.getFreshCachedQuota(activity);
      if (cached) {
        return cached;
      }
    }

    if (this.fetchPromise) {
      if (forceRefresh) {
        this.fetchPromise = this.fetchQuotaData(forceRefresh);
      } else {
        activity.push("Waiting for in-flight quota telemetry request.");
      }
    } else {
      this.fetchPromise = this.fetchQuotaData(forceRefresh);
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

  private async fetchQuotaData(forceRefresh = false): Promise<QuotaData> {
    const data: QuotaData = { errors: [], quotaPools: [] };

    // Use collectors to gather quota and compute metrics
    await Promise.all([
      this.fetchCodexQuota(forceRefresh)
        .then((codexQuota) => {
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
        })
        .catch((error: unknown) => {
          data.errors.push(`Codex: ${this.errorMessage(error)}`);
        }),
      this.fetchAntigravityQuota()
        .then((antigravityQuota) => {
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
        })
        .catch((error: unknown) => {
          if (error instanceof AgyNotInstalledError) {
            this.handleAgyMissing();
            data.errors.push(`Antigravity: CLI is missing.`);
          } else if (error instanceof AgyNotAuthenticatedError) {
            this.handleAgyAuthRequired();
            data.errors.push(`Antigravity: Authentication required.`);
          } else {
            data.errors.push(`Antigravity: ${this.errorMessage(error)}`);
          }
        }),
      this.fetchLocalLlmStatus()
        .then(({ localComputeStatus, quotaPool }) => {
          data.localComputeStatus = localComputeStatus;
          if (quotaPool) {
            data.quotaPools!.push(quotaPool);
          }
        })
        .catch((error: unknown) => {
          data.errors.push(`LocalLLM: ${this.errorMessage(error)}`);
        })
    ]);

    return data;
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


