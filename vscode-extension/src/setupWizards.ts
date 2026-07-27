import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { resolveEggRStateRoot } from "./storagePath";

const DASHBOARD_SETUP_KEY = "eggr.setup.dashboard.completed.v1";
const FIRST_RUN_PROMPT_KEY = "eggr.setup.firstRunPromptShown.v1";

interface IdentifiedQuickPickItem extends vscode.QuickPickItem {
  id: string;
}

interface OrchestratorLocalLlmSettings {
  Provider: "ollama" | "vllm";
  Endpoint: string;
  Model: string | null;
  ApiKeyEnvironmentVariable?: string;
  HardwarePolicy: OrchestratorHardwarePolicy;
}

interface OrchestratorHardwarePolicy {
  Mode: "auto" | "user_default";
  ReserveVramGB: number;
  AllowCpuOffload: boolean;
}

interface DetectedGpu {
  index: number;
  name: string;
  totalVramMiB: number;
  freeVramMiB: number;
  computeCapability: number | null;
}

interface OrchestratorSettings {
  SchemaVersion: number;
  CodexExe: string | null;
  EnabledRoutes: string[];
  DefaultRoute: string;
  LocalLlm: OrchestratorLocalLlmSettings | null;
  FirstRunCompletedAt: string;
  ConfiguredBy: string;
}

export interface FirstRunStatus {
  dashboard: boolean;
  orchestrator: boolean;
  knowledge: boolean;
}

export async function runDashboardSetupWizard(
  context: vscode.ExtensionContext,
  refresh: () => Promise<void>,
): Promise<boolean> {
  const viewConfig = vscode.workspace.getConfiguration("integratedPower.view");
  const sectionItems: IdentifiedQuickPickItem[] = [
    {
      id: "antigravity",
      label: "Antigravity IDE 사용량",
      description: "Agy 로그인 상태와 할당량을 표시합니다.",
      picked: viewConfig.get<boolean>("showAntigravity", true),
    },
    {
      id: "codex",
      label: "Codex 사용량",
      description: "Codex CLI 상태와 사용량을 표시합니다.",
      picked: viewConfig.get<boolean>("showCodex", true),
    },
    {
      id: "local_llm",
      label: "로컬 LLM 상태",
      description: "Ollama/vLLM과 GPU 상태를 표시합니다.",
      picked: viewConfig.get<boolean>("showLocalLlm", true),
    },
  ];

  const selected = await vscode.window.showQuickPick(sectionItems, {
    canPickMany: true,
    title: "EggR Dashboard 최초 실행 설정",
    placeHolder: "표시할 사용량·상태 영역을 선택하세요.",
  });
  if (selected === undefined) return false;

  const currentStateRoot = resolveEggRStateRoot();
  const stateChoice = await vscode.window.showQuickPick<IdentifiedQuickPickItem>(
    [
      {
        id: "current",
        label: "현재 상태 경로 유지",
        description: currentStateRoot,
      },
      {
        id: "default",
        label: "운영체제 권장 경로 사용",
        description: defaultStateRoot(),
      },
      {
        id: "custom",
        label: "다른 상태 폴더 선택",
        description: "실행 기록과 사용량 메타데이터를 저장할 폴더를 직접 고릅니다.",
      },
    ],
    {
      title: "EggR 상태 저장 위치",
      placeHolder: "기존 프로젝트 파일은 이동하지 않습니다.",
    },
  );
  if (!stateChoice) return false;

  let selectedStateRoot = currentStateRoot;
  if (stateChoice.id === "default") {
    selectedStateRoot = defaultStateRoot();
  } else if (stateChoice.id === "custom") {
    const folder = await vscode.window.showOpenDialog({
      title: "EggR 상태 폴더 선택",
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(currentStateRoot),
      openLabel: "이 폴더 사용",
    });
    if (!folder?.[0]) return false;
    selectedStateRoot = path.resolve(folder[0].fsPath);
    if (isFilesystemRoot(selectedStateRoot)) {
      void vscode.window.showErrorMessage("드라이브 또는 파일시스템 루트는 EggR 상태 폴더로 사용할 수 없습니다.");
      return false;
    }
  }

  const selectedIds = new Set(selected.map((item) => item.id));
  await viewConfig.update("showAntigravity", selectedIds.has("antigravity"), vscode.ConfigurationTarget.Global);
  await viewConfig.update("showCodex", selectedIds.has("codex"), vscode.ConfigurationTarget.Global);
  await viewConfig.update("showLocalLlm", selectedIds.has("local_llm"), vscode.ConfigurationTarget.Global);
  updateRootsConfig({ state_root: selectedStateRoot });
  await context.globalState.update(DASHBOARD_SETUP_KEY, {
    completedAt: new Date().toISOString(),
    version: String(context.extension.packageJSON.version ?? "unknown"),
  });
  await refresh();

  const diagnostics = [
    ["Agy", findExecutable(["agy.exe", "agy"])],
    ["Codex", findCodexExecutable()],
    ["Ollama", findExecutable(["ollama.exe", "ollama"])],
    ["NVIDIA", findExecutable(["nvidia-smi.exe", "nvidia-smi"])],
  ];
  const summary = diagnostics
    .map(([name, executable]) => `${executable ? "✓" : "–"} ${name}`)
    .join(" · ");
  void vscode.window.showInformationMessage(`Dashboard 설정 완료 · ${summary}`);
  return true;
}

