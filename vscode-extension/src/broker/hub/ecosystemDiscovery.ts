import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import type {
  HubConfig,
  EcosystemSnapshot,
  EcosystemConnectorStatus,
  VaultDiscoveryInfo,
  VaultSource,
} from "./index";
import { resolvePlatformStateRoot } from "../platformPaths";
import { findExecutableOnPath } from "../executable";

let cachedSnapshot: EcosystemSnapshot | undefined;
let lastScanTime = 0;
const CACHE_TTL_MS = 15000;

function findBin(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  const names = platform === "win32"
    ? [name, `${name}.cmd`, `${name}.exe`, `${name}.bat`, `${name}.ps1`]
    : [name];
  return findExecutableOnPath(names, env);
}

function probeEndpoint(urlStr: string, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const req = http.get(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          timeout: timeoutMs,
        },
        (res) => {
          res.resume();
          resolve((res.statusCode ?? 500) < 400);
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

function inspectVault(vaultPath: string, source: VaultSource): VaultDiscoveryInfo {
  const installedPlugins: string[] = [];
  const enabledPlugins: string[] = [];

  const obsidianDir = path.join(vaultPath, ".obsidian");
  const pluginsDir = path.join(obsidianDir, "plugins");
  const communityPluginsJson = path.join(obsidianDir, "community-plugins.json");

  if (fs.existsSync(pluginsDir)) {
    try {
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          installedPlugins.push(ent.name);
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  if (fs.existsSync(communityPluginsJson)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(communityPluginsJson, "utf8"));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string") {
            enabledPlugins.push(item);
          }
        }
      }
    } catch {
      // Ignore file read or parse errors
    }
  }

  return {
    path: vaultPath,
    name: path.basename(vaultPath) || "Vault",
    source,
    installedPlugins,
    enabledPlugins,
  };
}

