import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile, execFileSync } from "child_process";
import { readUtf8JsonFile } from "./jsonFile";
import {
  integratedPowerRootsConfigPath,
  legacyEggRRootsConfigPath,
  resolveIntegratedPowerStateRoot,
  synchronizeIntegratedPowerRootsFromLegacy,
} from "./storagePath";
import { inspectAntigravityPluginInstall } from "./installAntigravityPlugin";

const DASHBOARD_SETUP_KEY = "eggr.setup.dashboard.completed.v1";
const FIRST_RUN_PROMPT_KEY = "eggr.setup.firstRunPromptShown.v1";

export type EggRRoute = "main_agent" | "codex" | "local_llm";
export type LocalLlmProvider = "none" | "ollama" | "vllm";

export interface DashboardConfiguration {
  showAntigravity: boolean;
  showCodex: boolean;
  showLocalLlm: boolean;
  stateRoot: string;
}

export interface OrchestratorConfiguration {
  enableCodex: boolean;
  enableLocalLlm: boolean;
  defaultRoute: EggRRoute;
  codexExe: string;
  provider: LocalLlmProvider;
  endpoint: string;
  selectionMode: "auto" | "user_default";
  model: string;
  reserveVramGB: number;
  allowCpuOffload: boolean;
}

export interface KnowledgeConfiguration {
  mode: "local_only" | "private_remote";
  knowledgePath: string;
  remoteUrl: string;
  authorName: string;
  authorEmail: string;
  allowNonEmptyDirectory: boolean;
  skipRemoteCheck: boolean;
}

export interface KnowledgeRemoteReconfiguration {
  knowledgePath: string;
  remoteUrl: string;
}

export interface FirstRunStatus {
  dashboard: boolean;
  orchestrator: boolean;
  knowledge: boolean;
}

export interface ExecutableDiagnostic {
  id: "agy" | "codex" | "git" | "gh" | "ollama" | "nvidia";
  label: string;
  available: boolean;
  path: string;
  optional: boolean;
}

export interface ConfigurationCenterSnapshot {
  dashboard: DashboardConfiguration;
  orchestrator: OrchestratorConfiguration;
  knowledge: KnowledgeConfiguration & {
    githubLogin: string;
    repositoryRemote: string;
  };
  status: FirstRunStatus;
  diagnostics: ExecutableDiagnostic[];
  gpuSummary: string;
  paths: {
    roots: string;
    orchestrator: string;
    plugin: string;
    previousPlugin: string;
    legacyPlugin: string;
    globalGemini: string;
  };
  installation: {
    pluginInstalled: boolean;
    legacyPluginInstalled: boolean;
    settingsSource: "integrated-power" | "eggr" | "legacy" | "none";
    knowledgeWizardInstalled: boolean;
    globalGeminiExists: boolean;
    pluginPlan: {
      blocked: boolean;
      blockingReason: string;
      destinationState: string;
      previousState: string;
      legacyState: string;
      actions: string[];
    };
  };
  extensionVersion: string;
}

interface OrchestratorLocalLlmSettings {
  Provider: "ollama" | "vllm";
  Endpoint: string;
  Model: string | null;
  ApiKeyEnvironmentVariable?: string;
  HardwarePolicy: {
    Mode: "auto" | "user_default";
    ReserveVramGB: number;
    AllowCpuOffload: boolean;
  };
}

interface OrchestratorSettings {
  SchemaVersion: number;
  CodexExe: string | null;
  EnabledRoutes: EggRRoute[];
  DefaultRoute: EggRRoute;
  LocalLlm: OrchestratorLocalLlmSettings | null;
  FirstRunCompletedAt: string;
  ConfiguredBy: string;
}