export async function runOrchestratorSetupWizard(
  context: vscode.ExtensionContext,
  installOrUpdate: () => Promise<void>,
): Promise<boolean> {
  const existing = readJsonObject(orchestratorSettingsPath());
  const existingRoutes = new Set(
    Array.isArray(existing.EnabledRoutes) ? existing.EnabledRoutes.filter((value): value is string => typeof value === "string") : [],
  );
  const routeItems: IdentifiedQuickPickItem[] = [
    {
      id: "main_agent",
      label: "주 에이전트 직접 처리",
      description: "항상 사용할 수 있는 기본 경로입니다.",
      picked: true,
    },
    {
      id: "codex",
      label: "Codex 위임",
      description: "고난도 구현·검토·토론을 Codex CLI에 맡깁니다.",
      picked: existingRoutes.size === 0 || existingRoutes.has("codex"),
    },
    {
      id: "local_llm",
      label: "로컬 LLM 위임",
      description: "요약·추출·전처리를 Ollama 또는 vLLM에 맡깁니다.",
      picked: existingRoutes.has("local_llm"),
    },
  ];
  const selectedRoutes = await vscode.window.showQuickPick(routeItems, {
    canPickMany: true,
    title: "EggR Orchestrator 최초 실행 설정",
    placeHolder: "사용할 실행 경로를 선택하세요. 주 에이전트 직접 처리는 항상 유지됩니다.",
  });
  if (selectedRoutes === undefined) return false;

  const enabledRoutes = new Set(selectedRoutes.map((item) => item.id));
  enabledRoutes.add("main_agent");

  let codexExe: string | null = typeof existing.CodexExe === "string" ? existing.CodexExe : null;
  if (enabledRoutes.has("codex")) {
    codexExe = findCodexExecutable(codexExe ?? undefined);
    if (!codexExe) {
      const selection = await vscode.window.showWarningMessage(
        "Codex CLI를 자동으로 찾지 못했습니다.",
        "codex.exe 선택",
        "Codex 경로 비활성화",
      );
      if (selection === "codex.exe 선택") {
        const files = await vscode.window.showOpenDialog({
          title: "Codex 실행 파일 선택",
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: process.platform === "win32" ? { Executable: ["exe", "cmd"] } : undefined,
        });
        if (!files?.[0]) return false;
        codexExe = files[0].fsPath;
      } else if (selection === "Codex 경로 비활성화") {
        enabledRoutes.delete("codex");
        codexExe = null;
      } else {
        return false;
      }
    }
  } else {
    codexExe = null;
  }

  let localLlm: OrchestratorLocalLlmSettings | null = normalizeExistingLocalLlm(existing.LocalLlm);
  if (enabledRoutes.has("local_llm")) {
    const existingLocal = isRecord(existing.LocalLlm) ? existing.LocalLlm : {};
    const provider = await vscode.window.showQuickPick<IdentifiedQuickPickItem>(
      [
        { id: "ollama", label: "Ollama", description: "로컬 Ollama API를 사용합니다." },
        { id: "vllm", label: "vLLM / OpenAI 호환 API", description: "로컬 또는 원격 OpenAI 호환 endpoint를 사용합니다." },
      ],
      {
        title: "로컬 LLM 공급자",
        placeHolder: "API 키 값은 저장하지 않습니다.",
      },
    );
    if (!provider) return false;

    const defaultEndpoint =
      typeof existingLocal.Endpoint === "string" && existingLocal.Endpoint
        ? existingLocal.Endpoint
        : provider.id === "ollama"
          ? "http://127.0.0.1:11434"
          : "http://127.0.0.1:8000/v1";
    const endpoint = await vscode.window.showInputBox({
      title: "로컬 LLM endpoint",
      prompt: "HTTP(S) 주소만 저장합니다. API 키는 환경변수를 사용하세요.",
      value: defaultEndpoint,
      validateInput: validateHttpEndpoint,
    });
    if (endpoint === undefined) return false;

    const existingPolicy = isRecord(existingLocal.HardwarePolicy) ? existingLocal.HardwarePolicy : {};
    const selectionMode = await vscode.window.showQuickPick<IdentifiedQuickPickItem>(
      [
        {
          id: "auto",
          label: "VRAM·GPU 기능에 맞춰 자동 선택",
          description: "설치 모델, 사용 가능한 VRAM, backend 지원, 작업 이력을 함께 평가합니다.",
        },
        {
          id: "user_default",
          label: "사용자 지정 모델 우선",
          description: "지정 모델을 유지하며 실행 전 하드웨어 부적합 가능성만 경고합니다.",
        },
      ],
      {
        title: "로컬 모델 선택 정책",
        placeHolder: "자동 선택은 매 실행 시 현재 컴퓨터를 다시 감지합니다.",
      },
    );
    if (!selectionMode) return false;

    let model: string | null = null;
    if (selectionMode.id === "user_default") {
      const modelInput = await vscode.window.showInputBox({
        title: "사용자 기본 로컬 모델",
        prompt: "Ollama 또는 vLLM에서 사용하는 정확한 모델 ID를 입력하세요.",
        value: typeof existingLocal.Model === "string" ? existingLocal.Model : "",
        validateInput: (value) => (value.trim() ? undefined : "사용자 지정 모드에는 모델 ID가 필요합니다."),
      });
      if (modelInput === undefined) return false;
      model = modelInput.trim();
    }

    const reserveVram = await vscode.window.showInputBox({
      title: "남겨 둘 GPU 메모리",
      prompt: "화면·IDE·다른 프로세스를 위해 자동 선택에서 제외할 VRAM(GB)입니다.",
      value:
        typeof existingPolicy.ReserveVramGB === "number" && Number.isFinite(existingPolicy.ReserveVramGB)
          ? String(existingPolicy.ReserveVramGB)
          : "2",
      validateInput: validateReserveVram,
    });
    if (reserveVram === undefined) return false;

    const offloadChoice = await vscode.window.showQuickPick<IdentifiedQuickPickItem>(
      [
        {
          id: "no",
          label: "GPU에 맞는 모델만 선택",
          description: "예상 VRAM을 넘는 후보를 제외합니다.",
        },
        {
          id: "yes",
          label: "CPU offload 허용",
          description: "느려질 수 있지만 VRAM을 넘는 후보도 fallback으로 남깁니다.",
        },
      ],
      {
        title: "VRAM 부족 시 처리",
      },
    );
    if (!offloadChoice) return false;

    localLlm = {
      Provider: provider.id as "ollama" | "vllm",
      Endpoint: endpoint.trim(),
      Model: model,
      ...(provider.id === "vllm" ? { ApiKeyEnvironmentVariable: "VLLM_API_KEY" } : {}),
      HardwarePolicy: {
        Mode: selectionMode.id as "auto" | "user_default",
        ReserveVramGB: Number(reserveVram),
        AllowCpuOffload: offloadChoice.id === "yes",
      },
    };
  }

  const defaultRouteItems = [...enabledRoutes].map<IdentifiedQuickPickItem>((route) => ({
    id: route,
    label:
      route === "main_agent"
        ? "주 에이전트 직접 처리"
        : route === "codex"
          ? "Codex 위임"
          : "로컬 LLM 위임",
  }));
  const defaultRoute = await vscode.window.showQuickPick(defaultRouteItems, {
    title: "기본 실행 경로",
    placeHolder: "작업별 판단이 없을 때 사용할 기본값입니다.",
  });
  if (!defaultRoute) return false;

  const gpuSummary = enabledRoutes.has("local_llm") ? summarizeDetectedHardware(detectNvidiaGpus()) : "";
  const confirmation = await vscode.window.showInformationMessage(
    `경로: ${[...enabledRoutes].join(", ")} · 기본: ${defaultRoute.id}`,
    {
      modal: true,
      detail:
        "기존 오케스트레이터는 백업한 뒤 갱신합니다. 비밀정보는 설정 파일에 저장하지 않습니다." +
        (gpuSummary ? `\n현재 하드웨어: ${gpuSummary}` : ""),
    },
    "설치 및 저장",
  );
  if (confirmation !== "설치 및 저장") return false;

  await installOrUpdate();
  const settings: OrchestratorSettings = {
    SchemaVersion: 1,
    CodexExe: codexExe,
    EnabledRoutes: [...enabledRoutes],
    DefaultRoute: defaultRoute.id,
    LocalLlm: localLlm,
    FirstRunCompletedAt: new Date().toISOString(),
    ConfiguredBy: `antigravity-dashboard/${String(context.extension.packageJSON.version ?? "unknown")}`,
  };
  writeJsonObjectAtomic(orchestratorSettingsPath(), { ...existing, ...settings });
  void vscode.window.showInformationMessage("EggR Orchestrator 최초 실행 설정을 완료했습니다.");
  return true;
}

