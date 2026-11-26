import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import * as crypto from "crypto";
import { BrokerConflictError, IntegratedPowerBroker } from "./broker";
import { HubController } from "./hub/hubController";
import { CreateTaskInput, DelegateTaskInput } from "./protocol";
import { integratedPowerProtocolBoundary } from "./protocols";
import { processMcpRequest } from "./mcpServer";
import { AgUiEvent, validateAgUiEvent } from "./protocols";
import { listHostIntegrations, saveHostIntegrationConfig } from "./hostIntegrations";
import { discoverInstallations } from "./installation";
import { chatgptLocalMcpSpec, claudeLocalMcpSpec, getMcpConfigSnippet, registerClaudeLocalMcp } from "./registration";
import { getAutoStartStatus, setAutoStart } from "./autostart";
import { requestForceRefresh, scanLiveTokenStatus, LiveTokenStatus } from "./tokenScanner";
import { QuotaSettingsStore, QuotaSettingsWrite } from "./quotaSettingsStore";
import { getLowestCodexModel, findCodexCliSync } from "./codexAppServer";
import { getLowestAgyModel } from "./agyModelResolver";
import { findExecutableOnPath } from "./executable";
import { AgyQuotaClient } from "../AgyQuotaClient";
import { eggRWorkspaceId, resolveEggRWorkspaceDescriptor, resolveIntegratedPowerStateRoot, workspaceStoragePathForFolder } from "../storagePath";

export const BROKER_SCHEMA_VERSION = 2;
export const BROKER_CAPABILITIES = [
  "tasks.read", "tasks.write", "approvals.read", "approvals.userDecision", "tokens.read",
  "providers.external", "quota.prewarm", "quota.prewarm.notifications", "workspaces.read", "runs.read", "metrics.localLlm.read",
  "quota.settings.read", "quota.settings.write", "quota.notifications.claim",
  "hub.read", "hub.write", "hub.dispatch",
];
const sharedQuota = require(path.join(__dirname, "shared-quota.js")) as {
  detectRefilledQuotaWindows(previous: unknown, current: unknown, alreadyNotified: Set<string> | readonly string[]): {
    notifications: Array<{ target: { id: string; configKey: string; model: string; window: string; title: string; message: string }; previousPercent: number; currentPercent: number }>;
    updatedNotifiedSet: Set<string>;
  };
};
const sharedTelemetry = require("../../../shared/telemetry/runState") as {
  parseRunJsonl(text: string, options?: { normalizeArtifactPath?: (value: string) => string | undefined }): {
    runs: Array<{ id: string; active: boolean; artifacts: Array<{ workspacePath?: string }> }>;
    activeRuns: unknown[];
    parseErrors: string[];
  };
  parseLocalLlmMetricsCsv(text: string): { metrics: unknown[]; parseErrors: string[] };
};

export interface BrokerServerHandle {
  port: number;
  close(): Promise<void>;
}

import { PrewarmNotificationEvent } from "./client";

export interface BrokerServerOptions {
  stateRoot?: string;
  staticDir?: string;
  tokenStatusReader?: () => Promise<LiveTokenStatus>;
  prewarmDispatcher?: (target: "antigravity" | "argon" | "opus" | "codex", model: string, stateRoot?: string, account?: string) => Promise<{ spawned: boolean; cancelledEarly?: boolean; durationMs?: number; error?: string }>;
  autoSchedule?: boolean;
  prewarmVerifyDelayMs?: number;
  prewarmVerifyRetryDelayMs?: number;
}

interface PrewarmRequest {
  model?: string;
  window?: "5h" | "weekly";
  manual?: boolean;
  account?: string;
  idempotencyKey?: string;
  expectedSettingsRevision?: number;
}

interface PrewarmResult {
  ok: boolean;
  status: "dispatched" | "duplicate" | "failed" | "skipped";
  timerConfirmed: boolean;
  claimId?: string;
  error?: string;
  model?: string;
  targetModel?: string;
  account?: string;
  cancelledEarly?: boolean;
  durationMs?: number;
}

interface PersistedPrewarmArbitration {
  schemaVersion: 1;
  windows: Record<string, { windowId: string; status: "dispatching" | "dispatched" | "failed"; attemptedAt: number; claimId: string; error?: string }>;
  idempotency: Record<string, { fingerprint: string; result: PrewarmResult }>;
}

const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

export function resolveStaticDirectory(optionsStaticDir?: string): string | undefined {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const candidates: Array<string | undefined> = [
    optionsStaticDir,
    process.env.INTEGRATED_POWER_STATIC_DIR,
    path.join(localAppData, "IntegratedPower", "dist"),
    "D:\\Workspace\\Integrated POWER\\packages\\control-center\\dist",
    path.resolve(__dirname, "../../dist"),
    path.resolve(__dirname, "../dist"),
    path.resolve(__dirname, "../../../packages/control-center/dist"),
    path.resolve(__dirname, "../../packages/control-center/dist"),
    path.resolve(__dirname, "../control-center/dist"),
    path.resolve(process.cwd(), "packages/control-center/dist"),
    path.resolve(process.cwd(), "dist"),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        const indexPath = path.join(resolved, "index.html");
        if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
          return resolved;
        }
      }
    } catch {
      // ignore access/filesystem errors
    }
  }
  return undefined;
}

