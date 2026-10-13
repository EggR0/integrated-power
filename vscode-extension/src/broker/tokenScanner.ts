import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { TokenManager, createHeadlessTokenManagerHost } from "../TokenManager";
import type { TokenStatus } from "../types";
import { resolveIntegratedPowerStateRoot } from "../storagePath";

export interface GpuStatus {
  id: number;
  name: string;
  utilizationPercentage: number;
  vramUsedMb: number;
  vramTotalMb: number;
  powerDrawW?: number;
  powerLimitW?: number;
}

export interface QuotaPoolInfo {
  id: string;
  provider: string;
  remainingPercentage: number;
  resetTime?: string;
  source?: string;
  confidence?: string;
}

export interface LiveTokenStatus {
  antigravityPercentage?: number;
  antigravityResetTime?: string;
  antigravityWeeklyPercentage?: number;
  antigravityWeeklyResetTime?: string;
  antigravityTokensLeft?: number;
  antigravityMax?: number;
  antigravityWeeklyTokensLeft?: number;
  antigravityWeeklyMax?: number;
  antigravityEstimatedAbsolute?: number;

  opusPercentage?: number;
  opusResetTime?: string;
  opusWeeklyPercentage?: number;
  opusWeeklyResetTime?: string;
  opusTokensLeft?: number;
  opusMax?: number;
  opusWeeklyTokensLeft?: number;
  opusWeeklyMax?: number;
  opusEstimatedAbsolute?: number;
  opusWeeklyEstimatedAbsolute?: number;

  codexPercentage?: number;
  codexResetTime?: string;
  codexWeeklyPercentage?: number;
  codexWeeklyResetTime?: string;
  codexTokensLeft?: number;
  codexMax?: number;
  codexWeeklyTokensLeft?: number;
  codexWeeklyMax?: number;
  codexEstimatedAbsolute?: number;
  codexWeeklyEstimatedAbsolute?: number;
  codexStatus?: string;

  taskRouting: "normal" | "degraded" | "critical";
  lastSync: string;
  errors?: string[];
  quotaPools?: QuotaPoolInfo[];
  localComputeStatus: {
    status: "online" | "offline" | "busy";
    modelName: string;
    vramUsedMb: number;
    vramTotalMb: number;
    gpus: GpuStatus[];
    endpointHealth?: string;
    loadedModels?: string[];
    programName?: string;
  };
  directUsage?: {
    todayTokens: number;
    todayPaidTokens: number;
    todayThinkingTokens: number;
    sevenDaysTokens: number;
    sevenDaysPaidTokens: number;
    eventCount: number;
    status?: string;
    sources?: string[];
    lastUsedAt?: string;
    lastMeasuredAt?: string;
    errors?: string[];
  };
  activity?: string[];
}

export interface TokenStatusScannerOptions {
  force?: boolean;
  /** Test seam; production callers use the validated headless TokenManager. */
  tokenManager?: Pick<TokenManager, "getStatus">;
  now?: () => Date;
  maxAgeMs?: number;
  tokenStatusPath?: string | null;
}

const headlessManagers = new Map<string, TokenManager>();

// In-process force-refresh hook. The broker runs in the same Node process as
// the VS Code extension host, so it can ask the live IDE TokenManager to run a
// forced (cache-bypassing) refresh before the broker re-reads the state file.
// Registered by the extension entry point; a no-op when the IDE is not running.
let forceRefreshHandler: (() => Promise<void>) | undefined;
export function setForceRefreshHandler(handler: (() => Promise<void>) | undefined): void {
  forceRefreshHandler = handler;
}
export async function requestForceRefresh(): Promise<boolean> {
  if (!forceRefreshHandler) return false;
  try {
    await forceRefreshHandler();
    return true;
  } catch {
    return false;
  }
}