export function loadConfigurationCenterSnapshot(
  context: vscode.ExtensionContext,
): ConfigurationCenterSnapshot {
  const roots = readJsonObject(rootsConfigPath());
  const settingsResult = readOrchestratorSettings();
  const orchestrator = settingsResult.value;
  const viewConfig = vscode.workspace.getConfiguration("integratedPower.view");
  const localLlm = normalizeExistingLocalLlm(orchestrator.LocalLlm);
  const enabledRoutes = new Set(
    Array.isArray(orchestrator.EnabledRoutes)
      ? orchestrator.EnabledRoutes.filter(
          (value): value is EggRRoute =>
            value === "main_agent" || value === "codex" || value === "local_llm",
        )
      : [],
  );
  const knowledgePath =
    typeof roots.knowledge === "string" && roots.knowledge.trim()
      ? path.resolve(roots.knowledge)
      : defaultKnowledgePath();
  const knowledgeMode =
    roots.knowledge_mode === "private_remote" ? "private_remote" : "local_only";
  const configuredRemoteUrl =
    typeof roots.knowledge_remote === "string" ? roots.knowledge_remote : "";
  const codexExecutable = findCodexExecutable(
    typeof orchestrator.CodexExe === "string" ? orchestrator.CodexExe : undefined,
  );
  const agyExecutable = findExecutable(["agy.exe", "agy"]);
  const ollamaExecutable = findExecutable(["ollama.exe", "ollama"], [
    localAppDataPath("Programs", "Ollama", "ollama.exe"),
    programFilesPath("Ollama", "ollama.exe"),
  ]);
  const nvidiaExecutable = findExecutable(["nvidia-smi.exe", "nvidia-smi"], [
    systemRootPath("System32", "nvidia-smi.exe"),
  ]);
  const gitExecutable = findExecutable(["git.exe", "git"], [
    programFilesPath("Git", "cmd", "git.exe"),
  ]);
  const ghExecutable = findExecutable(["gh.exe", "gh"], [
    programFilesPath("GitHub CLI", "gh.exe"),
  ]);
  const plugin = pluginPath();
  const previousPlugin = previousPluginPath();
  const legacyPlugin = legacyPluginPath();
  const repositoryRemote = readGitRemote(knowledgePath) ?? "";
  const remoteUrl = repositoryRemote || configuredRemoteUrl;
  const githubLogin = readGitHubLogin(ghExecutable) ?? "";
  const globalGemini = path.join(os.homedir(), ".gemini", "GEMINI.md");
  const configuredDefault =
    orchestrator.DefaultRoute === "codex" || orchestrator.DefaultRoute === "local_llm"
      ? orchestrator.DefaultRoute
      : "main_agent";
  const pluginPlan = inspectAntigravityPluginInstall(context);

  return {
    dashboard: {
      showAntigravity: viewConfig.get<boolean>("showAntigravity", true),
      showCodex: viewConfig.get<boolean>("showCodex", true),
      showLocalLlm: viewConfig.get<boolean>("showLocalLlm", true),
      stateRoot: resolveIntegratedPowerStateRoot(),
    },
    orchestrator: {
      enableCodex: enabledRoutes.size === 0 || enabledRoutes.has("codex"),
      enableLocalLlm: enabledRoutes.has("local_llm"),
      defaultRoute: configuredDefault,
      codexExe: codexExecutable ?? "",
      provider: localLlm?.Provider ?? "none",
      endpoint: localLlm?.Endpoint ?? "http://127.0.0.1:11434",
      selectionMode: localLlm?.HardwarePolicy.Mode ?? "auto",
      model: localLlm?.Model ?? "",
      reserveVramGB: localLlm?.HardwarePolicy.ReserveVramGB ?? 2,
      allowCpuOffload: localLlm?.HardwarePolicy.AllowCpuOffload ?? false,
    },
    knowledge: {
      mode: knowledgeMode,
      knowledgePath,
      remoteUrl,
      authorName:
        readGitConfig(knowledgePath, "user.name") ??
        readGitConfig("", "user.name") ??
        "",
      authorEmail:
        readGitConfig(knowledgePath, "user.email") ??
        readGitConfig("", "user.email") ??
        "",
      allowNonEmptyDirectory: false,
      skipRemoteCheck: false,
      githubLogin,
      repositoryRemote,
    },
    status: getFirstRunStatus(context),
    diagnostics: [
      diagnostic("agy", "Agy", agyExecutable, true),
      diagnostic("codex", "Codex", codexExecutable, true),
      diagnostic("git", "Git for Windows", gitExecutable, false),
      diagnostic("gh", "GitHub CLI", ghExecutable, true),
      diagnostic(
        "ollama",
        "Ollama",
        ollamaExecutable,
        !(enabledRoutes.has("local_llm") && localLlm?.Provider === "ollama"),
      ),
      diagnostic("nvidia", "NVIDIA", nvidiaExecutable, true),
    ],
    gpuSummary: summarizeDetectedHardware(detectNvidiaGpus()),
    paths: {
      roots: rootsConfigPath(),
      orchestrator: orchestratorSettingsPath(),
      plugin,
      previousPlugin,
      legacyPlugin,
      globalGemini,
    },
    installation: {
      pluginInstalled: fs.existsSync(plugin),
      legacyPluginInstalled:
        fs.existsSync(previousPlugin) || fs.existsSync(legacyPlugin),
      settingsSource: settingsResult.source,
      knowledgeWizardInstalled: Boolean(installedKnowledgeWizardPath()),
      globalGeminiExists: fs.existsSync(globalGemini),
      pluginPlan: {
        blocked: pluginPlan.blocked,
        blockingReason: pluginPlan.blockingReason ?? "",
        destinationState: pluginPlan.destination.state,
        previousState: pluginPlan.predecessor.state,
        legacyState: pluginPlan.legacy.state,
        actions: pluginPlan.actions.map((action) => action.description),
      },
    },
    extensionVersion: String(context.extension.packageJSON.version ?? "unknown"),
  };
}