export function tryServeStaticFile(
  staticDir: string,
  pathname: string,
  response: http.ServerResponse,
  method: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  // Sanitize path and prevent directory traversal
  const resolvedRoot = path.resolve(staticDir);
  const cleanRelative = path.normalize(decodedPath).replace(/^(\.\.[\/\\])+/, "").replace(/^[\/\\]+/, "");
  let targetPath = path.resolve(resolvedRoot, cleanRelative);

  const relative = path.relative(resolvedRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }

  try {
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        targetPath = path.join(targetPath, "index.html");
      }
    } else {
      // If not found and pathname has no file extension (SPA route), fallback to index.html
      if (pathname.startsWith("/v1/") || pathname.startsWith("/api/")) {
        return false;
      }
      const ext = path.extname(cleanRelative);
      if (!ext) {
        targetPath = path.join(resolvedRoot, "index.html");
      } else {
        return false;
      }
    }
  } catch {
    return false;
  }

  let stat: fs.Stats;
  try {
    if (!fs.existsSync(targetPath)) {
      return false;
    }
    stat = fs.statSync(targetPath);
    if (!stat.isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = STATIC_MIME_TYPES[ext] ?? "application/octet-stream";

  let cacheControl = "no-cache";
  if (ext === ".html" || ext === ".htm") {
    cacheControl = "no-cache";
  } else if (pathname.startsWith("/assets/")) {
    cacheControl = "public, max-age=31536000, immutable";
  } else {
    cacheControl = "no-cache";
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Cache-Control", cacheControl);
  response.setHeader("Content-Length", stat.size);

  if (method === "HEAD") {
    response.end();
    return true;
  }

  const stream = fs.createReadStream(targetPath);
  stream.on("error", () => {
    if (!response.headersSent) {
      response.statusCode = 500;
      response.end();
    }
  });
  stream.pipe(response);
  return true;
}

export async function startBrokerServer(
  broker: IntegratedPowerBroker,
  requestedPort = 0,
  options: BrokerServerOptions = {},
): Promise<BrokerServerHandle> {
  const stateRoot = path.resolve(options.stateRoot ?? resolveIntegratedPowerStateRoot());
  const staticDir = resolveStaticDirectory(options.staticDir);
  const hubController = broker.hubController ?? new HubController(stateRoot, broker);
  if (!broker.hubController) broker.hubController = hubController;
  const quotaSettingsStore = new QuotaSettingsStore(stateRoot);
  const readTokenStatus = options.tokenStatusReader ?? (() => scanLiveTokenStatus());
  const dispatchPrewarm = options.prewarmDispatcher ?? ((target, model, root, account) => spawnPrewarm(target, model, root ?? stateRoot, account));
  const prewarmStatePath = path.join(stateRoot, "broker", "prewarm-arbitration.json");
  const quotaNotificationStatePath = path.join(stateRoot, "broker", "quota-notification-state.json");
  let quotaNotificationQueue = Promise.resolve();
  let serverClosed = false;
  const serverClosedRef = { closed: false };
  let nextPrewarmSeqId = 1;
  const prewarmConsumerCursors = new Map<string, number>();
  const prewarmNotificationQueue: PrewarmNotificationEvent[] = [];
  const emitPrewarmNotification = (event: PrewarmNotificationEvent) => {
    const assigned: PrewarmNotificationEvent = {
      ...event,
      seqId: event.seqId ?? nextPrewarmSeqId++,
    };
    prewarmNotificationQueue.push(assigned);
    if (prewarmNotificationQueue.length > 50) prewarmNotificationQueue.shift();
  };
  const server = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    // The desktop control center is a local Tauri webview. This is intentionally
    // loopback-only; the server never binds to a LAN/public interface.
    const origin = request.headers.origin;
    response.setHeader("Access-Control-Allow-Origin", origin || "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type, mcp-protocol-version, authorization, x-requested-with");
    response.setHeader("Access-Control-Expose-Headers", "content-type, mcp-protocol-version");
    if (request.method === "OPTIONS") return send(response, 204, {});
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        return send(response, 200, {
          ok: true,
          service: "integrated-power-broker",
          schemaVersion: BROKER_SCHEMA_VERSION,
          brokerVersion: brokerVersion(),
          brokerSource: "vscode-extension",
          capabilities: BROKER_CAPABILITIES,
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/notifications/quota-refill") {
        const input = await readJson(request, 64 * 1024) as { tokenStatus?: unknown };
        if (!input || typeof input !== "object" || (input.tokenStatus !== undefined && (!input.tokenStatus || typeof input.tokenStatus !== "object" || Array.isArray(input.tokenStatus)))) {
          return send(response, 400, { ok: false, notifications: [], source: "canonical-broker", errors: ["tokenStatus, when supplied, must be an object."] });
        }
        // The request is a notification-delivery claim only. Never trust a UI
        // snapshot as detector state: out-of-order clients could rewind the
        // shared previous sample and make one refill fire twice.
        const previousQueue = quotaNotificationQueue;
        let finishQueue!: () => void;
        quotaNotificationQueue = new Promise<void>((resolve) => { finishQueue = resolve; });
        await previousQueue;
        try {
          const tokenStatus = await readTokenStatus() as unknown as Record<string, unknown>;
          const prior = readQuotaNotificationState(quotaNotificationStatePath);
          const detected = sharedQuota.detectRefilledQuotaWindows(prior?.previous, tokenStatus, prior?.notifiedIds ?? []);
          const settings = quotaSettingsStore.get();
          const notifications = settings.initialized && settings.settings.notifyOnFull
            ? detected.notifications.filter((item) => settings.settings.notifications[item.target.configKey.replace(/^notifications\./, "")] !== false)
              .map((item) => ({
                id: item.target.id,
                configKey: item.target.configKey,
                window: item.target.window,
                model: item.target.model,
                title: item.target.title,
                message: item.target.message,
                previousPercent: item.previousPercent,
                currentPercent: item.currentPercent,
              }))
            : [];
          writeQuotaNotificationState(quotaNotificationStatePath, { previous: tokenStatus, notifiedIds: [...detected.updatedNotifiedSet] });
          return send(response, 200, { ok: true, notifications, source: "canonical-broker", errors: [] });
        } finally {
          finishQueue();
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/notifications/prewarm") {
        const consumer = url.searchParams.get("consumer")?.trim();
        const afterIdRaw = url.searchParams.get("afterId");
        const afterId = afterIdRaw !== null && afterIdRaw !== undefined && /^\d+$/.test(afterIdRaw.trim())
          ? parseInt(afterIdRaw.trim(), 10)
          : undefined;
        const latestSeqId = nextPrewarmSeqId - 1;

        if (consumer || afterId !== undefined) {
          const sinceSeq = afterId !== undefined ? afterId : (consumer ? (prewarmConsumerCursors.get(consumer) ?? 0) : 0);
          const notifications = prewarmNotificationQueue.filter((item) => (item.seqId ?? 0) > sinceSeq);
          if (consumer && afterId === undefined) {
            prewarmConsumerCursors.set(consumer, latestSeqId);
          } else if (consumer && notifications.length > 0) {
            const maxSeq = Math.max(...notifications.map((n) => n.seqId ?? 0));
            const current = prewarmConsumerCursors.get(consumer) ?? 0;
            if (maxSeq > current) prewarmConsumerCursors.set(consumer, maxSeq);
          }
          return send(response, 200, { ok: true, notifications, latestSeqId });
        }

        const notifications = prewarmNotificationQueue.splice(0, prewarmNotificationQueue.length);
        return send(response, 200, { ok: true, notifications, latestSeqId });
      }
      if (request.method === "GET" && url.pathname === "/v1/workspaces") {
        const workspacesRoot = path.join(stateRoot, "workspaces");
        const entries = await fs.promises.readdir(workspacesRoot, { withFileTypes: true }).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        });
        const workspaceIds = new Set(entries.filter((entry) => entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(entry.name)).map((entry) => entry.name));
        for (const task of broker.listTasks()) {
          const taskWorkspacePath = task.baseWorkspacePath ?? task.workspacePath;
          if (!taskWorkspacePath) continue;
          try {
            const descriptor = resolveEggRWorkspaceDescriptor(taskWorkspacePath);
            workspaceIds.add(eggRWorkspaceId(descriptor.repoRoot, descriptor.remoteUrl, descriptor.configuredId));
          } catch {
            // Invalid historic paths are not exposed or treated as selectable workspaces.
          }
        }
        const workspaces = [...workspaceIds].sort((a, b) => a.localeCompare(b)).map((workspaceId) => ({ workspaceId }));
        return send(response, 200, { ok: true, workspaces, source: "canonical-state" });
      }
      if (request.method === "GET" && url.pathname === "/v1/runs") {
        const scope = await resolveWorkspaceScope(url, stateRoot);
        if ("error" in scope) return send(response, scope.status, { ok: false, errors: [scope.error], runs: [], activeCount: 0, workspaceId: scope.workspaceId });
        const filePath = path.join(scope.storagePath, ".agent-runs", "runs.jsonl");
        let text: string;
        try { text = await fs.promises.readFile(filePath, "utf8"); }
        catch (error) {
          const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
          return send(response, missing ? 404 : 500, { ok: false, errors: [missing ? `Runs file not found: ${filePath}` : errorMessage(error)], runs: [], activeCount: 0, workspaceId: scope.workspaceId, source: "canonical-state" });
        }
        const parsed = sharedTelemetry.parseRunJsonl(text, {
          normalizeArtifactPath: (value) => normalizeArtifactPath(value, scope.workspacePath, scope.storagePath),
        });
        return send(response, 200, {
          ok: true,
          runs: parsed.runs,
          activeCount: parsed.activeRuns.length,
          activeRuns: parsed.activeRuns,
          artifacts: parsed.runs.flatMap((run) => run.artifacts),
          parseErrors: parsed.parseErrors,
          errors: parsed.parseErrors,
          source: "canonical-state",
          workspaceId: scope.workspaceId,
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/metrics/local-llm") {
        const scope = await resolveWorkspaceScope(url, stateRoot);
        if ("error" in scope) return send(response, scope.status, { ok: false, errors: [scope.error], metrics: [], workspaceId: scope.workspaceId });
        const filePath = path.join(scope.storagePath, "reports", "local_llm_metrics.csv");
        let text: string;
        try { text = await fs.promises.readFile(filePath, "utf8"); }
        catch (error) {
          const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
          return send(response, missing ? 404 : 500, { ok: false, errors: [missing ? `Local LLM metrics file not found: ${filePath}` : errorMessage(error)], metrics: [], workspaceId: scope.workspaceId, source: "canonical-state" });
        }
        const parsed = sharedTelemetry.parseLocalLlmMetricsCsv(text);
        return send(response, 200, { ok: true, metrics: parsed.metrics, parseErrors: parsed.parseErrors, errors: parsed.parseErrors, source: "canonical-state", workspaceId: scope.workspaceId });
      }
      if (request.method === "GET" && url.pathname === "/v1/logs") {
        const requestedLines = Number.parseInt(url.searchParams.get("lines") ?? "160", 10);
        const lines = Number.isFinite(requestedLines) ? Math.min(500, Math.max(20, requestedLines)) : 160;
        const logPath = path.join(stateRoot, "broker.log");
        const content = await fs.promises.readFile(logPath, "utf8").catch(() => "");
        return send(response, 200, { path: logPath, lines: content.split(/\r?\n/).filter(Boolean).slice(-lines) });
      }
      if (request.method === "GET" && (url.pathname === "/mcp" || url.pathname === "/sse")) {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": origin || "*",
        });
        const host = request.headers.host || "127.0.0.1:37241";
        const endpointUrl = `http://${host}/mcp`;
        response.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);
        const keepAliveTimer = setInterval(() => {
          try { response.write(": keepalive\n\n"); } catch { clearInterval(keepAliveTimer); }
        }, 15000);
        request.on("close", () => { clearInterval(keepAliveTimer); });
        return;
      }
      if (request.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/sse")) {
        const payload = await readJson(request) as any;
        const protoVersion = String(request.headers["mcp-protocol-version"] || payload?.params?.protocolVersion || "2024-11-05");
        response.setHeader("MCP-Protocol-Version", protoVersion);
        const message = await processMcpRequest(broker, payload, readTokenStatus);
        if (!message) { response.statusCode = 202; return response.end(); }
        return send(response, 200, message);
      }
      if (request.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
        const host = request.headers.host || "127.0.0.1:37241";
        return send(response, 200, {
          name: "Integrated Power Broker",
          description: "Local multi-agent task ledger and approval coordinator.",
          version: "0.8.0",
          supportedInterfaces: [{ url: `http://${host}`, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" }],
          provider: { organization: "EggR", url: "https://github.com/EggR0/integrated-power" },
          capabilities: { streaming: false, pushNotifications: false },
          defaultInputModes: ["text/plain"],
          defaultOutputModes: ["text/plain"],
          skills: [{ id: "integrated-power-task", name: "Integrated Power task control", description: "Create and coordinate a local task.", tags: ["multi-agent", "control"] }],
          securitySchemes: {},
          securityRequirements: [],
          signatures: [],
        });
      }
      if (request.method === "POST" && url.pathname === "/message:send") {
        const input = await readJson(request) as any;
        const message = input?.message;
        const text = extractA2AText(message);
        const contextId = typeof message?.contextId === "string" && message.contextId ? message.contextId : undefined;
        const task = await broker.createTask({
          title: contextId ? `A2A ${contextId}` : "A2A task",
          goal: text || "A2A task without a text message",
          originProvider: "local.openai-compatible",
          linkedConversationId: contextId,
          privacy: "private",
        });
        return send(response, 200, { task: toA2ATask(task, text) });
      }
      if (request.method === "GET" && url.pathname === "/v1/capabilities") {
        return send(response, 200, { capabilities: await broker.discover() });
      }
      if (request.method === "GET" && url.pathname === "/v1/integrations") {
        return send(response, 200, { integrations: listHostIntegrations() });
      }
      if (request.method === "GET" && url.pathname === "/v1/installation") {
        return send(response, 200, { installations: discoverInstallations() });
      }
      if (request.method === "GET" && url.pathname === "/v1/integrations/claude/spec") {
        return send(response, 200, { spec: claudeLocalMcpSpec(), snippet: getMcpConfigSnippet() });
      }
      if (request.method === "GET" && url.pathname === "/v1/integrations/chatgpt/spec") {
        return send(response, 200, { spec: chatgptLocalMcpSpec(), snippet: getMcpConfigSnippet() });
      }
      if (request.method === "GET" && url.pathname === "/v1/integrations/mcp/spec") {
        return send(response, 200, { spec: claudeLocalMcpSpec(), snippet: getMcpConfigSnippet() });
      }
      if (request.method === "POST" && url.pathname === "/v1/integrations/claude/register") {
        const input = await readJson(request) as { confirm?: boolean };
        return send(response, 200, registerClaudeLocalMcp(input.confirm === true));
      }
      if (request.method === "POST" && url.pathname === "/v1/integrations/config") {
        const input = await readJson(request) as { confirm?: boolean; chatgptMcpUrl?: string; claudeMcpUrl?: string };
        return send(response, 200, { config: saveHostIntegrationConfig({ chatgptMcpUrl: input.chatgptMcpUrl, claudeMcpUrl: input.claudeMcpUrl }, input.confirm === true) });
      }
      if (request.method === "GET" && url.pathname === "/v1/system/autostart") {
        return send(response, 200, await getAutoStartStatus());
      }
      if (request.method === "POST" && url.pathname === "/v1/system/autostart") {
        const input = await readJson(request) as { enabled?: boolean; targetPath?: string };
        const result = await setAutoStart(input.enabled === true, input.targetPath);
        return send(response, 200, result);
      }
      // External provider fetch: the UI registers arbitrary http(s) endpoints
      // (self-hosted gateways, OpenAI usage API, local JSON files over HTTP).
      // The broker fetches server-side because a browser on 127.0.0.1:5173
      // would be blocked by cross-origin policy against arbitrary hosts.
      // Loopback is still enforced: only http(s), max 256KB, 8s timeout.
      if (request.method === "GET" && url.pathname === "/v1/providers/external") {
        const requested = url.searchParams.get("url");
        // Optional bearer token (local servers usually leave it blank).
        const key = url.searchParams.get("key");
        if (!requested) {
          return send(response, 400, { error: "missing url query parameter" });
        }
        let target: URL;
        try {
          target = new URL(requested);
        } catch {
          return send(response, 400, { error: "invalid url" });
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          return send(response, 400, { error: "only http/https urls are allowed" });
        }
        try {
          const headers: Record<string, string> = { accept: "application/json, text/plain, */*" };
          if (key) headers["authorization"] = `Bearer ${key}`;
          const upstream = await fetch(target, {
            signal: AbortSignal.timeout(8000),
            headers,
            redirect: "follow",
          });
          const text = await upstream.text();
          if (text.length > 256 * 1024) {
            return send(response, 502, { error: "upstream response exceeds 256KB", upstreamStatus: upstream.status });
          }
          let payload: unknown = text;
          try {
            payload = JSON.parse(text);
          } catch {
            payload = { raw: text.slice(0, 8192) };
          }
          if (upstream.status >= 400) {
            return send(response, 502, { error: `upstream responded ${upstream.status}`, upstreamStatus: upstream.status, payload });
          }
          return send(response, 200, { upstreamStatus: upstream.status, payload });
        } catch (error) {
          return send(response, 502, { error: `fetch failed: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
      if (request.method === "GET" && url.pathname === "/v1/tokens/status") {
        const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
        if (options.tokenStatusReader) {
          return send(response, 200, { ok: true, forced: false, tokenStatus: await readTokenStatus() });
        }
        const refreshed = force ? await requestForceRefresh() : false;
        const tokenStatus = await scanLiveTokenStatus({ force: force && !refreshed });
        return send(response, 200, { ok: true, forced: refreshed, tokenStatus });
      }
      if (url.pathname === "/v1/settings/quota" && request.method === "GET") {
        return send(response, 200, quotaSettingsStore.get());
      }
      if (url.pathname === "/v1/settings/quota" && request.method === "POST") {
        const outcome = quotaSettingsStore.put(await readJson(request) as QuotaSettingsWrite);
        return send(response, outcome.status, outcome.result);
      }
      if (request.method === "POST" && (url.pathname === "/prewarm" || url.pathname === "/v1/tokens/prewarm")) {
        const input = await readJson(request) as PrewarmRequest;
        const outcome = await executePrewarmRequest(input, quotaSettingsStore, prewarmStatePath, readTokenStatus, dispatchPrewarm, undefined, stateRoot, emitPrewarmNotification, serverClosedRef, options);
        return send(response, outcome.httpStatus, outcome.result);
      }
      if (request.method === "GET" && url.pathname === "/v1/tasks") {
        const hasScope = url.searchParams.has("workspaceId") || url.searchParams.has("workspacePath");
        if (!hasScope) return send(response, 200, { tasks: broker.listTasks() });
        const scope = await resolveWorkspaceScope(url, stateRoot);
        if ("error" in scope) return send(response, scope.status, { ok: false, errors: [scope.error], tasks: [], activeCount: 0, workspaceId: scope.workspaceId });
        const tasks = broker.listTasks().filter((task) => taskInWorkspace(task.baseWorkspacePath ?? task.workspacePath, scope.workspaceId));
        return send(response, 200, { ok: true, tasks, activeCount: tasks.filter((task) => ["active", "running", "in_progress", "queued"].includes(task.status)).length, errors: [], source: "broker-ledger", workspaceId: scope.workspaceId, workspacePath: scope.workspacePath });
      }
      if (request.method === "GET" && url.pathname === "/v1/approvals") {
        const hasScope = url.searchParams.has("workspaceId") || url.searchParams.has("workspacePath");
        if (!hasScope) return send(response, 200, { approvals: broker.getApprovals() });
        const scope = await resolveWorkspaceScope(url, stateRoot);
        if ("error" in scope) return send(response, scope.status, { ok: false, errors: [scope.error], approvals: [], workspaceId: scope.workspaceId });
        const approvals = broker.getApprovals().filter((approval) => {
          const task = broker.getTask(approval.taskId);
          return taskInWorkspace(task?.baseWorkspacePath ?? task?.workspacePath, scope.workspaceId);
        });
        return send(response, 200, { ok: true, approvals, errors: [], source: "broker-ledger", workspaceId: scope.workspaceId, workspacePath: scope.workspacePath });
      }
      if (request.method === "GET" && url.pathname.startsWith("/v1/tasks/") && url.pathname.endsWith("/stream")) {
        const taskId = decodeURIComponent(url.pathname.slice("/v1/tasks/".length, -"/stream".length));
        if (!broker.getTask(taskId)) return send(response, 404, { error: "task_not_found" });
        return streamTaskEvents(request, response, broker, taskId);
      }
      if (request.method === "GET" && url.pathname.match(/^\/v1\/tasks\/[^/]+\/(proposals|evaluations|evidence|syntheses)$/)) {
        const match = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/(proposals|evaluations|evidence|syntheses)$/)!;
        const taskId = decodeURIComponent(match[1]);
        if (!broker.getTask(taskId)) return send(response, 404, { error: "task_not_found" });
        const collection = match[2];
        if (collection === "proposals") return send(response, 200, { proposals: await broker.listProposals(taskId) });
        if (collection === "evaluations") return send(response, 200, { evaluations: await broker.listEvaluations(taskId) });
        if (collection === "evidence") return send(response, 200, { evidence: await broker.listEvidence(taskId) });
        return send(response, 200, { syntheses: await broker.listSyntheses(taskId) });
      }
      if (request.method === "GET" && url.pathname.startsWith("/v1/tasks/")) {
        const taskId = decodeURIComponent(url.pathname.slice("/v1/tasks/".length));
        const task = broker.getTask(taskId);
        if (!task) return send(response, 404, { error: "task_not_found" });
        if (url.searchParams.has("workspaceId") || url.searchParams.has("workspacePath")) {
          const scope = await resolveWorkspaceScope(url, stateRoot);
          if ("error" in scope) return send(response, scope.status, { ok: false, errors: [scope.error], workspaceId: scope.workspaceId });
          if (!taskInWorkspace(task.baseWorkspacePath ?? task.workspacePath, scope.workspaceId)) {
            return send(response, 404, { ok: false, error: "task_not_found", errors: ["Task not found in the selected workspace."], workspaceId: scope.workspaceId });
          }
          return send(response, 200, { ok: true, task, events: await broker.events(taskId), errors: [], source: "broker-ledger", workspaceId: scope.workspaceId });
        }
        return send(response, 200, { task, events: await broker.events(taskId) });
      }
      if (request.method === "POST" && url.pathname === "/v1/tasks") {
        const task = await broker.createTask(await readJson(request) as CreateTaskInput);
        return send(response, 201, { task });
      }
      if (request.method === "POST" && url.pathname === "/a2a/tasks") {
        const input = await readJson(request) as {
          id?: string;
          message?: { parts?: Array<{ kind?: string; text?: string }> };
          contextId?: string;
          originProvider?: CreateTaskInput["originProvider"];
          workspacePath?: string;
        };
        const text = input.message?.parts?.map((part) => part.text ?? "").join("\n").trim() ?? "";
        const task = await broker.createTask({
          title: input.contextId ? `A2A ${input.contextId}` : "A2A task",
          goal: text || "A2A task without a text message",
          originProvider: input.originProvider ?? "local.openai-compatible",
          workspacePath: input.workspacePath,
        });
        return send(response, 201, { id: input.id ?? task.id, contextId: task.id, status: { state: "submitted" }, artifacts: [] });
      }
      if (request.method === "POST" && url.pathname === "/v1/tasks/delegate") {
        const event = await broker.delegate(await readJson(request) as DelegateTaskInput);
        return send(response, 202, { event });
      }
      if (request.method === "POST" && url.pathname === "/v1/approvals") {
        const input = await readJson(request) as {
          taskId: string;
          action: "merge" | "external-send" | "publish" | "budget-overage" | "connect";
          description: string;
          requestedBy: "user" | "broker";
          expectedRevision?: number;
          idempotencyKey?: string;
        };
        const approval = await broker.requestApproval(
          input.taskId,
          input.action,
          input.description,
          input.requestedBy === "user" ? "user" : "broker",
          input.expectedRevision,
          input.idempotencyKey,
        );
        return send(response, 201, { approval });
      }
      if (request.method === "POST" && url.pathname.startsWith("/v1/approvals/") && url.pathname.endsWith("/approve")) {
        const approvalId = decodeURIComponent(url.pathname.slice("/v1/approvals/".length, -"/approve".length));
        const input = await readJson(request) as { expectedRevision?: number; idempotencyKey?: string };
        await broker.approve(approvalId, input.expectedRevision, input.idempotencyKey);
        return send(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname.startsWith("/v1/approvals/") && url.pathname.endsWith("/reject")) {
        const approvalId = decodeURIComponent(url.pathname.slice("/v1/approvals/".length, -"/reject".length));
        const input = await readJson(request) as { expectedRevision?: number; idempotencyKey?: string };
        await broker.reject(approvalId, input.expectedRevision, input.idempotencyKey);
        return send(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname.startsWith("/v1/tasks/") && url.pathname.endsWith("/cancel")) {
        const taskId = decodeURIComponent(url.pathname.slice("/v1/tasks/".length, -"/cancel".length));
        const input = await readJson(request) as { expectedRevision: number; idempotencyKey?: string };
        await broker.cancel(taskId, input.expectedRevision, input.idempotencyKey);
        return send(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname.startsWith("/v1/tasks/") && url.pathname.endsWith("/merge")) {
        const taskId = decodeURIComponent(url.pathname.slice("/v1/tasks/".length, -"/merge".length));
        const input = await readJson(request) as { expectedRevision: number; idempotencyKey?: string };
        const commit = await broker.mergeTask(taskId, input.expectedRevision, input.idempotencyKey);
        return send(response, 200, { ok: true, commit });
      }
      if (request.method === "POST" && url.pathname.startsWith("/v1/tasks/") && url.pathname.endsWith("/classify")) {
        const taskId = decodeURIComponent(url.pathname.slice("/v1/tasks/".length, -"/classify".length));
        const input = await readJson(request) as { expectedRevision: number; provider?: import("./protocol").ProviderId; mode?: "offline" | "agent"; idempotencyKey?: string };
        const result = await broker.classifyTask(taskId, input.expectedRevision, input.provider, input.mode, input.idempotencyKey);
        return send(response, 200, result);
      }
      if (request.method === "GET" && url.pathname === "/v1/tags") {
        return send(response, 200, { tags: broker.getAllTags() });
      }
      if (request.method === "GET" && url.pathname === "/v1/hub/overview") {
        const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("force") === "1";
        return send(response, 200, await hubController.getOverview(force));
      }
      if (request.method === "GET" && url.pathname === "/v1/hub/ecosystem") {
        const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("force") === "1";
        const overview = await hubController.getOverview(force);
        return send(response, 200, overview.ecosystem);
      }
      if (request.method === "GET" && url.pathname === "/v1/hub/config") {
        return send(response, 200, (await hubController.getOverview()).config);
      }
      if ((request.method === "PUT" || request.method === "POST") && url.pathname === "/v1/hub/config") {
        const partial = await readJson(request) as any;
        return send(response, 200, hubController.updateConfig(partial));
      }
      if (request.method === "POST" && url.pathname === "/v1/hub/ingest") {
        const body = await readJson(request) as any;
        const item = await hubController.ingestTodo(body);
        return send(response, 201, { ok: true, todo: item });
      }
      if (request.method === "POST" && url.pathname === "/v1/hub/todos/sync") {
        return send(response, 200, await hubController.syncTodos());
      }
      if (request.method === "GET" && url.pathname === "/v1/hub/todos") {
        return send(response, 200, { todos: hubController.getTodos() });
      }
      if (request.method === "POST" && /^\/v1\/hub\/todos\/([^/]+)\/clarify$/.test(url.pathname)) {
        const match = url.pathname.match(/^\/v1\/hub\/todos\/([^/]+)\/clarify$/)!;
        const id = decodeURIComponent(match[1]);
        const body = await readJson(request) as any;
        return send(response, 200, { ok: true, todo: await hubController.clarifyTodo(id, body) });
      }
      if (request.method === "POST" && /^\/v1\/hub\/todos\/([^/]+)\/dispatch$/.test(url.pathname)) {
        const match = url.pathname.match(/^\/v1\/hub\/todos\/([^/]+)\/dispatch$/)!;
        const id = decodeURIComponent(match[1]);
        const body = await readJson(request) as any;
        const tokenSnapshot = body?.tokenSnapshot ?? await readTokenStatus().catch(() => undefined);
        const res = await hubController.dispatchTodo(id, { ...body, tokenSnapshot });
        return send(response, 200, { ok: true, ...res });
      }
      if (request.method === "GET" && url.pathname === "/v1/hub/playbooks") {
        return send(response, 200, { playbooks: (await hubController.getOverview()).playbooks });
      }
      if (request.method === "POST" && url.pathname === "/v1/hub/playbooks") {
        const body = await readJson(request) as any;
        return send(response, 200, { ok: true, playbook: hubController.savePlaybook(body) });
      }
      const activeStaticDir = staticDir || resolveStaticDirectory(options.staticDir);
      if (activeStaticDir && tryServeStaticFile(activeStaticDir, url.pathname, response, request.method ?? "GET")) {
        return;
      }
      return send(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof BrokerConflictError) {
        const taskId = request.url ? new URL(request.url, "http://127.0.0.1").pathname.match(/tasks\/([^/]+)/)?.[1] : undefined;
        return send(response, 409, { error: error.message, currentRevision: error.currentRevision, task: taskId ? broker.getTask(decodeURIComponent(taskId)) : undefined });
      }
      const tooLarge = error instanceof RequestBodyTooLargeError;
      return send(response, tooLarge ? 413 : 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  let schedulerActive = false;
  let lastSchedulerPoll = 0;
  const schedulerTimer = options.autoSchedule === false ? undefined : setInterval(() => {
    if (schedulerActive || serverClosed) return;
    const settingsSnapshot = quotaSettingsStore.get();
    if (!settingsSnapshot.initialized || !Object.values(settingsSnapshot.settings.prewarmModes).some((mode) => mode !== "click")) return;
    if (Date.now() - lastSchedulerPoll < settingsSnapshot.settings.pollIntervalMs) return;
    lastSchedulerPoll = Date.now();
    schedulerActive = true;
    void (async () => {
      try {
        let forceRefreshForVerify = false;
        if (!options.tokenStatusReader) {
          try {
            const arb = readPrewarmState(prewarmStatePath);
            for (const [key, prev] of Object.entries(arb.windows)) {
              if (/:(antigravity|argon|opus|codex):(5h|weekly):/.test(key) && prev.status === "dispatched") {
                const age = Date.now() - prev.attemptedAt;
                if (age >= 60_000 && age < 180_000) {
                  forceRefreshForVerify = true;
                  break;
                }
              }
            }
          } catch {}
        }
        const status = forceRefreshForVerify ? await scanLiveTokenStatus({ force: true }) : await readTokenStatus();
        const accountsObj = (status as any)?.accounts;
        const hasAccounts = accountsObj && typeof accountsObj === "object" && !Array.isArray(accountsObj) && Object.keys(accountsObj).length > 0;
        const accountsToIterate: Array<string | undefined> = hasAccounts ? Object.keys(accountsObj) : [undefined];

        for (const target of ["antigravity", "argon", "opus", "codex"] as const) {
          const mode = settingsSnapshot.settings.prewarmModes[target] ?? "click";
          if (mode === "click") continue;
          for (const account of accountsToIterate) {
            const accountData = account && hasAccounts ? accountsObj[account] : undefined;
            const argonPct = accountData ? accountData.argonPercentage : (status as any).argonPercentage;
            const argonWeeklyPct = accountData ? accountData.argonWeeklyPercentage : (status as any).argonWeeklyPercentage;
            const autoWindow = target === "argon" && argonPct === undefined && argonWeeklyPct !== undefined ? "weekly" : "5h";
            const outcome = await executePrewarmRequest(
              { model: target, window: autoWindow, manual: false, account, idempotencyKey: crypto.randomUUID(), expectedSettingsRevision: settingsSnapshot.revision },
              quotaSettingsStore,
              prewarmStatePath,
              readTokenStatus,
              dispatchPrewarm,
              status,
              stateRoot,
              emitPrewarmNotification,
              serverClosedRef,
              options,
            );
            if (mode === "once" && outcome.result.status === "dispatched") {
              break;
            }
          }
        }
      } catch {
        // A failed collection is retryable on the next broker-owned poll.
      } finally {
        schedulerActive = false;
      }
    })();
  }, 1000);
  schedulerTimer?.unref();
  return {
    port,
    close: () => {
      serverClosed = true;
      serverClosedRef.closed = true;
      if (schedulerTimer) clearInterval(schedulerTimer);
      const result = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      (server as http.Server & { closeIdleConnections?: () => void; closeAllConnections?: () => void }).closeIdleConnections?.();
      (server as http.Server & { closeIdleConnections?: () => void; closeAllConnections?: () => void }).closeAllConnections?.();
      return result;
    },
  };
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 ? time : undefined;
  }
  return undefined;
}

function extractQuotaSnapshot(
  status: LiveTokenStatus,
  target: string,
  windowType: "5h" | "weekly",
  account?: string,
): { pct?: number; resetMs?: number; resetStr?: string; measuredMs?: number } {
  const weeklyTarget = `${target}Weekly`;
  const accountsMap = (status as any)?.accounts;
  const acctData = account && accountsMap && typeof accountsMap === "object" && !Array.isArray(accountsMap)
    ? accountsMap[account]
    : undefined;
  const pools = Array.isArray(acctData?.quotaPools)
    ? acctData.quotaPools
    : (Array.isArray((status as any).quotaPools) ? (status as any).quotaPools : []);
  const pool = windowType === "weekly"
    ? pools.find((p: any) => p?.id === `${target}.weekly` || (p?.provider === (target === "opus" ? "anthropic" : target) && p?.windowDurationMins === 10080))
    : pools.find((p: any) => p?.id === `${target}.5h` || p?.id === `${target}.default` || (p?.provider === (target === "opus" ? "anthropic" : target) && p?.windowDurationMins === 300));

  const pct = windowType === "weekly"
    ? (acctData ? quotaPercentageOrUndefined(acctData[`${weeklyTarget}Percentage`]) : undefined) ?? (pool ? quotaPercentageOrUndefined(pool.remainingPercentage) : undefined) ?? quotaPercentageOrUndefined((status as any)[`${weeklyTarget}Percentage`])
    : (acctData ? quotaPercentageOrUndefined(acctData[`${target}Percentage`]) : undefined) ?? (pool ? quotaPercentageOrUndefined(pool.remainingPercentage) : undefined) ?? quotaPercentageOrUndefined((status as any)[`${target}Percentage`]);

  const resetStr = windowType === "weekly"
    ? (acctData ? (acctData[`${weeklyTarget}ResetTime`] || pool?.resetTime) : ((status as any)[`${weeklyTarget}ResetTime`] || pool?.resetTime))
    : (acctData ? (acctData[`${target}ResetTime`] || pool?.resetTime) : ((status as any)[`${target}ResetTime`] || pool?.resetTime));
  const resetDate = resetStr ? new Date(resetStr) : undefined;
  const resetMs = resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate.getTime() : undefined;

  const acctFallbackTs = acctData
    ? (parseTimestampMs(acctData.fetchedAt) ?? parseTimestampMs(acctData.measuredAt) ?? parseTimestampMs(acctData.lastSync))
    : undefined;
  const fallbackTs = acctFallbackTs
    ?? parseTimestampMs((status as any).lastSync)
    ?? parseTimestampMs((status as any).updatedAt)
    ?? parseTimestampMs((status as any).directUsage?.lastMeasuredAt);
  const measuredMs = parseTimestampMs(pool?.measuredAt) ?? fallbackTs;

  return { pct, resetMs, resetStr: resetStr ? String(resetStr) : undefined, measuredMs };
}

async function executePrewarmRequest(
  input: PrewarmRequest,
  settingsStore: QuotaSettingsStore,
  statePath: string,
  readTokenStatus: () => Promise<LiveTokenStatus>,
  dispatcher: BrokerServerOptions["prewarmDispatcher"],
  statusOverride?: LiveTokenStatus,
  stateRoot?: string,
  emitNotification?: (event: PrewarmNotificationEvent) => void,
  serverClosedRef?: { closed: boolean },
  options?: BrokerServerOptions,
): Promise<{ httpStatus: number; result: PrewarmResult }> {
  const resolved = resolvePrewarmTarget(input.model);
  const manual = input.manual !== false;
  if (manual) appendBrokerLog(stateRoot, `[PREWARM] Request received: model=${input.model ?? "default"}, window=${input.window ?? "auto"}, manual=${manual}`);
  const idempotencyKey = input.idempotencyKey?.trim() || `legacy-${crypto.randomUUID()}`;
  if (idempotencyKey.length > 128) {
    if (manual) {
      emitNotification?.({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        level: "error",
        target: resolved.target,
        targetModel: resolved.model,
        account: input.account,
        status: "failed",
        message: "idempotencyKey must not exceed 128 characters.",
      });
    }
    return { httpStatus: 400, result: { ok: false, status: "failed", timerConfirmed: false, error: "idempotencyKey must not exceed 128 characters." } };
  }

  const liveStatus = statusOverride ?? await readTokenStatus();
  const accountsMap = (liveStatus as any)?.accounts;
  const effectiveRequestedAccount = input.account?.trim() || (
    resolved.target !== "codex"
      ? (
          (liveStatus as any)?.activeAgy2AccountEmail
          || (liveStatus as any)?.activeIdeAccountEmail
          || (liveStatus as any)?.activeAccountEmail
        )
      : undefined
  );
  const matchedAccountKey = (effectiveRequestedAccount && accountsMap && typeof accountsMap === "object" && !Array.isArray(accountsMap))
    ? Object.keys(accountsMap).find((key) => key.toLowerCase() === effectiveRequestedAccount.toLowerCase())
    : undefined;
  const resolvedAccount = matchedAccountKey || effectiveRequestedAccount;

  if (input.account && accountsMap && typeof accountsMap === "object" && !Array.isArray(accountsMap)) {
    if (!matchedAccountKey) {
      if (manual) {
        emitNotification?.({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          level: "warn",
          target: resolved.target,
          targetModel: resolved.model,
          account: input.account,
          status: "skipped",
          message: `Account '${input.account}' quota telemetry was not found.`,
        });
      }
      return {
        httpStatus: 200,
        result: {
          ok: false,
          status: "skipped",
          timerConfirmed: false,
          model: resolved.target,
          targetModel: resolved.model,
          account: input.account,
          error: `Account '${input.account}' quota telemetry was not found.`,
        },
      };
    }
  }

  const accountData = (matchedAccountKey && accountsMap && typeof accountsMap === "object" && !Array.isArray(accountsMap))
    ? accountsMap[matchedAccountKey]
    : undefined;

  const argonPct = accountData ? accountData.argonPercentage : (liveStatus as any).argonPercentage;
  const argonWeeklyPct = accountData ? accountData.argonWeeklyPercentage : (liveStatus as any).argonWeeklyPercentage;

  const windowType: "5h" | "weekly" = input.window === "weekly"
    ? "weekly"
    : (!input.window && resolved.target === "argon" && argonPct === undefined && argonWeeklyPct !== undefined)
      ? "weekly"
      : "5h";

  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    target: resolved.target,
    model: resolved.model,
    window: windowType,
    manual,
    account: resolvedAccount ?? null,
    expectedSettingsRevision: input.expectedSettingsRevision ?? null,
  })).digest("hex");

  const state = readPrewarmState(statePath);
  const priorIdempotency = state.idempotency[idempotencyKey];
  if (priorIdempotency) {
    if (priorIdempotency.fingerprint !== fingerprint) return { httpStatus: 409, result: { ok: false, status: "duplicate", timerConfirmed: false, error: "Idempotency key was already used for a different prewarm request." } };
    return { httpStatus: 200, result: priorIdempotency.result };
  }

  const prefix = resolved.target;
  const weeklyPrefix = `${prefix}Weekly`;
  const windowId = windowType === "weekly"
    ? `policy-weekly-${Math.floor(Date.now() / (168 * 60 * 60 * 1000))}`
    : `policy-5h-${Math.floor(Date.now() / (5 * 60 * 60 * 1000))}`;
  const accountScope = (resolvedAccount || "default").toLowerCase();
  const windowKey = `${accountScope}:${prefix}:${windowType}:${windowId}`;
  const previous = state.windows[windowKey];
  const duplicateCooldownMs = manual ? 5_000 : 60_000;
  if (previous && (previous.status === "dispatching" || (previous.status === "dispatched" && Date.now() - previous.attemptedAt < duplicateCooldownMs) || Date.now() - previous.attemptedAt < (manual ? 5_000 : 30_000))) {
    if (manual) appendBrokerLog(stateRoot, `[PREWARM] Duplicate request for windowKey=${windowKey}; prior claimId=${previous.claimId}, status=${previous.status}`);
    return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "duplicate", timerConfirmed: false, claimId: previous.claimId, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: "This quota window already has an active or completed prewarm claim." } });
  }

  const settings = settingsStore.get();
  if (typeof input.expectedSettingsRevision === "number" && input.expectedSettingsRevision !== settings.revision) {
    appendBrokerLog(stateRoot, `[PREWARM] Revision conflict for target=${resolved.target}; expected ${input.expectedSettingsRevision}, got ${settings.revision}`);
    if (manual) {
      emitNotification?.({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        level: "warn",
        target: resolved.target,
        targetModel: resolved.model,
        account: resolvedAccount,
        status: "skipped",
        message: `Quota settings revision conflict; current revision is ${settings.revision}.`,
      });
    }
    return { httpStatus: 409, result: { ok: false, status: "skipped", timerConfirmed: false, model: resolved.target, targetModel: resolved.model, account: resolvedAccount, error: `Quota settings revision conflict; current revision is ${settings.revision}.` } };
  }

  const mode = settings.settings.prewarmModes[resolved.target];
  if (!manual && (!settings.initialized || mode === "click")) {
    return { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: resolved.target, targetModel: resolved.model, account: resolvedAccount, error: "Automatic prewarm is not armed for this target." } };
  }

  const pools = Array.isArray(accountData?.quotaPools)
    ? accountData.quotaPools
    : (Array.isArray((liveStatus as any).quotaPools) ? (liveStatus as any).quotaPools : []);
  const fivePool = pools.find((pool: any) => pool?.id === `${prefix}.5h` || pool?.id === `${prefix}.default` || (pool?.provider === (prefix === "opus" ? "anthropic" : prefix) && pool?.windowDurationMins === 300));
  const weeklyPool = pools.find((pool: any) => pool?.id === `${prefix}.weekly` || (pool?.provider === (prefix === "opus" ? "anthropic" : prefix) && pool?.windowDurationMins === 10080));

  const fiveHour = accountData
    ? quotaPercentageOrUndefined(accountData[`${prefix}Percentage`]) ?? (fivePool ? quotaPercentageOrUndefined(fivePool.remainingPercentage) : undefined)
    : quotaPercentageOrUndefined((liveStatus as any)[`${prefix}Percentage`]) ?? (fivePool ? quotaPercentageOrUndefined(fivePool.remainingPercentage) : undefined);

  const weekly = accountData
    ? quotaPercentageOrUndefined(accountData[`${weeklyPrefix}Percentage`]) ?? (weeklyPool ? quotaPercentageOrUndefined(weeklyPool.remainingPercentage) : undefined)
    : quotaPercentageOrUndefined((liveStatus as any)[`${weeklyPrefix}Percentage`]) ?? (weeklyPool ? quotaPercentageOrUndefined(weeklyPool.remainingPercentage) : undefined);

  const accountFallbackTimestamp = accountData
    ? (parseTimestampMs(accountData.fetchedAt) ?? parseTimestampMs(accountData.measuredAt) ?? parseTimestampMs(accountData.lastSync))
    : undefined;
  const fallbackTimestamp = accountFallbackTimestamp
    ?? parseTimestampMs((liveStatus as any).lastSync)
    ?? parseTimestampMs((liveStatus as any).updatedAt)
    ?? parseTimestampMs((liveStatus as any).directUsage?.lastMeasuredAt);

  const fiveMeasuredAt = parseTimestampMs(fivePool?.measuredAt) ?? fallbackTimestamp;
  const weeklyMeasuredAt = parseTimestampMs(weeklyPool?.measuredAt) ?? fallbackTimestamp;
  const targetMeasuredAt = windowType === "weekly" ? weeklyMeasuredAt : fiveMeasuredAt;

  if (!manual && previous && previous.status === "dispatched" && typeof targetMeasuredAt === "number" && Number.isFinite(targetMeasuredAt) && targetMeasuredAt < previous.attemptedAt + 5_000) {
    if (manual) appendBrokerLog(stateRoot, `[PREWARM] Waiting for post-dispatch quota measurement before re-evaluating window.`);
    return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "duplicate", timerConfirmed: false, claimId: previous.claimId, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: "Waiting for post-dispatch quota measurement before re-evaluating window." } });
  }

  if (windowType === "5h") {
    if (fiveHour === undefined) {
      if (manual) appendBrokerLog(stateRoot, `[PREWARM] Skipped: ${prefix} requires reported 5-hour quota data before pre-warm.`);
      if (manual) emitNotification?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: "warn", target: prefix, targetModel: resolved.model, account: resolvedAccount, status: "skipped", message: `${prefix} requires reported 5-hour quota data before pre-warm.` });
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: `${prefix} requires reported 5-hour quota data before pre-warm.` } });
    }
    if (typeof fiveMeasuredAt === "number" && Number.isFinite(fiveMeasuredAt) && (fiveMeasuredAt > Date.now() + 60_000 || Date.now() - fiveMeasuredAt > 5 * 60_000)) {
      if (manual) appendBrokerLog(stateRoot, `[PREWARM] Skipped: ${prefix} requires fresh, reported 5-hour quota data before pre-warm.`);
      if (manual) emitNotification?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: "warn", target: prefix, targetModel: resolved.model, account: resolvedAccount, status: "skipped", message: `${prefix} requires fresh, reported 5-hour quota data before pre-warm.` });
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: `${prefix} requires fresh, reported 5-hour quota data before pre-warm.` } });
    }
    if (fiveHour < 99.995) {
      if (manual) appendBrokerLog(stateRoot, `[PREWARM] Skipped: ${prefix} quota is not 100% full (${fiveHour.toFixed(2)}%).`);
      if (manual) emitNotification?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: "warn", target: prefix, targetModel: resolved.model, account: resolvedAccount, status: "skipped", message: `${prefix} quota is not 100% full (${fiveHour.toFixed(2)}%).` });
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: `${prefix} quota is not 100% full (${fiveHour.toFixed(2)}%).` } });
    }
    const resetTimeStr = accountData ? (accountData[`${prefix}ResetTime`] || fivePool?.resetTime) : ((liveStatus as any)[`${prefix}ResetTime`] || fivePool?.resetTime);
    const resetDate = resetTimeStr ? new Date(resetTimeStr) : undefined;
    const diffMs = resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate.getTime() - Date.now() : undefined;
    if (diffMs !== undefined && diffMs > 0 && diffMs < 5 * 3600 * 1000 - 15 * 60 * 1000) {
      const waitMin = Math.ceil(diffMs / 60000);
      if (manual) appendBrokerLog(stateRoot, `[PREWARM] Skipped: ${prefix} 5-hour quota timer is already active (${waitMin}m remaining).`);
      if (manual) emitNotification?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: "warn", target: prefix, targetModel: resolved.model, account: resolvedAccount, status: "skipped", message: `${prefix} 5-hour quota timer is already active (${waitMin}m remaining). Pre-warm requires a full 5-hour window.` });
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: `${prefix} 5-hour quota timer is already active (${waitMin}m remaining). Pre-warm requires a full 5-hour window.` } });
    }
    if (weekly !== undefined && weekly <= 0.05) {
      if (manual) appendBrokerLog(stateRoot, `[PREWARM] Skipped: ${prefix} weekly quota is exhausted.`);
      if (manual) emitNotification?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: "warn", target: prefix, targetModel: resolved.model, account: resolvedAccount, status: "skipped", message: `${prefix} weekly quota is exhausted.` });
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: `${prefix} weekly quota is exhausted.` } });
    }
  } else {
    if (weekly === undefined) {
      if (manual) appendBrokerLog(stateRoot, `[PREWARM] Skipped: ${prefix} requires reported weekly quota data before pre-warm.`);
      if (manual) emitNotification?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: "warn", target: prefix, targetModel: resolved.model, account: resolvedAccount, status: "skipped", message: `${prefix} requires reported weekly quota data before pre-warm.` });
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: `${prefix} requires reported weekly quota data before pre-warm.` } });
    }
    if (typeof weeklyMeasuredAt === "number" && Number.isFinite(weeklyMeasuredAt) && (weeklyMeasuredAt > Date.now() + 60_000 || Date.now() - weeklyMeasuredAt > 5 * 60_000)) {
      if (manual) appendBrokerLog(stateRoot, `[PREWARM] Skipped: ${prefix} requires fresh, reported weekly quota data before pre-warm.`);
      if (manual) emitNotification?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: "warn", target: prefix, targetModel: resolved.model, account: resolvedAccount, status: "skipped", message: `${prefix} requires fresh, reported weekly quota data before pre-warm.` });
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: `${prefix} requires fresh, reported weekly quota data before pre-warm.` } });
    }
    if (weekly < 99.995) {
      if (manual) appendBrokerLog(stateRoot, `[PREWARM] Skipped: ${prefix} weekly quota is not 100% full (${weekly.toFixed(2)}%).`);
      if (manual) emitNotification?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: "warn", target: prefix, targetModel: resolved.model, account: resolvedAccount, status: "skipped", message: `${prefix} weekly quota is not 100% full (${weekly.toFixed(2)}%).` });
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: `${prefix} weekly quota is not 100% full (${weekly.toFixed(2)}%).` } });
    }
    const weeklyResetTimeStr = accountData ? (accountData[`${weeklyPrefix}ResetTime`] || weeklyPool?.resetTime) : ((liveStatus as any)[`${weeklyPrefix}ResetTime`] || weeklyPool?.resetTime);
    const weeklyResetDate = weeklyResetTimeStr ? new Date(weeklyResetTimeStr) : undefined;
    const weeklyDiffMs = weeklyResetDate && !Number.isNaN(weeklyResetDate.getTime()) ? weeklyResetDate.getTime() - Date.now() : undefined;
    if (weeklyDiffMs !== undefined && weeklyDiffMs > 0 && weeklyDiffMs < 168 * 3600 * 1000 - 4 * 3600 * 1000) {
      const waitHours = Math.ceil(weeklyDiffMs / 3600000);
      if (manual) appendBrokerLog(stateRoot, `[PREWARM] Skipped: ${prefix} weekly quota timer is already active (${waitHours}h remaining).`);
      if (manual) emitNotification?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: "warn", target: prefix, targetModel: resolved.model, account: resolvedAccount, status: "skipped", message: `${prefix} weekly quota timer is already active (${waitHours}h remaining). Pre-warm requires a full 168-hour window.` });
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, account: resolvedAccount, error: `${prefix} weekly quota timer is already active (${waitHours}h remaining). Pre-warm requires a full 168-hour window.` } });
    }
  }

  const baseline = extractQuotaSnapshot(liveStatus, prefix, windowType, resolvedAccount);
  const baselinePct = baseline.pct;
  const baselineResetMs = baseline.resetMs;
  const baselineMeasuredMs = baseline.measuredMs;
  const fullWindowMs = windowType === "weekly" ? 168 * 3600 * 1000 : 5 * 3600 * 1000;
  const activeThresholdMs = windowType === "weekly" ? 168 * 3600 * 1000 - 4 * 3600 * 1000 : 5 * 3600 * 1000 - 15 * 60 * 1000;
  const dispatchedAt = Date.now();

  const claimId = crypto.createHash("sha256").update(windowKey).digest("hex").slice(0, 24);
  state.windows[windowKey] = { windowId, status: "dispatching", attemptedAt: Date.now(), claimId };
  writePrewarmState(statePath, state);
  appendBrokerLog(stateRoot, `[PREWARM] Dispatching prewarm for target=${prefix}, model=${resolved.model}, account=${resolvedAccount ?? "default"}, claimId=${claimId}`);
  let dispatched: { spawned: boolean; cancelledEarly?: boolean; durationMs?: number; error?: string };
  try { dispatched = await (dispatcher ?? spawnPrewarm)(prefix, resolved.model, stateRoot, resolvedAccount); }
  catch (error) { dispatched = { spawned: false, error: error instanceof Error ? error.message : String(error) }; }
  const result: PrewarmResult = dispatched.spawned
    ? { ok: true, status: "dispatched", timerConfirmed: false, claimId, model: prefix, targetModel: resolved.model, account: resolvedAccount, cancelledEarly: dispatched.cancelledEarly, durationMs: dispatched.durationMs }
    : { ok: false, status: "failed", timerConfirmed: false, claimId, model: prefix, targetModel: resolved.model, account: resolvedAccount, cancelledEarly: dispatched.cancelledEarly, durationMs: dispatched.durationMs, error: dispatched.error ?? "Prewarm process did not start." };
  state.windows[windowKey] = { windowId, status: dispatched.spawned ? "dispatched" : "failed", attemptedAt: Date.now(), claimId, error: result.error };
  appendBrokerLog(stateRoot, `[PREWARM] Dispatch outcome: ok=${result.ok}, status=${result.status}${result.error ? `, error=${result.error}` : ""}`);

  if (dispatched.spawned) {
    emitNotification?.({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: "info",
      target: prefix,
      targetModel: resolved.model,
      account: resolvedAccount,
      status: "dispatched",
      message: `Prewarm dispatched for ${prefix}${resolvedAccount ? ` (${resolvedAccount})` : ""}`,
      cancelledEarly: dispatched.cancelledEarly,
      durationMs: dispatched.durationMs,
    });

    const acctSuffix = resolvedAccount ? ` (${resolvedAccount})` : "";
    const verifyDelayMs = Math.max(0, options?.prewarmVerifyDelayMs ?? 5000);
    const retryDelayMs = Math.max(0, options?.prewarmVerifyRetryDelayMs ?? 12000);

    const verifyPostPrewarm = async (attempt: number): Promise<void> => {
      if (serverClosedRef?.closed) return;
      try {
        appendBrokerLog(stateRoot, `[PREWARM] Running post-prewarm quota verification check ${attempt} for target=${prefix}${acctSuffix}`);
        let postStatus: LiveTokenStatus;
        if (options?.tokenStatusReader) {
          postStatus = await readTokenStatus();
        } else {
          const ideRefreshed = await requestForceRefresh().catch(() => false);
          postStatus = await scanLiveTokenStatus({ force: true, maxAgeMs: ideRefreshed ? 5 * 60_000 : 1_000 });
        }

        const post = extractQuotaSnapshot(postStatus, prefix, windowType, resolvedAccount);
        const postPct = post.pct;
        const postResetMs = post.resetMs;
        const postMeasuredMs = post.measuredMs;
        const postResetIso = postResetMs !== undefined ? new Date(postResetMs).toISOString() : post.resetStr;
        const postDiffMs = postResetMs !== undefined ? postResetMs - Date.now() : undefined;
        const baselineDiffMs = baselineResetMs !== undefined ? baselineResetMs - dispatchedAt : undefined;

        const baselineWasActive = baselineDiffMs !== undefined && baselineDiffMs > 0 && baselineDiffMs < activeThresholdMs;
        const postIsActive = postDiffMs !== undefined && postDiffMs > 0 && postDiffMs < activeThresholdMs;

        const timeElapsedBetweenMeasurements = (typeof postMeasuredMs === "number" && typeof baselineMeasuredMs === "number" && Number.isFinite(postMeasuredMs) && Number.isFinite(baselineMeasuredMs))
          ? (postMeasuredMs - baselineMeasuredMs)
          : (Date.now() - dispatchedAt);
        const wallElapsedSinceDispatch = Date.now() - dispatchedAt;
        const postIsPostDispatch = postMeasuredMs === undefined || postMeasuredMs > dispatchedAt;
        const sufficientTelemetryElapsed = wallElapsedSinceDispatch >= 12_000 && timeElapsedBetweenMeasurements >= 12_000 && postIsPostDispatch;

        const cond1 = postPct !== undefined && (postPct < 99.995 || (baselinePct !== undefined && postPct < baselinePct - 0.001));
        const cond2 = (baselineResetMs === undefined || baselineResetMs <= dispatchedAt) && postResetMs !== undefined && postResetMs > Date.now();
        const cond3 = postIsActive && !baselineWasActive;
        const cond4 = sufficientTelemetryElapsed && postResetMs !== undefined && baselineResetMs !== undefined && postResetMs > Date.now() && Math.abs(postResetMs - baselineResetMs) <= 3_000;

        const timerConfirmed = Boolean(cond1 || cond2 || cond3 || cond4);

        if (timerConfirmed) {
          appendBrokerLog(stateRoot, `[PREWARM] Post-prewarm verification CONFIRMED for target=${prefix}${acctSuffix}: postPct=${postPct ?? "n/a"}, postReset=${postResetIso ?? "n/a"}`);
          emitNotification?.({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level: "info",
            target: prefix,
            targetModel: resolved.model,
            account: resolvedAccount,
            status: "verified",
            timerConfirmed: true,
            message: `Post-prewarm timer confirmed for ${prefix}${acctSuffix} (quota: ${postPct !== undefined ? postPct.toFixed(2) : "updated"}%).`,
          });
        } else if (attempt === 1 && (options?.prewarmVerifyRetryDelayMs ?? 12000) > 0) {
          appendBrokerLog(stateRoot, `[PREWARM] Post-prewarm check 1 unconfirmed for target=${prefix}${acctSuffix}; scheduling follow-up check in ${retryDelayMs}ms.`);
          const retryTimer = setTimeout(() => {
            if (serverClosedRef?.closed) return;
            void verifyPostPrewarm(2);
          }, retryDelayMs);
          retryTimer.unref?.();
        } else {
          appendBrokerLog(stateRoot, `[PREWARM] Post-prewarm verification UNCONFIRMED for target=${prefix}${acctSuffix}: postPct=${postPct ?? "n/a"}, postReset=${postResetIso ?? "n/a"}`);
          emitNotification?.({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level: "warn",
            target: prefix,
            targetModel: resolved.model,
            account: resolvedAccount,
            status: "unconfirmed",
            timerConfirmed: false,
            message: `Prewarm dispatched for ${prefix}${acctSuffix}, but remote timer start could not be confirmed yet.`,
          });
        }
      } catch (err) {
        appendBrokerLog(stateRoot, `[PREWARM] Post-prewarm verification error for ${prefix}${acctSuffix}: ${errorMessage(err)}`);
        emitNotification?.({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          level: "warn",
          target: prefix,
          targetModel: resolved.model,
          account: resolvedAccount,
          status: "unconfirmed",
          timerConfirmed: false,
          message: `Prewarm dispatched for ${prefix}${acctSuffix}, but remote timer start could not be confirmed yet.`,
        });
      }
    };

    const verifyTimer = setTimeout(() => {
      if (serverClosedRef?.closed) return;
      void verifyPostPrewarm(1);
    }, verifyDelayMs);
    verifyTimer.unref?.();
  } else {
    emitNotification?.({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: "error",
      target: prefix,
      targetModel: resolved.model,
      account: resolvedAccount,
      status: "failed",
      message: result.error ?? "Prewarm process did not start.",
      durationMs: dispatched.durationMs,
    });
  }

  const final = rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result });
  if (dispatched.spawned && !manual && mode === "once") {
    const nextModes = { ...settings.settings.prewarmModes, [prefix]: "click" as const };
    const reset = settingsStore.put({ expectedRevision: settings.revision, idempotencyKey: `once-reset-${claimId}`, settings: { ...settings.settings, prewarmModes: nextModes, prewarmMode: nextModes.antigravity } });
    if (reset.status !== 200) result.error = "Prewarm dispatched, but Once mode could not reset because quota settings changed concurrently.";
  }
  return final;
}

function resolvePrewarmTarget(model?: string): { target: "antigravity" | "argon" | "opus" | "codex"; model: string } {
  const value = (model || "antigravity").toLowerCase();
  if (value.includes("argon")) return { target: "argon", model: getLowestAgyModel("argon").model };
  if (value.includes("opus") || value.includes("claude")) return { target: "opus", model: getLowestAgyModel("claude").model };
  if (value.includes("codex") || value.includes("chatgpt")) return { target: "codex", model: getLowestCodexModel().model };
  return { target: "antigravity", model: getLowestAgyModel("gemini").model };
}

function readPrewarmState(filePath: string): PersistedPrewarmArbitration {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PersistedPrewarmArbitration>;
    if (value.schemaVersion !== 1 || !value.windows || !value.idempotency) throw new Error("invalid state schema");
    return { schemaVersion: 1, windows: value.windows, idempotency: value.idempotency };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, windows: {}, idempotency: {} };
    throw new Error(`Prewarm arbitration state is corrupt at ${filePath}; preserved without overwrite: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writePrewarmState(filePath: string, state: PersistedPrewarmArbitration): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const keys = Object.keys(state.idempotency);
  for (const oldest of keys.slice(0, Math.max(0, keys.length - 256))) delete state.idempotency[oldest];
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, filePath);
}

export function appendBrokerLog(stateRoot: string | undefined, message: string): void {
  const root = stateRoot || process.env.INTEGRATED_POWER_STATE_ROOT || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "IntegratedPower", "state");
  const logPath = path.join(root, "broker.log");
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(logPath, line, "utf8");
  } catch {}
  console.log(message);
}

function rememberPrewarmResult(
  state: PersistedPrewarmArbitration,
  statePath: string,
  idempotencyKey: string,
  fingerprint: string,
  outcome: { httpStatus: number; result: PrewarmResult },
): { httpStatus: number; result: PrewarmResult } {
  state.idempotency[idempotencyKey] = { fingerprint, result: outcome.result };
  writePrewarmState(statePath, state);
  return outcome;
}

const PREWARM_ENGLISH_PROMPT = "say hi";

let agyPrewarmLock: Promise<void> = Promise.resolve();

async function withAgyCredentialLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = agyPrewarmLock;
  let release!: () => void;
  agyPrewarmLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function resolveBrokerScript(scriptName: string): string | undefined {
  const candidates: Array<string | undefined> = [];
  const envAssetRoot = process.env.INTEGRATED_POWER_BROKER_ASSET_ROOT?.trim();
  if (envAssetRoot) {
    candidates.push(path.join(path.resolve(envAssetRoot), "scripts", scriptName));
  }
  const manifestPath = path.join(__dirname, "broker-manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { assetRoot?: unknown };
      if (typeof manifest.assetRoot === "string" && manifest.assetRoot.trim()) {
        candidates.push(path.join(path.resolve(__dirname, manifest.assetRoot), "scripts", scriptName));
      }
    } catch {}
  }
  const userHome = process.env.USERPROFILE || os.homedir();
  candidates.push(
    path.join(__dirname, "scripts", scriptName),
    path.join(__dirname, "..", "scripts", scriptName),
    path.join(__dirname, "..", "..", "scripts", scriptName),
    path.join(__dirname, "resources", "scripts", scriptName),
    path.join(userHome, ".gemini", "bin", scriptName),
    path.join(userHome, ".gemini", "antigravity", "bin", scriptName),
    path.join(userHome, ".gemini", "antigravity-ide", "bin", scriptName),
  );
  return candidates.find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)));
}

