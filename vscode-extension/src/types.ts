export type JsonObject = Record<string, unknown>;

export interface ArtifactRef {
  id: string;
  label: string;
  runId: string;
  runTitle: string;
  type?: string;
  workspacePath?: string;
  canOpen: boolean;
}

export type QuotaSource = "official-api" | "cli-json" | "cli-text" | "local-service" | "third-party-tool" | "transcript-estimate" | "manual";
export type UsageConfidence = "exact" | "reported-quota" | "estimated" | "unknown";

export interface QuotaPoolStatus {
  id: string; // antigravity.default, codex.5h, codex.weekly, local.ollama
  provider: "antigravity" | "codex" | "openai" | "gemini" | "anthropic" | "local";
  surface?: "ide" | "cli" | "api" | "orchestrator";
  modelGroup?: string;
  remainingPercentage?: number;
  remainingTokens?: number;
  maxTokens?: number;
  resetTime?: string;
  source: QuotaSource;
  confidence: UsageConfidence;
}

export interface RunUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  quotaPoolId?: string;
  quotaDeltaPercentage?: number;
  source: QuotaSource;
  confidence: UsageConfidence;
}

export interface GpuStatus {
  id: number;
  name: string;
  vramUsedMb: number;
  vramTotalMb: number;
  utilizationPercentage: number;
  powerDrawW: number;
  powerLimitW: number;
}

export interface LocalComputeStatus {
  endpointHealth: string;
  programName?: string;
  loadedModels: string[];
  gpus?: GpuStatus[];
}

export interface LocalLlmMetric {
  timestamp: string;
  taskTitle: string;
  model: string;
  taskScale: string;
  actualElapsedSeconds: number;
  totalTokens: number;
  taskType?: string;
  provider?: string;
  success?: boolean;
  outputChars?: number;
  tokensPerSecond?: number;
  selectedBy?: string;
  selectionReason?: string;
  errorMessage?: string;
}

export interface RunSummary {
  id: string;
  title: string;
  status: string;
  active: boolean;
  startedAt?: string;
  updatedAt?: string;
  model?: string;
  branch?: string;
  cwd?: string;
  summary?: string;
  agentSurface?: string;
  surface?: string;
  provider?: string;
  quotaPoolId?: string;
  usage?: RunUsage;
  pid?: number;
  exitCode?: number;
  kind?: string;
  contextFiles: string[];
  artifacts: ArtifactRef[];
}

export type ParsedRun = RunSummary;
export type ParsedArtifact = ArtifactRef;

export interface TokenStatus {
  quotaPools?: QuotaPoolStatus[];
  localComputeStatus?: LocalComputeStatus;
  
  // Legacy fields
  antigravityTokensLeft: number;
  antigravityMax: number;
  antigravityPercentage?: number;
  antigravityEstimatedAbsolute?: number;
  antigravityResetTime?: string;
  antigravityWeeklyTokensLeft: number;
  antigravityWeeklyMax: number;
  antigravityWeeklyPercentage?: number;
  antigravityWeeklyResetTime?: string;
  opusTokensLeft: number;
  opusMax: number;
  opusPercentage?: number;
  opusEstimatedAbsolute?: number;
  opusResetTime?: string;
  opusWeeklyTokensLeft: number;
  opusWeeklyMax: number;
  opusWeeklyPercentage?: number;
  opusWeeklyEstimatedAbsolute?: number;
  opusWeeklyResetTime?: string;
  codexTokensLeft: number;
  codexMax: number;
  codexPercentage?: number;
  codexEstimatedAbsolute?: number;
  codexResetTime?: string;
  codexWeeklyTokensLeft: number;
  codexWeeklyMax: number;
  codexWeeklyPercentage?: number;
  codexWeeklyEstimatedAbsolute?: number;
  codexWeeklyResetTime?: string;
  codexStatus: string;
  llmStatus: string;
  recommendedTaskWeight: "unknown" | "normal" | "degraded" | "restricted";
  activity: string[];
  errors?: string[];
  localLlmMetrics?: LocalLlmMetric[];
}

export interface DashboardState {
  workspaceName: string;
  runsFile?: string;
  runs: RunSummary[];
  activeRuns: RunSummary[];
  artifacts: ArtifactRef[];
  queueContent?: string;
  metricsCsv?: string;
  parseErrors: string[];
  systemErrors: string[];
  isLoading: boolean;
  isTokenLoading: boolean;
  isStale: boolean;
  updatedAt: string;
  refreshStartedAt?: string;
  tokenStatus?: TokenStatus;
  localLlmMetrics?: LocalLlmMetric[];
  viewConfig?: {
    showAntigravity: boolean;
    showCodex: boolean;
    showLocalLlm: boolean;
  };
}

export type WebviewToExtensionMessage =
  | { type: "ready"; state?: Partial<DashboardState> }
  | { type: "refresh" }
  | { type: "openRunsFile" }
  | { type: "openArtifact"; artifactId: string };

export type ExtensionToWebviewMessage =
  | { type: "state"; state: DashboardState }
  | { type: "loading"; isLoading?: boolean; isTokenLoading?: boolean }
  | { type: "error"; message: string };

export type DashboardInboundMessage = WebviewToExtensionMessage;
export type DashboardOutboundMessage = ExtensionToWebviewMessage;