export async function saveDashboardConfiguration(
  context: vscode.ExtensionContext,
  input: DashboardConfiguration,
  refresh: () => Promise<void>,
): Promise<string> {
  const stateRoot = validateSafeAbsoluteDirectory(
    input.stateRoot,
    "Integrated Power 상태 경로",
  );
  const viewConfig = vscode.workspace.getConfiguration("integratedPower.view");
  await viewConfig.update(
    "showAntigravity",
    input.showAntigravity === true,
    vscode.ConfigurationTarget.Global,
  );
  await viewConfig.update(
    "showCodex",
    input.showCodex === true,
    vscode.ConfigurationTarget.Global,
  );
  await viewConfig.update(
    "showLocalLlm",
    input.showLocalLlm === true,
    vscode.ConfigurationTarget.Global,
  );
  updateRootsConfig({ state_root: stateRoot });
  await context.globalState.update(DASHBOARD_SETUP_KEY, {
    completedAt: new Date().toISOString(),
    version: String(context.extension.packageJSON.version ?? "unknown"),
  });
  await refresh();
  return stateRoot;
}

export function saveOrchestratorConfiguration(
  context: vscode.ExtensionContext,
  input: OrchestratorConfiguration,
): string {
  const enabledRoutes: EggRRoute[] = ["main_agent"];
  let codexExe: string | null = null;
  if (input.enableCodex === true) {
    codexExe = findCodexExecutable(input.codexExe);
    if (!codexExe) {
      throw new Error("Codex 경로를 찾지 못했습니다. codex.exe를 선택하거나 Codex 경로를 끄세요.");
    }
    enabledRoutes.push("codex");
  }

  let localLlm: OrchestratorLocalLlmSettings | null = null;
  if (input.enableLocalLlm === true) {
    if (input.provider !== "ollama" && input.provider !== "vllm") {
      throw new Error("로컬 LLM 공급자로 Ollama 또는 vLLM을 선택하세요.");
    }
    const endpointError = validateHttpEndpoint(input.endpoint);
    if (endpointError) throw new Error(endpointError);
    const reserveError = validateReserveVram(String(input.reserveVramGB));
    if (reserveError) throw new Error(reserveError);
    if (input.selectionMode === "user_default" && !input.model.trim()) {
      throw new Error("사용자 지정 모델 우선 모드에는 정확한 모델 ID가 필요합니다.");
    }
    enabledRoutes.push("local_llm");
    localLlm = {
      Provider: input.provider,
      Endpoint: input.endpoint.trim().replace(/\/+$/, ""),
      Model: input.selectionMode === "user_default" ? input.model.trim() : null,
      ...(input.provider === "vllm"
        ? { ApiKeyEnvironmentVariable: "VLLM_API_KEY" }
        : {}),
      HardwarePolicy: {
        Mode: input.selectionMode === "user_default" ? "user_default" : "auto",
        ReserveVramGB: Number(input.reserveVramGB),
        AllowCpuOffload: input.allowCpuOffload === true,
      },
    };
  }

  if (!enabledRoutes.includes(input.defaultRoute)) {
    throw new Error("기본 실행 경로는 활성화된 경로 중에서 선택해야 합니다.");
  }

  const existing = readOrchestratorSettings().value;
  const settings: OrchestratorSettings = {
    SchemaVersion: 2,
    CodexExe: codexExe,
    EnabledRoutes: enabledRoutes,
    DefaultRoute: input.defaultRoute,
    LocalLlm: localLlm,
    FirstRunCompletedAt: new Date().toISOString(),
    ConfiguredBy: `integrated-power/${String(
      context.extension.packageJSON.version ?? "unknown",
    )}`,
  };
  writeJsonObjectAtomic(orchestratorSettingsPath(), { ...existing, ...settings });
  return orchestratorSettingsPath();
}