async function readLiveDefaultAgyAccountEmail(stateRoot?: string): Promise<string | undefined> {
  const readScript = resolveBrokerScript("read-agy-credential.ps1");
  if (!readScript) {
    appendBrokerLog(stateRoot, `[PREWARM] read-agy-credential.ps1 not found in broker asset paths.`);
    return undefined;
  }
  return new Promise((resolve) => {
    cp.execFile(
      "powershell.exe",
      [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
        "-ExecutionPolicy", "Bypass", "-File", readScript, "-Target", "gemini:antigravity",
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 10000 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(undefined);
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout).replace(/^\uFEFF/, ""));
          const email = typeof parsed?.id_token_email === "string" ? parsed.id_token_email.trim() : "";
          resolve(email || undefined);
        } catch {
          resolve(undefined);
        }
      },
    );
  });
}

async function switchAgyAccount(
  targetAccount: string,
  stateRoot?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (targetAccount.includes("project-")) {
    return { ok: true };
  }
  const switchScript = resolveBrokerScript("switch-agy-account.ps1");
  if (!switchScript) {
    const err = "switch-agy-account.ps1 not found in broker asset paths.";
    appendBrokerLog(stateRoot, `[PREWARM] ${err}`);
    return { ok: false, error: err };
  }
  appendBrokerLog(stateRoot, `[PREWARM] Switching agy credential target to ${targetAccount}`);
  return new Promise((resolve) => {
    const ps = cp.spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
      "-ExecutionPolicy", "Bypass", "-File", switchScript, "-Email", targetAccount,
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    ps.stdout?.on("data", (chunk) => outChunks.push(chunk));
    ps.stderr?.on("data", (chunk) => errChunks.push(chunk));
    ps.once("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        const stderrText = Buffer.concat(errChunks).toString("utf8").trim();
        const stdoutText = Buffer.concat(outChunks).toString("utf8").trim();
        const message = stderrText || stdoutText || `switch-agy-account.ps1 exited with code ${code}`;
        appendBrokerLog(stateRoot, `[PREWARM] Failed to switch agy credential target to ${targetAccount}: ${message.slice(0, 240)}`);
        resolve({ ok: false, error: message });
      }
    });
    ps.once("error", (error) => resolve({ ok: false, error: error.message }));
  });
}