function findTokenStatusJsonPath(): string | undefined {
  const canonicalPath = path.join(resolveIntegratedPowerStateRoot(), "token_status.json");
  if (fs.existsSync(canonicalPath)) return canonicalPath;
  if (process.env.INTEGRATED_POWER_STATE_ROOT?.trim() || process.env.EGGR_STATE_ROOT?.trim()) return undefined;
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const candidates = [
    path.join(localAppData, "IntegratedPower", "state", "token_status.json"),
    path.join(os.homedir(), ".config", "integrated-power", "state", "token_status.json"),
    path.join(localAppData, "EggR", "state", "token_status.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapTokenManagerStatus(status: TokenStatus, completedAt: string): LiveTokenStatus {
  const gpus: GpuStatus[] = (status.localComputeStatus?.gpus ?? []).map((gpu) => ({
    id: gpu.id,
    name: gpu.name,
    utilizationPercentage: gpu.utilizationPercentage,
    vramUsedMb: gpu.vramUsedMb,
    vramTotalMb: gpu.vramTotalMb,
    powerDrawW: gpu.powerDrawW,
    powerLimitW: gpu.powerLimitW,
  }));
  const local = status.localComputeStatus;
  const usage = status.claudeDirectUsage;
  const quotaPools = status.quotaPools?.map((pool) => ({
    id: pool.id,
    provider: pool.provider,
    remainingPercentage: pool.remainingPercentage ?? 0,
    resetTime: pool.resetTime,
    source: pool.source,
    confidence: pool.confidence,
  }));
  return {
    antigravityPercentage: status.antigravityPercentage,
    antigravityResetTime: status.antigravityResetTime,
    antigravityWeeklyPercentage: status.antigravityWeeklyPercentage,
    antigravityWeeklyResetTime: status.antigravityWeeklyResetTime,
    antigravityTokensLeft: status.antigravityTokensLeft,
    antigravityMax: status.antigravityMax,
    antigravityWeeklyTokensLeft: status.antigravityWeeklyTokensLeft,
    antigravityWeeklyMax: status.antigravityWeeklyMax,
    antigravityEstimatedAbsolute: status.antigravityEstimatedAbsolute,
    opusPercentage: status.opusPercentage,
    opusResetTime: status.opusResetTime,
    opusWeeklyPercentage: status.opusWeeklyPercentage,
    opusWeeklyResetTime: status.opusWeeklyResetTime,
    opusTokensLeft: status.opusTokensLeft,
    opusMax: status.opusMax,
    opusWeeklyTokensLeft: status.opusWeeklyTokensLeft,
    opusWeeklyMax: status.opusWeeklyMax,
    opusEstimatedAbsolute: status.opusEstimatedAbsolute,
    opusWeeklyEstimatedAbsolute: status.opusWeeklyEstimatedAbsolute,
    codexPercentage: status.codexPercentage,
    codexResetTime: status.codexResetTime,
    codexWeeklyPercentage: status.codexWeeklyPercentage,
    codexWeeklyResetTime: status.codexWeeklyResetTime,
    codexTokensLeft: status.codexTokensLeft,
    codexMax: status.codexMax,
    codexWeeklyTokensLeft: status.codexWeeklyTokensLeft,
    codexWeeklyMax: status.codexWeeklyMax,
    codexEstimatedAbsolute: status.codexEstimatedAbsolute,
    codexWeeklyEstimatedAbsolute: status.codexWeeklyEstimatedAbsolute,
    codexStatus: status.codexStatus,
    taskRouting: status.recommendedTaskWeight === "restricted" || status.recommendedTaskWeight === "degraded" || (status.codexPercentage !== undefined && status.codexPercentage < 20) || (status.antigravityPercentage !== undefined && status.antigravityPercentage < 20) ? "degraded" : "normal",
    lastSync: completedAt,
    errors: status.errors,
    quotaPools,
    localComputeStatus: {
      status: local?.endpointHealth === "ok" ? "online" : "offline",
      modelName: local?.loadedModels?.[0] ?? "qwen3.8:27b",
      vramUsedMb: gpus.reduce((total, gpu) => total + gpu.vramUsedMb, 0),
      vramTotalMb: gpus.reduce((total, gpu) => total + gpu.vramTotalMb, 0),
      gpus,
      endpointHealth: local?.endpointHealth,
      loadedModels: local?.loadedModels ?? [],
      programName: local?.programName,
    },
    directUsage: usage ? {
      todayTokens: usage.today.totalTokens,
      todayPaidTokens: usage.today.billableTokens,
      todayThinkingTokens: usage.today.reasoningOutputTokens,
      sevenDaysTokens: usage.sevenDays.totalTokens,
      sevenDaysPaidTokens: usage.sevenDays.billableTokens,
      eventCount: usage.today.eventCount,
      status: usage.status,
      sources: usage.sources,
      lastUsedAt: usage.lastUsedAt,
      lastMeasuredAt: usage.lastMeasuredAt,
      errors: usage.errors,
    } : undefined,
    activity: status.activity,
  };
}

function cachedStatusIsFresh(value: unknown, nowMs: number, maxAgeMs: number): boolean {
  if (!value || typeof value !== "object") return false;
  const lastSync = (value as { lastSync?: unknown }).lastSync;
  if (typeof lastSync !== "string") return false;
  const measuredAt = Date.parse(lastSync);
  return Number.isFinite(measuredAt) && measuredAt <= nowMs + 60_000 && nowMs - measuredAt <= maxAgeMs;
}

export async function scanLiveTokenStatus(options: TokenStatusScannerOptions = {}): Promise<LiveTokenStatus> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().getTime();
  let ideRefreshCompleted = false;
  if (options.force) ideRefreshCompleted = await requestForceRefresh();

  const statePath = options.tokenStatusPath === null ? undefined : options.tokenStatusPath ?? findTokenStatusJsonPath();
  const maxAgeMs = options.maxAgeMs ?? 5 * 60_000;
  if (statePath) {
    try {
      const data = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (cachedStatusIsFresh(data, now().getTime(), maxAgeMs) && (!options.force || !ideRefreshCompleted || Date.parse(data.lastSync) >= startedAt)) {
        return mapCachedTokenStatus(data);
      }
    } catch {
      // Missing, malformed or stale file falls through to the shared collector.
    }
  }

  const assetRoot = brokerAssetRoot();
  const managerKey = `${path.resolve(assetRoot)}|${path.resolve(options.tokenStatusPath ?? resolveIntegratedPowerStateRoot())}`;
  let manager = options.tokenManager;
  if (!manager) {
    manager = headlessManagers.get(managerKey);
    if (!manager) {
      const headlessManager = new TokenManager(createHeadlessTokenManagerHost(), assetRoot);
      manager = headlessManager;
      headlessManagers.set(managerKey, headlessManager);
    }
  }
  const status = await manager.getStatus(undefined, { refreshQuota: true, forceRefresh: options.force === true });
  const completedAt = now().toISOString();
  if (status) return mapTokenManagerStatus(status, completedAt);
  return {
    taskRouting: "normal",
    lastSync: "",
    errors: ["TokenManager returned no telemetry result."],
    localComputeStatus: { status: "offline", modelName: "qwen3.8:27b", vramUsedMb: 0, vramTotalMb: 0, gpus: [] },
  };
}

function brokerAssetRoot(): string {
  const override = process.env.INTEGRATED_POWER_BROKER_ASSET_ROOT?.trim();
  if (override) return path.resolve(override);
  const manifestPath = path.join(__dirname, "broker-manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { assetRoot?: unknown };
    if (typeof manifest.assetRoot !== "string" || !manifest.assetRoot.trim()) {
      throw new Error(`Broker manifest does not declare an assetRoot: ${manifestPath}`);
    }
    const root = path.resolve(path.dirname(manifestPath), manifest.assetRoot);
    if (!fs.existsSync(path.join(root, "scripts", "read-agy-credential.ps1")) || !fs.existsSync(path.join(root, "assets", "ip-orchestrator-plugin", "skills", "ip-orchestrator", "scripts", "Select-LocalLLMModel.ps1"))) {
      throw new Error(`Broker assets are incomplete at ${root}; existing credential and selector scripts are required.`);
    }
    return root;
  }
  return path.resolve(__dirname, "..", "..");
}

function mapCachedTokenStatus(data: any): LiveTokenStatus {
  const pools = Array.isArray(data.quotaPools) ? data.quotaPools : [];
  const first = (id: string, provider: string, weekly = false): any => pools.find((pool: any) =>
    pool?.id === id || (pool?.provider === provider && Boolean(pool?.id?.includes("weekly")) === weekly));
  const antigravity = first("antigravity.default", "antigravity");
  const antigravityWeekly = first("antigravity.weekly", "antigravity", true);
  const opus = first("opus.default", "anthropic");
  const opusWeekly = first("opus.weekly", "anthropic", true);
  const codex = first("codex.5h", "codex");
  const codexWeekly = first("codex.weekly", "codex", true);
  const local = data.localComputeStatus;
  const gpus: GpuStatus[] = Array.isArray(local?.gpus) ? local.gpus : [];
  const usage = data.claudeDirectUsage;
  return {
    antigravityPercentage: antigravity?.remainingPercentage ?? data.antigravityPercentage,
    antigravityResetTime: antigravity?.resetTime ?? data.antigravityResetTime,
    antigravityWeeklyPercentage: antigravityWeekly?.remainingPercentage ?? data.antigravityWeeklyPercentage,
    antigravityWeeklyResetTime: antigravityWeekly?.resetTime ?? data.antigravityWeeklyResetTime,
    antigravityTokensLeft: numberOrUndefined(data.antigravityTokensLeft), antigravityMax: numberOrUndefined(data.antigravityMax),
    antigravityWeeklyTokensLeft: numberOrUndefined(data.antigravityWeeklyTokensLeft), antigravityWeeklyMax: numberOrUndefined(data.antigravityWeeklyMax),
    antigravityEstimatedAbsolute: numberOrUndefined(data.antigravityEstimatedAbsolute),
    opusPercentage: opus?.remainingPercentage ?? data.opusPercentage, opusResetTime: opus?.resetTime ?? data.opusResetTime,
    opusWeeklyPercentage: opusWeekly?.remainingPercentage ?? data.opusWeeklyPercentage, opusWeeklyResetTime: opusWeekly?.resetTime ?? data.opusWeeklyResetTime,
    opusTokensLeft: numberOrUndefined(data.opusTokensLeft), opusMax: numberOrUndefined(data.opusMax), opusWeeklyTokensLeft: numberOrUndefined(data.opusWeeklyTokensLeft), opusWeeklyMax: numberOrUndefined(data.opusWeeklyMax),
    opusEstimatedAbsolute: numberOrUndefined(data.opusEstimatedAbsolute), opusWeeklyEstimatedAbsolute: numberOrUndefined(data.opusWeeklyEstimatedAbsolute),
    codexPercentage: codex?.remainingPercentage ?? data.codexPercentage, codexResetTime: codex?.resetTime ?? data.codexResetTime,
    codexWeeklyPercentage: codexWeekly?.remainingPercentage ?? data.codexWeeklyPercentage, codexWeeklyResetTime: codexWeekly?.resetTime ?? data.codexWeeklyResetTime,
    codexTokensLeft: numberOrUndefined(data.codexTokensLeft), codexMax: numberOrUndefined(data.codexMax), codexWeeklyTokensLeft: numberOrUndefined(data.codexWeeklyTokensLeft), codexWeeklyMax: numberOrUndefined(data.codexWeeklyMax),
    codexEstimatedAbsolute: numberOrUndefined(data.codexEstimatedAbsolute), codexWeeklyEstimatedAbsolute: numberOrUndefined(data.codexWeeklyEstimatedAbsolute), codexStatus: stringOrUndefined(data.codexStatus),
    taskRouting: data.recommendedTaskWeight === "restricted" ? "critical" : data.recommendedTaskWeight === "degraded" ? "degraded" : "normal",
    lastSync: data.lastSync,
    errors: Array.isArray(data.errors) ? data.errors.filter((item: unknown): item is string => typeof item === "string") : undefined,
    quotaPools: pools,
    localComputeStatus: {
      status: local?.endpointHealth === "ok" ? "online" : "offline",
      modelName: local?.loadedModels?.[0] || "qwen3.8:27b",
      vramUsedMb: gpus.reduce((sum: number, gpu: GpuStatus) => sum + (gpu.vramUsedMb || 0), 0),
      vramTotalMb: gpus.reduce((sum: number, gpu: GpuStatus) => sum + (gpu.vramTotalMb || 0), 0),
      gpus, endpointHealth: local?.endpointHealth,
      loadedModels: Array.isArray(local?.loadedModels) ? local.loadedModels : [], programName: local?.programName,
    },
    directUsage: usage ? {
      todayTokens: usage.today?.totalTokens ?? 0, todayPaidTokens: usage.today?.billableTokens ?? 0,
      todayThinkingTokens: usage.today?.reasoningOutputTokens ?? 0, sevenDaysTokens: usage.sevenDays?.totalTokens ?? 0,
      sevenDaysPaidTokens: usage.sevenDays?.billableTokens ?? 0, eventCount: usage.today?.eventCount ?? 0,
      status: usage.status, sources: usage.sources, lastUsedAt: usage.lastUsedAt, lastMeasuredAt: usage.lastMeasuredAt, errors: usage.errors,
    } : undefined,
    activity: Array.isArray(data.activity) ? data.activity : undefined,
  };
}