export async function runPrivateKnowledgeConfiguration(
  input: KnowledgeConfiguration,
): Promise<Record<string, unknown>> {
  const script = installedKnowledgeWizardPath();
  if (!script) {
    throw new Error(
      "EggR Private Git Knowledge 도구가 없습니다. environment-bootstrap의 Windows 설치를 먼저 실행하세요.",
    );
  }
  const knowledgePath = validateSafeAbsoluteDirectory(
    input.knowledgePath,
    "Knowledge 경로",
  );
  const authorName = input.authorName.trim();
  const authorEmail = input.authorEmail.trim();
  if (!authorName) throw new Error("Git 작성자 이름이 필요합니다.");
  if (!/^[^@\s]+@[^@\s]+$/.test(authorEmail)) {
    throw new Error("올바른 Git 작성자 이메일을 입력하세요.");
  }
  const remoteUrl = input.remoteUrl.trim();
  if (input.mode === "private_remote") {
    if (!remoteUrl) throw new Error("Private Git 원격 URL이 필요합니다.");
    if (remoteContainsCredential(remoteUrl)) {
      throw new Error(
        "원격 URL에 자격 증명을 넣지 마세요. Git Credential Manager 또는 SSH를 사용하세요.",
      );
    }
  }

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-KnowledgePath",
    knowledgePath,
    "-AuthorName",
    authorName,
    "-AuthorEmail",
    authorEmail,
    "-NonInteractive",
    "-Json",
  ];
  if (input.mode === "local_only") {
    args.push("-LocalOnly");
  } else {
    args.push("-RemoteUrl", remoteUrl);
  }
  if (input.allowNonEmptyDirectory) args.push("-AllowNonEmptyDirectory");
  if (input.skipRemoteCheck) args.push("-SkipRemoteCheck");

  const output = await executeFileUtf8(
    process.platform === "win32" ? "powershell.exe" : "pwsh",
    args,
    120_000,
  );
  const parsed = JSON.parse(output.replace(/^\uFEFF/, "").trim()) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Knowledge 설정 도구가 올바른 JSON 결과를 반환하지 않았습니다.");
  }
  synchronizeIntegratedPowerRootsFromLegacy();
  return parsed;
}

export function detectKnowledgeRemote(
  input: KnowledgeRemoteReconfiguration,
): {
  githubLogin: string;
  remoteUrl: string;
  currentRemote: string;
} {
  const knowledgePath = validateSafeAbsoluteDirectory(
    input.knowledgePath,
    "Knowledge 경로",
  );
  const ghExecutable = findExecutable(["gh.exe", "gh"], [
    programFilesPath("GitHub CLI", "gh.exe"),
  ]);
  const githubLogin = readGitHubLogin(ghExecutable);
  if (!githubLogin) {
    throw new Error(
      "GitHub CLI 로그인 계정을 확인하지 못했습니다. gh auth login 후 상태 다시 확인을 눌러주세요.",
    );
  }
  const currentRemote = readGitRemote(knowledgePath) ?? input.remoteUrl.trim();
  const remoteUrl = rewriteGitHubRemoteOwner(currentRemote, githubLogin);
  if (!remoteUrl) {
    throw new Error(
      "현재 GitHub 저장소 이름을 확인하지 못했습니다. 원격 URL을 먼저 입력해주세요.",
    );
  }
  return { githubLogin, remoteUrl, currentRemote };
}