function killProcessTreeWindows(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      cp.execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {}
}

async function runAgyPrewarmWithAccount(
  target: "antigravity" | "argon" | "opus",
  model: string,
  targetAccount: string,
  prewarmCwd: string,
  startedAt: number,
  stateRoot?: string,
): Promise<{ spawned: boolean; cancelledEarly?: boolean; durationMs?: number; error?: string }> {
  const isProject = targetAccount.includes("project-");
  let baselineLiveEmail: string | undefined;
  let needsContextSwitch = false;

  try {
    if (!isProject) {
      baselineLiveEmail = await readLiveDefaultAgyAccountEmail(stateRoot);
      needsContextSwitch = !baselineLiveEmail || baselineLiveEmail.toLowerCase() !== targetAccount.toLowerCase();
      if (needsContextSwitch) {
        appendBrokerLog(stateRoot, `[PREWARM] [ScopedContextLock] Acquiring temporary credential context for ${targetAccount} (live baseline: ${baselineLiveEmail ?? "none"})`);
        if (baselineLiveEmail) {
          AgyQuotaClient.setPrewarmBaselineOverride(baselineLiveEmail);
        }
        const switched = await switchAgyAccount(targetAccount, stateRoot);
        if (!switched.ok) {
          return {
            spawned: false,
            durationMs: Date.now() - startedAt,
            error: switched.error || `Failed to switch Antigravity credential to ${targetAccount}.`,
          };
        }
      }
    }

    const agyBin = (process.platform === "win32" && process.env.LOCALAPPDATA && fs.existsSync(path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe")) ? path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe") : undefined)
      || (process.platform === "win32" && process.env.USERPROFILE && fs.existsSync(path.join(process.env.USERPROFILE, ".gemini", "bin", "agy.exe")) ? path.join(process.env.USERPROFILE, ".gemini", "bin", "agy.exe") : undefined)
      || findExecutableOnPath(process.platform === "win32" ? ["agy.exe", "agy.cmd", "agy.bat", "agy"] : ["agy"]);
    if (!agyBin) {
      appendBrokerLog(stateRoot, `[PREWARM] Antigravity CLI (agy.exe) was not found on PATH or standard directories.`);
      return { spawned: false, durationMs: Date.now() - startedAt, error: "Antigravity CLI (agy.exe) was not found." };
    }

    const agyArgs = [
      "-p", PREWARM_ENGLISH_PROMPT,
      "--model", model,
      "--effort", "low",
      "--disable-slash-commands",
      "--output-format", "stream-json",
      "--print-timeout", "25s",
    ];
    const envVars: NodeJS.ProcessEnv = { ...process.env };
    delete envVars.AGY_ACCOUNT;
    if (isProject) {
      envVars.AGY_ADC_AUTH = "true";
      envVars.GOOGLE_GENAI_USE_VERTEXAI = "true";
      envVars.GOOGLE_CLOUD_PROJECT = targetAccount;
    } else {
      delete envVars.GOOGLE_GENAI_USE_VERTEXAI;
      delete envVars.GOOGLE_CLOUD_PROJECT;
      envVars.AGY_ADC_AUTH = "0";
    }

    appendBrokerLog(stateRoot, `[PREWARM] Spawning agy direct (no-console): "${agyBin}" -p "${PREWARM_ENGLISH_PROMPT}" --model "${model}" --effort low --output-format stream-json (target=${target}, account=${targetAccount})`);
    return await new Promise((resolve) => {
      let settled = false;
      let procClosed = false;
      const finish = (res: { spawned: boolean; cancelledEarly?: boolean; error?: string }) => {
        if (settled) return;
        settled = true;
        resolve({ ...res, durationMs: Date.now() - startedAt });
      };

      const proc = cp.spawn(agyBin, agyArgs, {
        cwd: prewarmCwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(agyBin),
        env: envVars,
      });
      let lineBuf = "";
      const chunks: Buffer[] = [];
      let cancelled = false;
      let turnAccepted = false;

      const waitCloseThenFinish = (res: { spawned: boolean; cancelledEarly?: boolean; error?: string }) => {
        if (procClosed) {
          finish(res);
          return;
        }
        const closeFallback = setTimeout(() => finish(res), 1500);
        closeFallback.unref?.();
        proc.once("close", () => {
          clearTimeout(closeFallback);
          finish(res);
        });
      };

      const tryInstantCancel = (reason: string) => {
        if (cancelled) return;
        cancelled = true;
        turnAccepted = true;
        appendBrokerLog(stateRoot, `[PREWARM] agy response started (${reason}, +${Date.now() - startedAt}ms) -> cancelling immediately to save quota.`);
        killProcessTreeWindows(proc.pid);
        waitCloseThenFinish({ spawned: true, cancelledEarly: true });
      };

      proc.stdout?.on("data", (chunk) => {
        chunks.push(chunk);
        lineBuf += chunk.toString("utf8");
        const lines = lineBuf.split(/\r?\n/);
        lineBuf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const ev = JSON.parse(trimmed);
            const stepType = ev.step_update?.step_type;
            if (ev.event === "step_update" && (stepType === "agent_response" || stepType === "tool_call" || stepType === "action")) {
              tryInstantCancel(`agent step '${stepType}' received`);
              break;
            }
            if (ev.event === "result" && ev.result?.status === "SUCCESS") {
              if (!cancelled) {
                clearTimeout(maxWaitTimer);
                appendBrokerLog(stateRoot, `[PREWARM] agy CLI completed result SUCCESS (+${Date.now() - startedAt}ms) without needing kill`);
                waitCloseThenFinish({ spawned: true, cancelledEarly: false });
              }
              break;
            }
          } catch {}
        }
      });
      proc.stderr?.on("data", (chunk) => chunks.push(chunk));
      const maxWaitTimer = setTimeout(() => {
        if (!cancelled) {
          killProcessTreeWindows(proc.pid);
          appendBrokerLog(stateRoot, `[PREWARM] agy CLI timed out after 25s for ${target}.`);
          waitCloseThenFinish({ spawned: turnAccepted, error: turnAccepted ? undefined : "agy CLI timed out before model response started." });
        }
      }, 25000);
      proc.once("error", (error) => {
        procClosed = true;
        clearTimeout(maxWaitTimer);
        appendBrokerLog(stateRoot, `[PREWARM] agy CLI process error for ${target}: ${error.message}`);
        finish({ spawned: false, error: error.message });
      });
      proc.once("close", (code) => {
        procClosed = true;
        clearTimeout(maxWaitTimer);
        const output = Buffer.concat(chunks).toString("utf8").trim();
        if (cancelled || code === 0) {
          appendBrokerLog(stateRoot, `[PREWARM] agy CLI finished (exit=${code}, cancelledEarly=${cancelled}, +${Date.now() - startedAt}ms) for ${target} (${targetAccount}).`);
          finish({ spawned: true, cancelledEarly: cancelled });
        } else {
          appendBrokerLog(stateRoot, `[PREWARM] agy CLI FAILED (exit=${code}) for ${target} (${targetAccount}). Output: ${output.slice(0, 300)}`);
          finish({ spawned: false, error: `AGY exited with code ${code}: ${output.slice(0, 150)}` });
        }
      });
    });
  } finally {
    if (needsContextSwitch && baselineLiveEmail) {
      try {
        appendBrokerLog(stateRoot, `[PREWARM] [ScopedContextLock] Restoring baseline agy credential target to ${baselineLiveEmail}`);
        const restored = await switchAgyAccount(baselineLiveEmail, stateRoot);
        if (restored.ok) {
          appendBrokerLog(stateRoot, `[PREWARM] [ScopedContextLock] Baseline agy credential successfully restored to ${baselineLiveEmail}`);
        } else {
          appendBrokerLog(stateRoot, `[PREWARM] [ScopedContextLock] Failed to restore baseline agy credential to ${baselineLiveEmail}: ${restored.error}`);
        }
      } catch (restoreErr) {
        appendBrokerLog(stateRoot, `[PREWARM] [ScopedContextLock] Failed to restore baseline agy credential to ${baselineLiveEmail}: ${restoreErr}`);
      }
    }
    AgyQuotaClient.setPrewarmBaselineOverride(undefined);
    AgyQuotaClient.clearCredentialCache();
  }
}

