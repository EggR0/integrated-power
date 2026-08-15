import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile, execFileSync } from "child_process";
import { readUtf8JsonFile } from "./jsonFile";
import {
  integratedPowerRootsConfigPath,
  resolveAntigravityPluginRoot,
  resolveIntegratedPowerKnowledgeRoot,
  resolveIntegratedPowerStateRoot,
  resolveIntegratedPowerToolsRoot,
  resolveIntegratedPowerWorkRoot,
  resolvePortablePath,
  synchronizeIntegratedPowerRootsFromLegacy,
} from "./storagePath";
import { inspectAntigravityPluginInstall } from "./installAntigravityPlugin";
import {
  inspectKnowledgeTools,
  installKnowledgeTools,
} from "./KnowledgeToolInstaller";

const DASHBOARD_SETUP_KEY = "eggr.setup.dashboard.completed.v1";
const FIRST_RUN_PROMPT_KEY = "eggr.setup.firstRunPromptShown.v1";
const OLLAMA_INVENTORY_KEY = "integratedPower.orchestrator.ollamaInventory.v1";

export type EggRRoute = "main_agent" | "codex" | "local_llm";
export type LocalLlmProvider = "none" | "ollama" | "vllm";

export interface DashboardConfiguration {
  showAntigravity: boolean;
  showCodex: boolean;
  showLocalLlm: boolean;
  notifyOnFullTokens?: boolean;
  autoStartOnBoot?: boolean;
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
  pluginRoot: string;
}