export function reconfigureKnowledgeRemote(
  input: KnowledgeRemoteReconfiguration,
): {
  previousRemote: string;
  remoteUrl: string;
} {
  const knowledgePath = validateSafeAbsoluteDirectory(
    input.knowledgePath,
    "Knowledge 경로",
  );
  if (!fs.existsSync(path.join(knowledgePath, ".git"))) {
    throw new Error(`Knowledge Git 저장소가 아닙니다: ${knowledgePath}`);
  }
  const remoteUrl = input.remoteUrl.trim();
  if (!remoteUrl) throw new Error("재설정할 Git 원격 URL을 입력해주세요.");
  if (remoteContainsCredential(remoteUrl)) {
    throw new Error(
      "원격 URL에 자격 증명을 넣지 마세요. Git Credential Manager 또는 SSH를 사용하세요.",
    );
  }
  const gitExecutable = findExecutable(["git.exe", "git"], [
    programFilesPath("Git", "cmd", "git.exe"),
  ]);
  if (!gitExecutable) throw new Error("Git for Windows를 찾지 못했습니다.");
  const previousRemote = readGitRemote(knowledgePath) ?? "";
  const args = previousRemote
    ? ["-C", knowledgePath, "remote", "set-url", "origin", remoteUrl]
    : ["-C", knowledgePath, "remote", "add", "origin", remoteUrl];
  execFileSync(gitExecutable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 15_000,
  });
  updateRootsConfig({
    knowledge: knowledgePath,
    knowledge_mode: "private_remote",
    knowledge_remote: remoteUrl,
  });
  updateLegacyKnowledgeRootsConfig({
    knowledge: knowledgePath,
    knowledge_mode: "private_remote",
    knowledge_remote: remoteUrl,
  });
  return { previousRemote, remoteUrl };
}

export function getFirstRunStatus(context: vscode.ExtensionContext): FirstRunStatus {
  const roots = readJsonObject(rootsConfigPath());
  const knowledgePath = typeof roots.knowledge === "string" ? roots.knowledge : "";
  const knowledgeRemote =
    typeof roots.knowledge_remote === "string" ? roots.knowledge_remote : "";
  const knowledgeMode =
    typeof roots.knowledge_mode === "string" ? roots.knowledge_mode : "";
  const orchestrator = readOrchestratorSettings().value;
  const knowledgeConfigured =
    knowledgeMode === "local_only" ||
    (knowledgeMode === "private_remote" && Boolean(knowledgeRemote.trim()));
  return {
    dashboard: Boolean(context.globalState.get(DASHBOARD_SETUP_KEY)),
    orchestrator:
      typeof orchestrator.FirstRunCompletedAt === "string" &&
      (fs.existsSync(pluginPath()) ||
        fs.existsSync(previousPluginPath()) ||
        fs.existsSync(legacyPluginPath())),
    knowledge:
      knowledgeConfigured &&
      Boolean(knowledgePath.trim()) &&
      fs.existsSync(path.join(knowledgePath, ".git")),
  };
}

export async function offerFirstRunSetup(
  context: vscode.ExtensionContext,
  openConfigurationCenter: () => void,
): Promise<void> {
  if (context.globalState.get(FIRST_RUN_PROMPT_KEY)) return;
  await context.globalState.update(FIRST_RUN_PROMPT_KEY, new Date().toISOString());
  const status = getFirstRunStatus(context);
  if (status.dashboard && status.orchestrator && status.knowledge) return;
  const action = await vscode.window.showInformationMessage(
    "Integrated Power Dashboard, Integrated Orchestrator, Private Git Knowledge를 한 설정 화면에서 준비할 수 있습니다.",
    "설정 센터 열기",
    "나중에",
  );
  if (action === "설정 센터 열기") openConfigurationCenter();
}

export function validateHttpEndpoint(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      return "HTTP 또는 HTTPS 주소만 사용할 수 있습니다.";
    }
    if (url.username || url.password) {
      return "사용자명·비밀번호·토큰을 URL에 넣지 마세요.";
    }
    return undefined;
  } catch {
    return "올바른 HTTP(S) URL을 입력하세요.";
  }
}

export function validateReserveVram(value: string): string | undefined {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 256) {
    return "0~256 사이의 VRAM(GB)을 입력하세요.";
  }
  return undefined;
}

export function installedKnowledgeWizardPath(): string | undefined {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(
            process.env.LOCALAPPDATA ?? "",
            "EggR",
            "bin",
            "initialize-eggr-knowledge.ps1",
          ),
        ]
      : [path.join(os.homedir(), ".local", "bin", "initialize-eggr-knowledge")];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