async function spawnPrewarm(
  target: "antigravity" | "argon" | "opus" | "codex",
  model: string,
  stateRoot?: string,
  account?: string,
): Promise<{ spawned: boolean; cancelledEarly?: boolean; durationMs?: number; error?: string }> {
  const prewarmCwd = path.join(stateRoot || os.tmpdir(), "prewarm-cwd");
  try { fs.mkdirSync(prewarmCwd, { recursive: true }); } catch {}
  const startedAt = Date.now();

  if (target === "codex") {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (result: { spawned: boolean; cancelledEarly?: boolean; error?: string }) => {
        if (finished) return;
        finished = true;
        resolve({ ...result, durationMs: Date.now() - startedAt });
      };
      try {
        const codexCli = findCodexCliSync();
        if (!codexCli) {
          appendBrokerLog(stateRoot, `[PREWARM] Codex CLI is unavailable.`);
          return finish({ spawned: false, error: "Codex CLI is unavailable." });
        }
        const lowest = getLowestCodexModel();
        appendBrokerLog(stateRoot, `[PREWARM] Spawning Codex CLI: "${codexCli}" exec -m "${lowest.model}" prompt="${PREWARM_ENGLISH_PROMPT}" for target=codex`);
        const proc = cp.spawn(codexCli, ["exec", "-m", lowest.model, "--skip-git-repo-check", "--ephemeral", "--ignore-rules", "--disable", "skills", "-c", `model="${lowest.model}"`, "-c", `model_reasoning_effort="${lowest.reasoningEffort}"`, PREWARM_ENGLISH_PROMPT], {
          cwd: prewarmCwd,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          shell: codexCli === "codex" || codexCli.endsWith(".cmd"),
        });
        const chunks: Buffer[] = [];
        let cancelled = false;
        const cancelAfterFirstDelta = (text: string) => {
          if (cancelled) return;
          if (text.trim().length > 0) {
            cancelled = true;
            appendBrokerLog(stateRoot, `[PREWARM] Codex response stream started (+${Date.now() - startedAt}ms) -> cancelling immediately to minimize tokens.`);
            killProcessTreeWindows(proc.pid);
            finish({ spawned: true, cancelledEarly: true });
          }
        };
        proc.stdout?.on("data", (chunk) => {
          chunks.push(chunk);
          cancelAfterFirstDelta(chunk.toString("utf8"));
        });
        proc.stderr?.on("data", (chunk) => chunks.push(chunk));
        const spawnTimer = setTimeout(() => {
          if (proc.pid && !cancelled) {
            appendBrokerLog(stateRoot, `[PREWARM] Codex CLI started (PID: ${proc.pid})`);
            finish({ spawned: true });
          }
        }, 500);
        const timer = setTimeout(() => {
          if (!cancelled) {
            killProcessTreeWindows(proc.pid);
            appendBrokerLog(stateRoot, `[PREWARM] Codex CLI timed out after 8s (force killed).`);
            finish({ spawned: true, cancelledEarly: true });
          }
        }, 8000);
        proc.once("error", (error) => {
          clearTimeout(spawnTimer);
          clearTimeout(timer);
          appendBrokerLog(stateRoot, `[PREWARM] Codex CLI process error: ${error.message}`);
          finish({ spawned: false, error: error.message });
        });
        proc.once("close", (code) => {
          clearTimeout(spawnTimer);
          clearTimeout(timer);
          const output = Buffer.concat(chunks).toString("utf8").trim();
          if (cancelled || code === 0 || code === null) {
            appendBrokerLog(stateRoot, `[PREWARM] Codex CLI completed (exit=${code}, cancelledEarly=${cancelled}, +${Date.now() - startedAt}ms). Output: ${output.slice(0, 120)}`);
            finish({ spawned: true, cancelledEarly: cancelled });
          } else {
            appendBrokerLog(stateRoot, `[PREWARM] Codex CLI exited with code ${code}. Output: ${output.slice(0, 300)}`);
            finish({ spawned: false, error: `Codex exited with code ${code}` });
          }
        });
      } catch (error) {
        const errStr = error instanceof Error ? error.message : String(error);
        appendBrokerLog(stateRoot, `[PREWARM] Unexpected spawn error: ${errStr}`);
        finish({ spawned: false, error: errStr });
      }
    });
  }

  const targetAccount = account?.trim();
  if (!targetAccount) {
    const err = "No target Antigravity account specified for prewarm.";
    appendBrokerLog(stateRoot, `[PREWARM] Failed: ${err}`);
    return { spawned: false, durationMs: Date.now() - startedAt, error: err };
  }

  return withAgyCredentialLock(() => runAgyPrewarmWithAccount(target, model, targetAccount, prewarmCwd, startedAt, stateRoot));
}