export async function scanEcosystem(
  config?: HubConfig,
  forceRefresh?: boolean,
  customPlatform?: NodeJS.Platform,
  customEnv?: NodeJS.ProcessEnv
): Promise<EcosystemSnapshot> {
  const platform = customPlatform || process.platform;
  const env = customEnv || process.env;
  const homedir = os.homedir();
  const stateRoot = resolvePlatformStateRoot(undefined, platform, env, homedir);

  if (!forceRefresh && cachedSnapshot && (Date.now() - lastScanTime < CACHE_TTL_MS)) {
    return cachedSnapshot;
  }

  // Support deterministic fixture for testing
  const fixture = env.INTEGRATED_POWER_ECOSYSTEM_FIXTURE?.trim();
  if (fixture) {
    try {
      let parsed: any;
      if (fixture.startsWith("{") || fixture.startsWith("[")) {
        parsed = JSON.parse(fixture);
      } else if (fs.existsSync(fixture)) {
        parsed = JSON.parse(fs.readFileSync(fixture, "utf8"));
      }
      if (parsed) {
        const snapshot: EcosystemSnapshot = {
          scannedAt: parsed.scannedAt || new Date().toISOString(),
          platform: parsed.platform || platform,
          connectors: parsed.connectors || [],
          vaults: parsed.vaults || [],
          activeTodoFilePath: parsed.activeTodoFilePath || path.join(stateRoot, "Todo.md"),
        };
        cachedSnapshot = snapshot;
        lastScanTime = Date.now();
        return snapshot;
      }
    } catch {
      // Fall through to real scan
    }
  }

  const connectors: EcosystemConnectorStatus[] = [];

  // 1. Messenger: OpenClaw
  const openclawBin = findBin("openclaw", env, platform);
  const openclawDir = path.join(homedir, ".openclaw");
  if (openclawBin) {
    connectors.push({
      id: "openclaw",
      label: "OpenClaw Messenger Gateway",
      category: "messenger",
      state: "ready",
      protocol: "acp",
      detectedPath: openclawBin,
      details: "OpenClaw CLI detected on PATH (ACP dispatch ready)",
      enabled: true,
    });
  } else if (fs.existsSync(openclawDir)) {
    connectors.push({
      id: "openclaw",
      label: "OpenClaw Messenger Gateway",
      category: "messenger",
      state: "ready",
      protocol: "acp",
      detectedPath: openclawDir,
      details: "OpenClaw configuration directory detected at ~/.openclaw",
      enabled: true,
    });
  } else {
    connectors.push({
      id: "openclaw",
      label: "OpenClaw Messenger Gateway",
      category: "messenger",
      state: "not_installed",
      protocol: "acp",
      installHint: "npm install -g openclaw or pip install openclaw",
      enabled: true,
    });
  }

  // 2. Harnesses: hermes, opencodex, codex, agy, claude
  const harnesses: Array<{ id: string; label: string; names: string[]; hint: string }> = [
    { id: "hermes", label: "Hermes Agent Protocol", names: ["hermes"], hint: "pip install hermes-agent" },
    { id: "opencodex", label: "OpenCodex CLI Harness", names: ["opencodex"], hint: "Install OpenCodex CLI" },
    { id: "codex", label: "OpenAI Codex CLI", names: ["codex"], hint: "npm install -g @openai/codex" },
    { id: "agy", label: "Antigravity CLI / Harness", names: ["agy", "antigravity"], hint: "Antigravity IDE harness" },
    { id: "claude", label: "Claude Code / Desktop CLI", names: ["claude"], hint: "npm install -g @anthropic-ai/claude-code" },
  ];

  for (const h of harnesses) {
    let detected: string | undefined;
    for (const name of h.names) {
      detected = findBin(name, env, platform);
      if (detected) break;
    }
    if (detected) {
      connectors.push({
        id: h.id,
        label: h.label,
        category: "harness",
        state: "ready",
        protocol: "cli",
        detectedPath: detected,
        details: `${h.label} executable detected on PATH`,
        enabled: true,
      });
    } else {
      connectors.push({
        id: h.id,
        label: h.label,
        category: "harness",
        state: "not_installed",
        protocol: "cli",
        installHint: h.hint,
        enabled: true,
      });
    }
  }

  // 3. Local LLMs: ollama, lm-studio, vllm (run parallel probes)
  const [ollamaOnline, lmStudioOnline, vllmOnline] = await Promise.all([
    probeEndpoint("http://127.0.0.1:11434/api/tags", 400),
    probeEndpoint("http://127.0.0.1:1234/v1/models", 400),
    probeEndpoint("http://127.0.0.1:8000/v1/models", 400),
  ]);

  // Ollama
  if (ollamaOnline) {
    connectors.push({
      id: "ollama",
      label: "Ollama Local LLM",
      category: "local_llm",
      state: "ready",
      protocol: "openai-v1",
      endpoint: "http://127.0.0.1:11434",
      details: "Ollama server active on port 11434",
      enabled: true,
    });
  } else {
    const ollamaManifests = path.join(homedir, ".ollama", "models", "manifests");
    const ollamaBin = findBin("ollama", env, platform);
    if (fs.existsSync(ollamaManifests)) {
      connectors.push({
        id: "ollama",
        label: "Ollama Local LLM",
        category: "local_llm",
        state: "installed_offline",
        protocol: "openai-v1",
        endpoint: "http://127.0.0.1:11434",
        detectedPath: ollamaManifests,
        details: "Ollama local model manifests detected; service offline",
        enabled: true,
      });
    } else if (ollamaBin) {
      connectors.push({
        id: "ollama",
        label: "Ollama Local LLM",
        category: "local_llm",
        state: "installed_offline",
        protocol: "openai-v1",
        endpoint: "http://127.0.0.1:11434",
        detectedPath: ollamaBin,
        details: "Ollama binary on PATH; service offline",
        enabled: true,
      });
    } else {
      connectors.push({
        id: "ollama",
        label: "Ollama Local LLM",
        category: "local_llm",
        state: "not_installed",
        protocol: "openai-v1",
        endpoint: "http://127.0.0.1:11434",
        installHint: "Download and install Ollama from https://ollama.com",
        enabled: true,
      });
    }
  }

  // LM Studio
  if (lmStudioOnline) {
    connectors.push({
      id: "lm-studio",
      label: "LM Studio Local Server",
      category: "local_llm",
      state: "ready",
      protocol: "openai-v1",
      endpoint: "http://127.0.0.1:1234/v1",
      details: "LM Studio inference server active on port 1234",
      enabled: true,
    });
  } else {
    const lmsBin = findBin("lms", env, platform);
    if (lmsBin) {
      connectors.push({
        id: "lm-studio",
        label: "LM Studio Local Server",
        category: "local_llm",
        state: "installed_offline",
        protocol: "openai-v1",
        endpoint: "http://127.0.0.1:1234/v1",
        detectedPath: lmsBin,
        details: "LM Studio CLI found; local server offline",
        enabled: true,
      });
    } else {
      connectors.push({
        id: "lm-studio",
        label: "LM Studio Local Server",
        category: "local_llm",
        state: "not_installed",
        protocol: "openai-v1",
        endpoint: "http://127.0.0.1:1234/v1",
        installHint: "Download LM Studio from https://lmstudio.ai",
        enabled: true,
      });
    }
  }

  // vLLM
  if (vllmOnline) {
    connectors.push({
      id: "vllm",
      label: "vLLM Inference Engine",
      category: "local_llm",
      state: "ready",
      protocol: "openai-v1",
      endpoint: "http://127.0.0.1:8000/v1",
      details: "vLLM server active on port 8000",
      enabled: true,
    });
  } else {
    const vllmBin = findBin("vllm", env, platform);
    if (vllmBin) {
      connectors.push({
        id: "vllm",
        label: "vLLM Inference Engine",
        category: "local_llm",
        state: "installed_offline",
        protocol: "openai-v1",
        endpoint: "http://127.0.0.1:8000/v1",
        detectedPath: vllmBin,
        details: "vLLM executable found on PATH; server offline",
        enabled: true,
      });
    } else {
      connectors.push({
        id: "vllm",
        label: "vLLM Inference Engine",
        category: "local_llm",
        state: "not_installed",
        protocol: "openai-v1",
        endpoint: "http://127.0.0.1:8000/v1",
        installHint: "pip install vllm",
        enabled: true,
      });
    }
  }

  // 4. Document & Media: docling, mineru, paddleocr, czkawka
  const docMedia: Array<{ id: string; label: string; names: string[]; hint: string }> = [
    { id: "docling", label: "Docling Document Parser", names: ["docling"], hint: "pip install docling" },
    { id: "mineru", label: "MinerU / Magic-PDF OCR", names: ["mineru", "magic-pdf"], hint: "pip install magic-pdf[full]" },
    { id: "paddleocr", label: "PaddleOCR Engine", names: ["paddleocr"], hint: "pip install paddlepaddle paddleocr" },
    { id: "czkawka", label: "Czkawka Media Cleaner", names: ["czkawka", "czkawka_cli", "czkawka_gui"], hint: "Download Czkawka from GitHub" },
  ];

  for (const dm of docMedia) {
    let detected: string | undefined;
    for (const name of dm.names) {
      detected = findBin(name, env, platform);
      if (detected) break;
    }
    if (detected) {
      connectors.push({
        id: dm.id,
        label: dm.label,
        category: "document_media",
        state: "ready",
        protocol: "cli",
        detectedPath: detected,
        details: `${dm.label} detected on PATH`,
        enabled: true,
      });
    } else {
      connectors.push({
        id: dm.id,
        label: dm.label,
        category: "document_media",
        state: "not_installed",
        protocol: "cli",
        installHint: dm.hint,
        enabled: true,
      });
    }
  }

  // 5. Obsidian Vaults & Connector
  let obsidianConfigPath: string;
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(homedir, "AppData", "Roaming");
    obsidianConfigPath = path.join(appData, "obsidian", "obsidian.json");
  } else if (platform === "darwin") {
    obsidianConfigPath = path.join(homedir, "Library", "Application Support", "obsidian", "obsidian.json");
  } else {
    const xdgConfig = env.XDG_CONFIG_HOME || path.join(homedir, ".config");
    obsidianConfigPath = path.join(xdgConfig, "obsidian", "obsidian.json");
  }

  const vaults: VaultDiscoveryInfo[] = [];
  const vaultPathSet = new Set<string>();

  if (config?.customVaultPath && fs.existsSync(config.customVaultPath)) {
    const norm = path.resolve(config.customVaultPath);
    vaultPathSet.add(norm);
    vaults.push(inspectVault(norm, "user_config"));
  }

  if (fs.existsSync(obsidianConfigPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(obsidianConfigPath, "utf8"));
      if (parsed?.vaults && typeof parsed.vaults === "object") {
        for (const vKey of Object.keys(parsed.vaults)) {
          const vObj = parsed.vaults[vKey];
          if (vObj?.path && typeof vObj.path === "string" && fs.existsSync(vObj.path)) {
            const norm = path.resolve(vObj.path);
            if (!vaultPathSet.has(norm)) {
              vaultPathSet.add(norm);
              vaults.push(inspectVault(norm, "obsidian_registry"));
            }
          }
        }
      }
    } catch {
      // Ignore parse failure
    }
  }

  const hasRestApi = vaults.some((v) => v.enabledPlugins.includes("obsidian-local-rest-api"));
  const keyPlugins = ["obsidian-local-rest-api", "smart-connections", "obsidian-image-converter", "obsidian-linter", "obsidian-git"];
  const allDetectedPlugins = new Set<string>();
  for (const v of vaults) {
    for (const p of v.enabledPlugins) {
      if (keyPlugins.includes(p)) allDetectedPlugins.add(p);
    }
  }

  if (vaults.length > 0) {
    connectors.push({
      id: "obsidian",
      label: "Obsidian Knowledge Vault",
      category: "knowledge_vault",
      state: "ready",
      protocol: hasRestApi ? "rest" : "plugin",
      details: `${vaults.length} vault(s) registered (plugins: ${Array.from(allDetectedPlugins).join(", ") || "standard"})`,
      enabled: true,
    });
  } else {
    connectors.push({
      id: "obsidian",
      label: "Obsidian Knowledge Vault",
      category: "knowledge_vault",
      state: "not_installed",
      protocol: "plugin",
      installHint: "Install Obsidian and register a vault",
      enabled: true,
    });
  }

  // 6. Active Todo file resolution
  let activeTodoFilePath = "";
  if (config?.customTodoFilePath) {
    activeTodoFilePath = path.resolve(config.customTodoFilePath);
  } else {
    for (const v of vaults) {
      const inboxTodo = path.join(v.path, "00 Inbox", "Todo.md");
      if (fs.existsSync(inboxTodo)) {
        activeTodoFilePath = inboxTodo;
        break;
      }
      const rootTodo = path.join(v.path, "Todo.md");
      if (fs.existsSync(rootTodo)) {
        activeTodoFilePath = rootTodo;
        break;
      }
    }
  }
  if (!activeTodoFilePath) {
    activeTodoFilePath = path.join(stateRoot, "Todo.md");
  }

  // Apply disabled connectors preference
  const disabledSet = new Set(config?.disabledConnectors || []);
  for (const c of connectors) {
    c.enabled = !disabledSet.has(c.id);
  }

  const snapshot: EcosystemSnapshot = {
    scannedAt: new Date().toISOString(),
    platform,
    connectors,
    vaults,
    activeTodoFilePath,
  };

  cachedSnapshot = snapshot;
  lastScanTime = Date.now();
  return snapshot;
}