export interface KnowledgeConfiguration {
  mode: "local_only" | "private_remote";
  workRoot: string;
  toolsRoot: string;
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

export interface OllamaInventorySnapshot {
  status: string;
  needsUserConfirmation: boolean;
  agentPrompt: string;
  registryPath: string;
  inventorySource: string;
  installedModels: string[];
  registeredInstalled: string[];
  newlyRegistered: string[];
  registryModelsNotInstalled: string[];
  suggestedInstalls: string[];
  synchronizedAt: string;
}

export interface ConfigurationCenterSnapshot {
  dashboard: DashboardConfiguration;
  orchestrator: OrchestratorConfiguration;
  knowledge: KnowledgeConfiguration & {
    workRootConfigured: boolean;
    toolsRootConfigured: boolean;
    knowledgePathConfigured: boolean;
    githubLogin: string;
    repositoryRemote: string;
    currentBranch: string;
    routingPolicyExists: boolean;
    taskBranchCount: number;
  };
  status: FirstRunStatus;
  diagnostics: ExecutableDiagnostic[];
  gpuSummary: string;
  ollamaInventory: OllamaInventorySnapshot | null;
  paths: {
    roots: string;
    orchestrator: string;
    plugin: string;
    pluginRoot: string;
    pluginRootConfigured: boolean;
    previousPlugin: string;
    legacyPlugin: string;
    globalGemini: string;
  };
  installation: {
    pluginInstalled: boolean;
    legacyPluginInstalled: boolean;
    settingsSource: "integrated-power" | "eggr" | "legacy" | "none";
    knowledgeWizardInstalled: boolean;
    knowledgeToolsRoot: string;
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
  const workRoot = resolveIntegratedPowerWorkRoot();
  const knowledgeRoot = resolveIntegratedPowerKnowledgeRoot();
  const toolsRoot = resolveIntegratedPowerToolsRoot();
  const antigravityPluginRoot = resolveAntigravityPluginRoot();
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
  const knowledgePath = knowledgeRoot.path;
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
  const plugin = pluginPath(antigravityPluginRoot.path);
  const previousPlugin = previousPluginPath(antigravityPluginRoot.path);
  const legacyPlugin = legacyPluginPath(antigravityPluginRoot.path);
  const repositoryRemote = readGitRemote(knowledgePath) ?? "";
  const currentBranch = readGitBranch(knowledgePath) ?? "";
  const taskBranchCount = readGitTaskBranchCount(knowledgePath);
  const routingPolicyExists = fs.existsSync(
    path.join(knowledgePath, ".ai", "knowledge-routing.json"),
  );
  const remoteUrl = repositoryRemote || configuredRemoteUrl;
  const githubLogin = readGitHubLogin(ghExecutable) ?? "";
  const globalGemini = path.join(os.homedir(), ".gemini", "GEMINI.md");
  const configuredDefault =
    orchestrator.DefaultRoute === "codex" || orchestrator.DefaultRoute === "local_llm"
      ? orchestrator.DefaultRoute
      : "main_agent";
  const pluginPlan = inspectAntigravityPluginInstall(context);
  const knowledgeTools = inspectKnowledgeTools(context);

  return {
    dashboard: {
      showAntigravity: viewConfig.get<boolean>("showAntigravity", true),
      showCodex: viewConfig.get<boolean>("showCodex", true),
      showLocalLlm: viewConfig.get<boolean>("showLocalLlm", true),
      notifyOnFullTokens: vscode.workspace
        .getConfiguration("integratedPower.notifications")
        .get<boolean>("notifyOnFullTokens", true),
      autoStartOnBoot: vscode.workspace
        .getConfiguration("integratedPower.system")
        .get<boolean>("autoStartOnBoot", false),
      stateRoot: resolveIntegratedPowerStateRoot(),
    },
    orchestrator: {
      enableCodex: enabledRoutes.size === 0 || enabledRoutes.has("codex"),
      enableLocalLlm: enabledRoutes.has("local_llm") || localLlm !== null,
      defaultRoute: configuredDefault,
      codexExe: codexExecutable ?? "",
      provider: localLlm?.Provider ?? "none",
      endpoint: localLlm?.Endpoint ?? "http://127.0.0.1:11434",
      selectionMode: localLlm?.HardwarePolicy.Mode ?? "auto",
      model: localLlm?.Model ?? "",
      reserveVramGB: localLlm?.HardwarePolicy.ReserveVramGB ?? 2,
      allowCpuOffload: localLlm?.HardwarePolicy.AllowCpuOffload ?? false,
      pluginRoot: antigravityPluginRoot.path,
    },
    knowledge: {
      mode: knowledgeMode,
      workRoot: workRoot.path,
      toolsRoot: toolsRoot.path,
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
      currentBranch,
      routingPolicyExists,
      taskBranchCount,
      workRootConfigured: workRoot.configured,
      toolsRootConfigured: toolsRoot.configured,
      knowledgePathConfigured: knowledgeRoot.configured,
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
    ollamaInventory: normalizeOllamaInventorySnapshot(
      context.globalState.get(OLLAMA_INVENTORY_KEY),
    ),
    paths: {
      roots: rootsConfigPath(),
      orchestrator: orchestratorSettingsPath(),
      plugin,
      pluginRoot: antigravityPluginRoot.path,
      pluginRootConfigured: antigravityPluginRoot.configured,
      previousPlugin,
      legacyPlugin,
      globalGemini,
    },
    installation: {
      pluginInstalled: fs.existsSync(plugin),
      legacyPluginInstalled:
        fs.existsSync(previousPlugin) || fs.existsSync(legacyPlugin),
      settingsSource: settingsResult.source,
      knowledgeWizardInstalled: knowledgeTools.installed,
      knowledgeToolsRoot: knowledgeTools.installRoot,
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
  if (typeof input.notifyOnFullTokens === "boolean") {
    const notifyConfig = vscode.workspace.getConfiguration("integratedPower.notifications");
    await notifyConfig.update(
      "notifyOnFullTokens",
      input.notifyOnFullTokens,
      vscode.ConfigurationTarget.Global,
    );
  }
  if (typeof input.autoStartOnBoot === "boolean") {
    const systemConfig = vscode.workspace.getConfiguration("integratedPower.system");
    await systemConfig.update(
      "autoStartOnBoot",
      input.autoStartOnBoot,
      vscode.ConfigurationTarget.Global,
    );
  }
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
  const pluginRoot = validateSafeAbsoluteDirectory(
    input.pluginRoot,
    "Antigravity 플러그인 루트",
  );
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
    const existingSettings = readOrchestratorSettings().value;
    const existingLocalLlm = isRecord(existingSettings.LocalLlm)
      ? existingSettings.LocalLlm
      : {};
    const existingHardwarePolicy = isRecord(existingLocalLlm.HardwarePolicy)
      ? existingLocalLlm.HardwarePolicy
      : {};
    localLlm = {
      ...existingLocalLlm,
      Provider: input.provider,
      Endpoint: input.endpoint.trim().replace(/\/+$/, ""),
      Model: input.selectionMode === "user_default" ? input.model.trim() : null,
      ...(input.provider === "vllm"
        ? { ApiKeyEnvironmentVariable: "VLLM_API_KEY" }
        : {}),
      HardwarePolicy: {
        ...existingHardwarePolicy,
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
  updateRootsConfig({ antigravity_plugin_root: pluginRoot });
  return orchestratorSettingsPath();
}

export async function synchronizeOllamaModelInventory(
  context: vscode.ExtensionContext,
  endpoint: string,
): Promise<OllamaInventorySnapshot> {
  const script = path.join(
    context.extensionPath,
    "assets",
    "ip-orchestrator-plugin",
    "skills",
    "ip-orchestrator",
    "scripts",
    "Sync-OllamaModelRegistry.ps1",
  );
  const bundledRegistry = path.join(
    context.extensionPath,
    "assets",
    "ip-orchestrator-plugin",
    "skills",
    "ip-orchestrator",
    "references",
    "local_llm_model_registry.csv",
  );
  if (!fs.existsSync(script)) {
    throw new Error(`Ollama 모델 인벤토리 동기화 도구가 없습니다: ${script}`);
  }
  if (!fs.existsSync(bundledRegistry)) {
    throw new Error(`기본 로컬 LLM 레지스트리가 없습니다: ${bundledRegistry}`);
  }
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-SettingsPath",
    orchestratorSettingsPath(),
    "-RegistryPath",
    ollamaModelRegistryPath(),
    "-BundledRegistryPath",
    bundledRegistry,
    "-OllamaEndpoint",
    endpoint.trim().replace(/\/+$/, ""),
    "-AsJson",
  ];
  const output = await executeFileUtf8(
    process.platform === "win32" ? "powershell.exe" : "pwsh",
    args,
    30_000,
  );
  const parsed = JSON.parse(output.replace(/^\uFEFF/, "").trim()) as unknown;
  const result = normalizeOllamaInventorySnapshot(parsed);
  if (!result) {
    throw new Error("Ollama 모델 인벤토리 도구가 올바른 JSON 결과를 반환하지 않았습니다.");
  }
  result.synchronizedAt = new Date().toISOString();
  await context.globalState.update(OLLAMA_INVENTORY_KEY, result);
  return result;
}

export function formatOllamaInventorySummary(
  result: OllamaInventorySnapshot,
): string {
  if (result.status !== "ready") {
    return `Ollama 모델 인벤토리를 확인하지 못했습니다(${result.status}).${
      result.agentPrompt ? ` ${result.agentPrompt}` : ""
    }`;
  }
  const parts = [
    `설치 ${result.installedModels.length}개`,
    `등록·설치됨 ${result.registeredInstalled.length}개`,
    `새 등록 ${result.newlyRegistered.length}개`,
    `등록됐지만 미설치 ${result.registryModelsNotInstalled.length}개`,
  ];
  if (result.suggestedInstalls.length > 0) {
    parts.push(`설치 제안 ${result.suggestedInstalls.length}개(사용자 확인 필요)`);
  }
  return `Ollama 모델 인벤토리 동기화 완료: ${parts.join(" · ")}`;
}

export async function runPrivateKnowledgeConfiguration(
  context: vscode.ExtensionContext,
  input: KnowledgeConfiguration,
): Promise<Record<string, unknown>> {
  const toolsRoot = validateSafeAbsoluteDirectory(
    input.toolsRoot,
    "Knowledge 도구 설치 루트",
  );
  const knowledgePath = validateSafeAbsoluteDirectory(
    input.knowledgePath,
    "Knowledge 경로",
  );
  const workRoot = validateSafeAbsoluteDirectory(
    input.workRoot,
    "공통 작업 루트",
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

  installKnowledgeTools(context, toolsRoot);
  const script = path.join(toolsRoot, "initialize-eggr-knowledge.ps1");
  if (!fs.existsSync(script)) {
    throw new Error(
      "확장에 포함된 Private Git Knowledge 도구를 설치하지 못했습니다.",
    );
  }

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-KnowledgePath",
    knowledgePath,
    "-WorkRoot",
    workRoot,
    "-ToolsRoot",
    toolsRoot,
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

export function installBundledKnowledgeTools(
  context: vscode.ExtensionContext,
  requestedToolsRoot?: string,
): {
  installRoot: string;
  changed: string[];
  backupRoot: string;
} {
  const toolsRoot = requestedToolsRoot
    ? validateSafeAbsoluteDirectory(
        requestedToolsRoot,
        "Knowledge 도구 설치 루트",
      )
    : resolveIntegratedPowerToolsRoot().path;
  const result = installKnowledgeTools(context, toolsRoot);
  updateRootsConfig({ tools_root: toolsRoot });
  return {
    installRoot: result.installRoot,
    changed: result.changed,
    backupRoot: result.backupRoot,
  };
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
  return { previousRemote, remoteUrl };
}

export function getFirstRunStatus(context: vscode.ExtensionContext): FirstRunStatus {
  const roots = readJsonObject(rootsConfigPath());
  const resolvedKnowledge = resolveIntegratedPowerKnowledgeRoot();
  const knowledgePath = resolvedKnowledge.configured
    ? resolvedKnowledge.path
    : "";
  const knowledgeRemote =
    typeof roots.knowledge_remote === "string" ? roots.knowledge_remote : "";
  const knowledgeMode =
    typeof roots.knowledge_mode === "string" ? roots.knowledge_mode : "";
  const orchestratorSettings = readOrchestratorSettings();
  const orchestrator = orchestratorSettings.value;
  const knowledgeConfigured =
    knowledgeMode === "local_only" ||
    (knowledgeMode === "private_remote" && Boolean(knowledgeRemote.trim()));
  return {
    dashboard: Boolean(context.globalState.get(DASHBOARD_SETUP_KEY)),
    orchestrator:
      orchestratorSettings.source === "integrated-power" &&
      typeof orchestrator.FirstRunCompletedAt === "string" &&
      (fs.existsSync(pluginPath()) ||
        fs.existsSync(previousPluginPath()) ||
        fs.existsSync(legacyPluginPath())),
    knowledge:
      knowledgeConfigured &&
      Boolean(knowledgePath.trim()) &&
      fs.existsSync(path.join(knowledgePath, ".git")) &&
      fs.existsSync(
        path.join(knowledgePath, ".ai", "knowledge-routing.json"),
      ) &&
      readGitBranch(knowledgePath) === "main",
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
  const toolsRoot = resolveIntegratedPowerToolsRoot().path;
  const candidates = process.platform === "win32"
    ? [path.join(toolsRoot, "initialize-eggr-knowledge.ps1")]
    : [
        path.join(toolsRoot, "initialize-eggr-knowledge.ps1"),
        path.join(toolsRoot, "initialize-eggr-knowledge"),
      ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function readGitBranch(repository: string): string | null {
  return readGitValue(repository, ["branch", "--show-current"]);
}

function readGitTaskBranchCount(repository: string): number {
  const value = readGitValue(repository, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/agent",
    "refs/remotes/origin/agent",
  ]);
  if (!value) return 0;
  return new Set(
    value
      .split(/\r?\n/)
      .map((entry) => entry.trim().replace(/^origin\//, ""))
      .filter(Boolean),
  ).size;
}

export function orchestratorSettingsPath(): string {
  const configured = process.env.INTEGRATED_POWER_ORCHESTRATOR_SETTINGS;
  if (configured) {
    return resolvePortablePath(configured);
  }
  return path.join(
    os.homedir(),
    ".config",
    "integrated-power",
    "orchestrator.json",
  );
}

export function previousOrchestratorSettingsPath(): string {
  const configured = process.env.EGGR_ORCHESTRATOR_SETTINGS;
  if (configured) {
    return resolvePortablePath(configured);
  }
  return path.join(os.homedir(), ".config", "eggr", "orchestrator.json");
}

export function ollamaModelRegistryPath(): string {
  const configured = process.env.INTEGRATED_POWER_LOCAL_LLM_REGISTRY;
  return configured
    ? resolvePortablePath(configured)
    : path.join(path.dirname(orchestratorSettingsPath()), "local_llm_model_registry.csv");
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
  const endpoint = typeof value.Endpoint === "string" ? value.Endpoint : "";
  const model =
    typeof value.Model === "string" && value.Model.trim() ? value.Model : null;
  const provider =
    value.Provider === "vllm"
      ? "vllm"
      : value.Provider === "ollama"
        ? "ollama"
        : /:11434(?:\/|$)/.test(endpoint) || model
          ? "ollama"
          : endpoint
            ? "vllm"
            : null;
  if (!provider || !endpoint) return null;
  const policy = isRecord(value.HardwarePolicy) ? value.HardwarePolicy : {};
  return {
    Provider: provider,
    Endpoint: endpoint,
    Model: model,
    ...(typeof value.ApiKeyEnvironmentVariable === "string"
      ? { ApiKeyEnvironmentVariable: value.ApiKeyEnvironmentVariable }
      : {}),
    HardwarePolicy: {
      Mode:
        policy.Mode === "user_default" ||
        (policy.Mode !== "auto" && model !== null)
          ? "user_default"
          : "auto",
      ReserveVramGB:
        typeof policy.ReserveVramGB === "number" &&
        Number.isFinite(policy.ReserveVramGB)
          ? policy.ReserveVramGB
          : 2,
      AllowCpuOffload: policy.AllowCpuOffload === true,
    },
  };
}

function normalizeOllamaInventorySnapshot(
  value: unknown,
): OllamaInventorySnapshot | null {
  if (!isRecord(value)) return null;
  const array = (name: string): string[] => {
    const source = value[name];
    if (!Array.isArray(source)) return [];
    return source
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (!isRecord(entry)) return "";
        const model = entry.Model ?? entry.model ?? entry.Name ?? entry.name;
        return typeof model === "string" ? model.trim() : "";
      })
      .filter(Boolean);
  };
  const string = (name: string): string =>
    typeof value[name] === "string" ? value[name].trim() : "";
  return {
    status: string("Status") || string("status") || "unknown",
    needsUserConfirmation:
      value.NeedsUserConfirmation === true ||
      value.needsUserConfirmation === true,
    agentPrompt: string("AgentPrompt") || string("agentPrompt"),
    registryPath: string("RegistryPath") || string("registryPath"),
    inventorySource: string("InventorySource") || string("inventorySource"),
    installedModels: array("InstalledModels").length
      ? array("InstalledModels")
      : array("installedModels"),
    registeredInstalled: array("RegisteredInstalled").length
      ? array("RegisteredInstalled")
      : array("registeredInstalled"),
    newlyRegistered: array("NewlyRegistered").length
      ? array("NewlyRegistered")
      : array("newlyRegistered"),
    registryModelsNotInstalled: array("RegistryModelsNotInstalled").length
      ? array("RegistryModelsNotInstalled")
      : array("registryModelsNotInstalled"),
    suggestedInstalls: array("SuggestedInstalls").length
      ? array("SuggestedInstalls")
      : array("suggestedInstalls"),
    synchronizedAt: string("synchronizedAt") || string("SynchronizedAt"),
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

function pluginPath(pluginRoot = resolveAntigravityPluginRoot().path): string {
  return path.join(pluginRoot, "ip-orchestrator-plugin");
}

function previousPluginPath(pluginRoot = resolveAntigravityPluginRoot().path): string {
  return path.join(pluginRoot, "eggr-orchestrator-plugin");
}

function legacyPluginPath(pluginRoot = resolveAntigravityPluginRoot().path): string {
  return path.join(pluginRoot, "codex-orchestrator-plugin");
}

function validateSafeAbsoluteDirectory(value: string, label: string): string {
  try {
    return resolvePortablePath(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}가 올바르지 않습니다: ${message}`);
  }
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

function readGitValue(repository: string, argumentsAfterRepository: string[]): string | null {
  if (!fs.existsSync(path.join(repository, ".git"))) return null;
  const gitExecutable = findExecutable(["git.exe", "git"], [
    programFilesPath("Git", "cmd", "git.exe"),
  ]);
  if (!gitExecutable) return null;
  try {
    const value = execFileSync(
      gitExecutable,
      ["-C", repository, ...argumentsAfterRepository],
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

function readGitRemote(repository: string): string | null {
  return readGitValue(repository, ["remote", "get-url", "origin"]);
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