export async function runPrivateKnowledgeSetupWizard(context: vscode.ExtensionContext): Promise<boolean> {
  const installedScript = installedKnowledgeWizardPath();
  if (!installedScript) {
    const action = await vscode.window.showWarningMessage(
      "EggR private-Git Knowledge 마법사가 설치되지 않았습니다. environment-bootstrap의 Windows 복구 도구를 먼저 설치하세요.",
      "설정 안내 열기",
    );
    if (action === "설정 안내 열기") {
      const guide = path.join(context.extensionPath, "assets", "private-git-knowledge.md");
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(guide));
      await vscode.window.showTextDocument(document, { preview: false });
    }
    return false;
  }

  const terminal = vscode.window.createTerminal({
    name: "EggR Private Git Knowledge Setup",
    shellPath: process.platform === "win32" ? "powershell.exe" : "pwsh",
    shellArgs: ["-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installedScript],
  });
  terminal.show();
  return true;
}

export async function runFirstRunCoordinator(
  context: vscode.ExtensionContext,
  refresh: () => Promise<void>,
  installOrUpdate: () => Promise<void>,
): Promise<void> {
  const status = getFirstRunStatus(context);
  const choice = await vscode.window.showQuickPick<IdentifiedQuickPickItem>(
    [
      {
        id: "dashboard",
        label: "$(dashboard) Dashboard 설정",
        description: status.dashboard ? "완료" : "설정 필요",
      },
      {
        id: "orchestrator",
        label: "$(type-hierarchy-sub) Orchestrator 설정",
        description: status.orchestrator ? "완료" : "설정 필요",
      },
      {
        id: "knowledge",
        label: "$(repo) Private Git Knowledge 설정",
        description: status.knowledge ? "완료" : "설정 필요",
      },
    ],
    {
      title: "EggR 최초 실행 설정",
      placeHolder: "세 기능은 독립적으로 설정·재실행할 수 있습니다.",
    },
  );
  if (!choice) return;

  if (choice.id === "dashboard") {
    await runDashboardSetupWizard(context, refresh);
  } else if (choice.id === "orchestrator") {
    await runOrchestratorSetupWizard(context, installOrUpdate);
  } else {
    await runPrivateKnowledgeSetupWizard(context);
  }
}