export function orchestratorSettingsPath(): string {
  const configured =
    process.env.INTEGRATED_POWER_ORCHESTRATOR_SETTINGS ??
    process.env.EGGR_ORCHESTRATOR_SETTINGS;
  if (configured) {
    return path.resolve(
      expandEnvironmentVariables(configured),
    );
  }
  return path.join(
    os.homedir(),
    ".config",
    "integrated-power",
    "orchestrator.json",
  );
}

export function previousOrchestratorSettingsPath(): string {
  return path.join(os.homedir(), ".config", "eggr", "orchestrator.json");
}

export function legacyOrchestratorSettingsPath(): string {
  return path.join(
    os.homedir(),
    ".gemini",
    "config",
    "codex_plugin_settings.json",
  );
}

function readOrchestratorSettings(): {
  value: Record<string, unknown>;
  source: "integrated-power" | "eggr" | "legacy" | "none";
} {
  if (fs.existsSync(orchestratorSettingsPath())) {
    return {
      value: readJsonObject(orchestratorSettingsPath()),
      source: "integrated-power",
    };
  }
  if (fs.existsSync(previousOrchestratorSettingsPath())) {
    return {
      value: readJsonObject(previousOrchestratorSettingsPath()),
      source: "eggr",
    };
  }
  if (fs.existsSync(legacyOrchestratorSettingsPath())) {
    return {
      value: readJsonObject(legacyOrchestratorSettingsPath()),
      source: "legacy",
    };
  }
  return { value: {}, source: "none" };
}

function normalizeExistingLocalLlm(
  value: unknown,
): OrchestratorLocalLlmSettings | null {
  if (!isRecord(value)) return null;
  const provider =
    value.Provider === "vllm"
      ? "vllm"
      : value.Provider === "ollama"
        ? "ollama"
        : null;
  if (!provider || typeof value.Endpoint !== "string") return null;
  const policy = isRecord(value.HardwarePolicy) ? value.HardwarePolicy : {};
  return {
    Provider: provider,
    Endpoint: value.Endpoint,
    Model:
      typeof value.Model === "string" && value.Model.trim() ? value.Model : null,
    ...(typeof value.ApiKeyEnvironmentVariable === "string"
      ? { ApiKeyEnvironmentVariable: value.ApiKeyEnvironmentVariable }
      : {}),
    HardwarePolicy: {
      Mode: policy.Mode === "user_default" ? "user_default" : "auto",
      ReserveVramGB:
        typeof policy.ReserveVramGB === "number" &&
        Number.isFinite(policy.ReserveVramGB)
          ? policy.ReserveVramGB
          : 2,
      AllowCpuOffload: policy.AllowCpuOffload === true,
    },
  };
}

interface DetectedGpu {
  index: number;
  name: string;
  totalVramMiB: number;
  freeVramMiB: number;
  computeCapability: number | null;
}

function detectNvidiaGpus(): DetectedGpu[] {
  const executable = findExecutable(["nvidia-smi.exe", "nvidia-smi"]);
  if (!executable) return [];
  const rows = queryNvidiaSmi(executable, true) ?? queryNvidiaSmi(executable, false);
  if (!rows) return [];
  return rows
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(",").map((field) => field.trim());
      const computeCapability = fields.length >= 5 ? Number(fields[4]) : Number.NaN;
      return {
        index: Number(fields[0]),
        name: fields[1] ?? "NVIDIA GPU",
        totalVramMiB: Number(fields[2]),
        freeVramMiB: Number(fields[3]),
        computeCapability: Number.isFinite(computeCapability)
          ? computeCapability
          : null,
      };
    })
    .filter(
      (gpu) =>
        Number.isFinite(gpu.index) &&
        Number.isFinite(gpu.totalVramMiB) &&
        Number.isFinite(gpu.freeVramMiB),
    );
}

function queryNvidiaSmi(
  executable: string,
  includeComputeCapability: boolean,
): string | undefined {
  const fields = includeComputeCapability
    ? "index,name,memory.total,memory.free,compute_cap"
    : "index,name,memory.total,memory.free";
  try {
    return execFileSync(
      executable,
      [`--query-gpu=${fields}`, "--format=csv,noheader,nounits"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: 5_000,
      },
    );
  } catch {
    return undefined;
  }
}