function streamTaskEvents(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  broker: IntegratedPowerBroker,
  taskId: string,
): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("X-AG-UI-Version", "1");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  let cursor = 0;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  const cleanup = () => {
    closed = true;
    if (timer) clearTimeout(timer);
  };
  request.on("close", cleanup);
  const pump = async () => {
    if (closed) return;
    try {
      const events = await broker.events(taskId);
      for (const event of events.slice(cursor)) {
        const mapped = mapAgUiEvent(event);
        if (mapped) {
          const validated = validateAgUiEvent(mapped);
          response.write(`event: ${validated.type}\ndata: ${JSON.stringify(validated)}\n\n`);
        }
        if (event.type === "task.proposal") {
          const messageStart = validateAgUiEvent({ type: "TEXT_MESSAGE_START", messageId: event.id, role: "assistant", timestamp: Date.parse(event.createdAt) || Date.now() });
          response.write(`event: ${messageStart.type}\ndata: ${JSON.stringify(messageStart)}\n\n`);
          const toolEnd: AgUiEvent = { type: "TOOL_CALL_END", toolCallId: (event.payload as { delegationEventId?: string })?.delegationEventId ?? event.id, timestamp: Date.parse(event.createdAt) || Date.now() } as any;
          const validatedToolEnd = validateAgUiEvent(toolEnd);
          response.write(`event: ${validatedToolEnd.type}\ndata: ${JSON.stringify(validatedToolEnd)}\n\n`);
          const messageEnd = validateAgUiEvent({ type: "TEXT_MESSAGE_END", messageId: event.id, timestamp: Date.parse(event.createdAt) || Date.now() });
          response.write(`event: ${messageEnd.type}\ndata: ${JSON.stringify(messageEnd)}\n\n`);
        }
      }
      cursor = events.length;
      const terminal = events.some((event) => ["task.completed", "task.failed", "task.cancelled", "task.merged"].includes(event.type));
      if (terminal) return response.end();
    } catch (error) {
      const event: AgUiEvent = { type: "RUN_ERROR", runId: taskId, message: error instanceof Error ? error.message : String(error), timestamp: Date.now() } as any;
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      return response.end();
    }
    timer = setTimeout(() => void pump(), 500);
  };
  void pump();
}