export function getFirstRunStatus(context: vscode.ExtensionContext): FirstRunStatus {
  const roots = readJsonObject(rootsConfigPath());
  const knowledgePath = typeof roots.knowledge === "string" ? roots.knowledge : "";
  const knowledgeRemote = typeof roots.knowledge_remote === "string" ? roots.knowledge_remote : "";
  const knowledgeMode = typeof roots.knowledge_mode === "string" ? roots.knowledge_mode : "";
  const orchestrator = readJsonObject(orchestratorSettingsPath());
  const knowledgeConfigured =
    knowledgeMode === "local_only" ||
    Boolean(knowledgeRemote.trim()) ||
    (knowledgeMode === "private_remote" && Boolean(knowledgeRemote.trim()));
  return {
    dashboard: Boolean(context.globalState.get(DASHBOARD_SETUP_KEY)),
    orchestrator:
      typeof orchestrator.FirstRunCompletedAt === "string" &&
      fs.existsSync(path.join(os.homedir(), ".gemini", "config", "plugins", "codex-orchestrator-plugin")),
    knowledge:
      knowledgeConfigured &&
      Boolean(knowledgePath.trim()) &&
      fs.existsSync(path.join(knowledgePath, ".git")),
  };
}

export async function offerFirstRunSetup(
  context: vscode.ExtensionContext,
  refresh: () => Promise<void>,
  installOrUpdate: () => Promise<void>,
): Promise<void> {
  if (context.globalState.get(FIRST_RUN_PROMPT_KEY)) return;
  await context.globalState.update(FIRST_RUN_PROMPT_KEY, new Date().toISOString());
  const status = getFirstRunStatus(context);
  if (status.dashboard && status.orchestrator && status.knowledge) return;

  const action = await vscode.window.showInformationMessage(
    "EggR의 Dashboard, Orchestrator, private-Git Knowledge 최초 실행 설정이 준비되었습니다.",
    "설정 시작",
    "나중에",
  );
  if (action === "설정 시작") {
    await runFirstRunCoordinator(context, refresh, installOrUpdate);
  }
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

function normalizeExistingLocalLlm(value: unknown): OrchestratorLocalLlmSettings | null {
  if (!isRecord(value)) return null;
  const provider = value.Provider === "vllm" ? "vllm" : value.Provider === "ollama" ? "ollama" : null;
  if (!provider || typeof value.Endpoint !== "string") return null;
  const policy = isRecord(value.HardwarePolicy) ? value.HardwarePolicy : {};
  const mode = policy.Mode === "user_default" ? "user_default" : "auto";
  const reserve = typeof policy.ReserveVramGB === "number" && Number.isFinite(policy.ReserveVramGB)
    ? policy.ReserveVramGB
    : 2;
  return {
    Provider: provider,
    Endpoint: value.Endpoint,
    Model: typeof value.Model === "string" && value.Model.trim() ? value.Model : null,
    ...(typeof value.ApiKeyEnvironmentVariable === "string"
      ? { ApiKeyEnvironmentVariable: value.ApiKeyEnvironmentVariable }
      : {}),
    HardwarePolicy: {
      Mode: mode,
      ReserveVramGB: reserve,
      AllowCpuOffload: policy.AllowCpuOffload === true,
    },
  };
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
        computeCapability: Number.isFinite(computeCapability) ? computeCapability : null,
      };
    })
    .filter((gpu) =>
      Number.isFinite(gpu.index) &&
      Number.isFinite(gpu.totalVramMiB) &&
      Number.isFinite(gpu.freeVramMiB),
    );
}