function summarizeDetectedHardware(gpus: DetectedGpu[]): string {
  if (gpus.length === 0) {
    return "NVIDIA GPU를 감지하지 못했습니다. 실행 시 공급자가 다시 확인합니다.";
  }
  return gpus
    .map((gpu) => {
      const freeGiB = (gpu.freeVramMiB / 1024).toFixed(1);
      const totalGiB = (gpu.totalVramMiB / 1024).toFixed(1);
      const cc =
        gpu.computeCapability === null
          ? "CC unknown"
          : `CC ${gpu.computeCapability.toFixed(1)}`;
      return `${gpu.name} ${freeGiB}/${totalGiB}GB free (${cc}; ${precisionHint(
        gpu.computeCapability,
      )})`;
    })
    .join(" · ");
}

function precisionHint(computeCapability: number | null): string {
  if (computeCapability === null) return "backend precision unknown";
  if (computeCapability >= 12.0) return "TensorRT-RTX native FP8/FP4";
  if (computeCapability >= 8.9) {
    return "TensorRT-RTX native FP8; FP4 unavailable";
  }
  if (computeCapability >= 8.6) {
    return "TensorRT-RTX BF16/INT4; native FP8/FP4 unavailable";
  }
  return "backend-specific precision check required";
}

function diagnostic(
  id: ExecutableDiagnostic["id"],
  label: string,
  executable: string | null,
  optional: boolean,
): ExecutableDiagnostic {
  return {
    id,
    label,
    available: Boolean(executable),
    path: executable ?? "",
    optional,
  };
}

function updateRootsConfig(patch: Record<string, unknown>): void {
  const configPath = rootsConfigPath();
  writeJsonObjectAtomic(configPath, { ...readJsonObject(configPath), ...patch });
}

function updateLegacyKnowledgeRootsConfig(
  patch: Record<string, unknown>,
): void {
  const configPath = legacyEggRRootsConfigPath();
  writeJsonObjectAtomic(configPath, {
    ...readJsonObject(configPath),
    ...patch,
  });
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  const parsed: unknown = readUtf8JsonFile<unknown>(filePath);
  if (!isRecord(parsed)) {
    throw new Error(`설정 파일은 JSON object여야 합니다: ${filePath}`);
  }
  return parsed;
}

function writeJsonObjectAtomic(
  filePath: string,
  value: Record<string, unknown>,
): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function rootsConfigPath(): string {
  return integratedPowerRootsConfigPath();
}

function pluginPath(): string {
  return path.join(
    os.homedir(),
    ".gemini",
    "config",
    "plugins",
    "ip-orchestrator-plugin",
  );
}

function previousPluginPath(): string {
  return path.join(
    os.homedir(),
    ".gemini",
    "config",
    "plugins",
    "eggr-orchestrator-plugin",
  );
}

function legacyPluginPath(): string {
  return path.join(
    os.homedir(),
    ".gemini",
    "config",
    "plugins",
    "codex-orchestrator-plugin",
  );
}

function defaultKnowledgePath(): string {
  return path.join(os.homedir(), "Documents", "IntegratedPower", "Knowledge");
}

function validateSafeAbsoluteDirectory(value: string, label: string): string {
  const expanded = expandEnvironmentVariables(value.trim());
  if (!expanded || !path.isAbsolute(expanded)) {
    throw new Error(`${label}는 절대 경로여야 합니다.`);
  }
  const resolved = path.resolve(expanded);
  if (path.parse(resolved).root === resolved) {
    throw new Error(`${label}로 드라이브 또는 파일시스템 루트를 사용할 수 없습니다.`);
  }
  return resolved;
}

function expandEnvironmentVariables(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, name: string) => {
    return process.env[name] ?? process.env[name.toUpperCase()] ?? `%${name}%`;
  });
}