function mapAgUiEvent(event: Awaited<ReturnType<IntegratedPowerBroker["events"]>>[number]): AgUiEvent | undefined {
  const timestamp = Date.parse(event.createdAt) || Date.now();
  if (event.type === "task.created") return { type: "RUN_STARTED", runId: event.taskId, threadId: event.taskId, timestamp } as any;
  if (event.type === "task.delegated") return { type: "TOOL_CALL_START", toolCallId: event.id, toolCallName: `delegate:${event.actor}`, timestamp } as any;
  if (event.type === "task.proposal") {
    const content = (event.payload as { content?: string })?.content ?? "";
    return { type: "TEXT_MESSAGE_CONTENT", messageId: event.id, delta: content, timestamp } as any;
  }
  if (["task.completed", "task.merged"].includes(event.type)) return { type: "RUN_FINISHED", runId: event.taskId, threadId: event.taskId, outcome: { type: "success" }, timestamp } as any;
  if (event.type === "task.conflict") return { type: "RUN_ERROR", runId: event.taskId, message: String((event.payload as { error?: string })?.error ?? "merge conflict"), timestamp } as any;
  if (event.type === "task.failed") return { type: "RUN_ERROR", runId: event.taskId, message: String((event.payload as { error?: string })?.error ?? "task failed"), timestamp } as any;
  if (event.type === "task.cancelled") return { type: "RUN_ERROR", runId: event.taskId, message: "task cancelled", timestamp } as any;
  return undefined;
}