function queryNvidiaSmi(executable: string, includeComputeCapability: boolean): string | undefined {
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
    return "NVIDIA GPU를 감지하지 못했습니다. 실행 시 backend가 다시 확인합니다.";
  }
  return gpus
    .map((gpu) => {
      const freeGiB = (gpu.freeVramMiB / 1024).toFixed(1);
      const totalGiB = (gpu.totalVramMiB / 1024).toFixed(1);
      const cc = gpu.computeCapability === null ? "CC unknown" : `CC ${gpu.computeCapability.toFixed(1)}`;
      const precisionHint = tensorRtRtxPrecisionHint(gpu.computeCapability);
      return `${gpu.name} ${freeGiB}/${totalGiB}GB free (${cc}; ${precisionHint})`;
    })
    .join(" · ");
}

function tensorRtRtxPrecisionHint(computeCapability: number | null): string {
  if (computeCapability === null) return "backend precision unknown";
  if (computeCapability >= 12.0) return "TensorRT-RTX native FP8/FP4";
  if (computeCapability >= 8.9) return "TensorRT-RTX native FP8; FP4 unavailable";
  if (computeCapability >= 8.6) return "TensorRT-RTX BF16/INT4; native FP8/FP4 unavailable";
  return "backend-specific precision check required";
}