function remoteContainsCredential(value: string): boolean {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return /^(?:https?|git):\/\/[^/]*@/i.test(value);
  }
  try {
    const url = new URL(value);
    if (url.protocol === "ssh:") return Boolean(url.password);
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

function findCodexExecutable(existing?: string): string | null {
  const candidates = [
    existing,
    process.env.CODEX_EXE,
    findExecutable(["codex.exe", "codex"]),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe")
      : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const expanded = expandEnvironmentVariables(candidate);
    if (fs.existsSync(expanded)) return path.resolve(expanded);
  }
  if (process.env.LOCALAPPDATA) {
    const root = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    if (fs.existsSync(root)) {
      const matches = findFiles(root, "codex.exe");
      matches.sort(
        (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs,
      );
      if (matches[0]) return matches[0];
    }
  }
  return null;
}

export function findExecutable(
  names: string[],
  knownCandidates: Array<string | undefined> = [],
): string | null {
  for (const candidate of knownCandidates) {
    if (candidate && fs.existsSync(candidate)) return path.resolve(candidate);
  }
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const refreshedPath =
    process.platform === "win32" ? refreshedWindowsPath() : process.env.PATH;
  for (const name of names) {
    try {
      const result = execFileSync(locator, [name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: 5_000,
        env: { ...process.env, PATH: refreshedPath },
      })
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find(Boolean);
      if (result) return result;
    } catch {
      // Try the next executable name.
    }
  }
  return null;
}

function refreshedWindowsPath(): string {
  const segments = [
    process.env.PATH ?? "",
    readWindowsRegistryPath("HKCU\\Environment"),
    readWindowsRegistryPath(
      "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    ),
  ]
    .flatMap((value) =>
      expandEnvironmentVariables(value)
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
  const unique = new Map<string, string>();
  for (const segment of segments) {
    const key = segment.toLowerCase();
    if (!unique.has(key)) unique.set(key, segment);
  }
  return [...unique.values()].join(";");
}

function readWindowsRegistryPath(key: string): string {
  try {
    const output = execFileSync("reg.exe", ["query", key, "/v", "Path"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 5_000,
    });
    return (
      output.match(
        /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im,
      )?.[1] ?? ""
    );
  } catch {
    return "";
  }
}

function localAppDataPath(...segments: string[]): string | undefined {
  return process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, ...segments)
    : undefined;
}

function programFilesPath(...segments: string[]): string | undefined {
  return process.env.ProgramFiles
    ? path.join(process.env.ProgramFiles, ...segments)
    : undefined;
}

function systemRootPath(...segments: string[]): string | undefined {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, ...segments)
    : undefined;
}

function findFiles(root: string, fileName: string, depth = 0): string[] {
  if (depth > 4) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      results.push(candidate);
    } else if (entry.isDirectory()) {
      results.push(...findFiles(candidate, fileName, depth + 1));
    }
  }
  return results;
}

function readGitConfig(repository: string, key: string): string | null {
  const args =
    repository && fs.existsSync(path.join(repository, ".git"))
      ? ["-C", repository, "config", "--local", "--get", key]
      : ["config", "--global", "--get", key];
  try {
    const gitExecutable = findExecutable(["git.exe", "git"], [
      programFilesPath("Git", "cmd", "git.exe"),
    ]);
    if (!gitExecutable) return null;
    const value = execFileSync(gitExecutable, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 5_000,
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function readGitRemote(repository: string): string | null {
  if (!fs.existsSync(path.join(repository, ".git"))) return null;
  const gitExecutable = findExecutable(["git.exe", "git"], [
    programFilesPath("Git", "cmd", "git.exe"),
  ]);
  if (!gitExecutable) return null;
  try {
    const value = execFileSync(
      gitExecutable,
      ["-C", repository, "remote", "get-url", "origin"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: 5_000,
      },
    ).trim();
    return value || null;
  } catch {
    return null;
  }
}

function readGitHubLogin(executable: string | null): string | null {
  if (!executable) return null;
  try {
    const value = execFileSync(executable, ["api", "user", "--jq", ".login"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 15_000,
    }).trim();
    return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function rewriteGitHubRemoteOwner(
  remoteUrl: string,
  githubLogin: string,
): string | null {
  const normalized = remoteUrl.trim();
  const match =
    normalized.match(
      /^https?:\/\/github\.com\/[^/]+\/([^/#]+?)(?:\.git)?\/?$/i,
    ) ??
    normalized.match(
      /^(?:ssh:\/\/)?git@github\.com[:/][^/]+\/([^/#]+?)(?:\.git)?\/?$/i,
    );
  if (!match) return null;
  const repository = match[1].replace(/\.git$/i, "");
  return `https://github.com/${githubLogin}/${repository}.git`;
}

function executeFileUtf8(
  executable: string,
  args: string[],
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        encoding: "utf8",
        windowsHide: true,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              String(stderr).trim() || error.message || "외부 설정 도구 실행 실패",
            ),
          );
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