function send(response: http.ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.end(JSON.stringify(value));
}

type WorkspaceScope = { workspaceId: string; storagePath: string; workspacePath?: string };
type WorkspaceScopeError = { status: number; error: string; workspaceId?: string };

async function resolveWorkspaceScope(url: URL, stateRoot: string): Promise<WorkspaceScope | WorkspaceScopeError> {
  const requestedId = url.searchParams.get("workspaceId")?.trim();
  const requestedPath = url.searchParams.get("workspacePath")?.trim();
  if (!requestedId && !requestedPath) return { status: 400, error: "workspaceId or workspacePath is required" };
  if (requestedId && !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(requestedId)) {
    return { status: 400, error: "workspaceId has an invalid format", workspaceId: requestedId };
  }
  let descriptor: ReturnType<typeof resolveEggRWorkspaceDescriptor> | undefined;
  if (requestedPath) {
    if (!path.isAbsolute(requestedPath)) return { status: 400, error: "workspacePath must be absolute", workspaceId: requestedId };
    try {
      const info = await fs.promises.stat(requestedPath);
      if (!info.isDirectory()) return { status: 400, error: "workspacePath must identify a directory", workspaceId: requestedId };
      descriptor = resolveEggRWorkspaceDescriptor(requestedPath);
    } catch (error) {
      return { status: 400, error: `Unable to resolve workspacePath: ${errorMessage(error)}`, workspaceId: requestedId };
    }
  }
  const resolvedId = descriptor
    ? eggRWorkspaceId(descriptor.repoRoot, descriptor.remoteUrl, descriptor.configuredId)
    : requestedId!;
  if (requestedId && requestedId !== resolvedId) {
    return { status: 400, error: "workspaceId does not match workspacePath", workspaceId: requestedId };
  }
  const storagePath = descriptor
    ? workspaceStoragePathForFolder(stateRoot, descriptor.repoRoot, descriptor.remoteUrl, descriptor.configuredId)
    : path.join(stateRoot, "workspaces", resolvedId);
  return { workspaceId: resolvedId, storagePath, workspacePath: descriptor?.repoRoot };
}

function taskInWorkspace(workspacePath: string | undefined, expectedId: string): boolean {
  if (!workspacePath) return false;
  try {
    const descriptor = resolveEggRWorkspaceDescriptor(workspacePath);
    return eggRWorkspaceId(descriptor.repoRoot, descriptor.remoteUrl, descriptor.configuredId) === expectedId;
  } catch {
    return false;
  }
}

function normalizeArtifactPath(value: string, workspacePath: string | undefined, storagePath: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\") || trimmed.startsWith("//")) return undefined;
  if (!path.isAbsolute(trimmed)) {
    const portable = trimmed.replace(/\\/g, "/");
    if (portable.split("/").includes("..")) return undefined;
    return portable.split("/").filter((part) => part && part !== ".").join("/") || undefined;
  }
  const resolved = path.resolve(trimmed);
  if (workspacePath && pathIsInside(resolved, workspacePath)) {
    return path.relative(workspacePath, resolved).split(path.sep).join("/") || undefined;
  }
  if (pathIsInside(resolved, storagePath)) {
    const relative = path.relative(storagePath, resolved).split(path.sep).join("/");
    return relative ? `[global]/${relative}` : undefined;
  }
  return undefined;
}

function pathIsInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function brokerVersion(): string {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(__dirname, "broker-manifest.json"), "utf8"));
    if (typeof value.brokerVersion === "string") return value.brokerVersion;
  } catch { /* compiled extension may be running before its manifest is written */ }
  try { return String(require("../../package.json").version); } catch { return process.env.INTEGRATED_POWER_BROKER_VERSION || "unknown"; }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function quotaPercentageOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function extractA2AText(message: any): string {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts.map((part: any) => part?.content?.$case === "text" ? part.content.value : part?.text ?? "").filter(Boolean).join("\n").trim();
}

function toA2ATask(task: Awaited<ReturnType<IntegratedPowerBroker["listTasks"]>>[number], text: string): Record<string, any> {
  return {
    id: task.id,
    contextId: task.linkedConversationId || task.id,
    status: {
      state: task.status === "completed" ? "TASK_STATE_COMPLETED" : task.status === "failed" ? "TASK_STATE_FAILED" : task.status === "cancelled" ? "TASK_STATE_CANCELED" : "TASK_STATE_SUBMITTED",
      message: text ? { messageId: `${task.id}:input`, contextId: task.linkedConversationId || task.id, role: "ROLE_USER", parts: [{ content: { $case: "text", value: text }, mediaType: "text/plain" }], metadata: {}, extensions: [], referenceTaskIds: [] } : undefined,
      timestamp: task.updatedAt,
    },
    artifacts: [],
    history: [],
    metadata: { integratedPowerTaskId: task.id, revision: task.revision },
  };
}

class RequestBodyTooLargeError extends Error {}

async function readJson(request: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new RequestBodyTooLargeError(`Request body exceeds ${maxBytes} bytes.`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new RequestBodyTooLargeError(`Request body exceeds ${maxBytes} bytes.`);
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

interface QuotaNotificationState { previous: Record<string, unknown>; notifiedIds: string[]; }

function readQuotaNotificationState(filePath: string): QuotaNotificationState | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<QuotaNotificationState>;
    if (!value.previous || typeof value.previous !== "object" || !Array.isArray(value.notifiedIds) || value.notifiedIds.some((id) => typeof id !== "string")) {
      throw new Error("invalid state schema");
    }
    return { previous: value.previous as Record<string, unknown>, notifiedIds: value.notifiedIds as string[] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Quota notification state is corrupt at ${filePath}; preserved without overwrite: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeQuotaNotificationState(filePath: string, state: QuotaNotificationState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}