function updateRootsConfig(patch: Record<string, unknown>): void {
  const configPath = rootsConfigPath();
  writeJsonObjectAtomic(configPath, { ...readJsonObject(configPath), ...patch });
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`설정 파일은 JSON object여야 합니다: ${filePath}`);
  }
  return parsed;
}

function writeJsonObjectAtomic(filePath: string, value: Record<string, unknown>): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function rootsConfigPath(): string {
  return path.join(os.homedir(), ".config", "eggr", "roots.json");
}

function orchestratorSettingsPath(): string {
  return path.join(os.homedir(), ".gemini", "config", "codex_plugin_settings.json");
}

function defaultStateRoot(): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "EggR", "state");
  }
  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, "eggr");
  }
  return path.join(os.homedir(), ".local", "state", "eggr");
}

function isFilesystemRoot(candidate: string): boolean {
  return path.parse(path.resolve(candidate)).root === path.resolve(candidate);
}

function installedKnowledgeWizardPath(): string | undefined {
  const candidates =
    process.platform === "win32"
      ? [path.join(process.env.LOCALAPPDATA ?? "", "EggR", "bin", "initialize-eggr-knowledge.ps1")]
      : [path.join(os.homedir(), ".local", "bin", "initialize-eggr-knowledge")];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function findCodexExecutable(existing?: string): string | null {
  const candidates = [
    existing,
    process.env.CODEX_EXE,
    findExecutable(["codex.exe", "codex"]),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe") : undefined,
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return path.resolve(candidate);
  }
  if (process.env.LOCALAPPDATA) {
    const root = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    if (fs.existsSync(root)) {
      const matches = findFiles(root, "codex.exe");
      matches.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
      if (matches[0]) return matches[0];
    }
  }
  return null;
}

function findExecutable(names: string[]): string | null {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  for (const name of names) {
    try {
      const result = execFileSync(locator, [name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      })
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find(Boolean);
      if (result) return result;
    } catch {
      // Try the next command name.
    }
  }
  return null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
