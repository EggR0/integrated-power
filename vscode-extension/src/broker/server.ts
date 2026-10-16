import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import * as crypto from "crypto";
import { BrokerConflictError, IntegratedPowerBroker } from "./broker";
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
import { eggRWorkspaceId, resolveEggRWorkspaceDescriptor, resolveIntegratedPowerStateRoot, workspaceStoragePathForFolder } from "../storagePath";

export const BROKER_SCHEMA_VERSION = 2;
export const BROKER_CAPABILITIES = [
  "tasks.read", "tasks.write", "approvals.read", "approvals.userDecision", "tokens.read",
  "providers.external", "quota.prewarm", "workspaces.read", "runs.read", "metrics.localLlm.read",
  "quota.settings.read", "quota.settings.write", "quota.notifications.claim",
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

export interface BrokerServerOptions {
  stateRoot?: string;
  tokenStatusReader?: () => Promise<LiveTokenStatus>;
  prewarmDispatcher?: (target: "antigravity" | "opus" | "codex", model: string) => Promise<{ spawned: boolean; error?: string }>;
  autoSchedule?: boolean;
}

interface PrewarmRequest {
  model?: string;
  window?: "5h" | "weekly";
  manual?: boolean;
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
}

interface PersistedPrewarmArbitration {
  schemaVersion: 1;
  windows: Record<string, { windowId: string; status: "dispatching" | "dispatched" | "failed"; attemptedAt: number; claimId: string; error?: string }>;
  idempotency: Record<string, { fingerprint: string; result: PrewarmResult }>;
}

export async function startBrokerServer(
  broker: IntegratedPowerBroker,
  requestedPort = 0,
  options: BrokerServerOptions = {},
): Promise<BrokerServerHandle> {
  const stateRoot = path.resolve(options.stateRoot ?? resolveIntegratedPowerStateRoot());
  const quotaSettingsStore = new QuotaSettingsStore(stateRoot);
  const readTokenStatus = options.tokenStatusReader ?? (() => scanLiveTokenStatus());
  const dispatchPrewarm = options.prewarmDispatcher ?? spawnPrewarm;
  const prewarmStatePath = path.join(stateRoot, "broker", "prewarm-arbitration.json");
  const quotaNotificationStatePath = path.join(stateRoot, "broker", "quota-notification-state.json");
  let quotaNotificationQueue = Promise.resolve();
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
        const stateRoot = process.env.INTEGRATED_POWER_STATE_ROOT || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "IntegratedPower", "state");
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
        const outcome = await executePrewarmRequest(input, quotaSettingsStore, prewarmStatePath, readTokenStatus, dispatchPrewarm);
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
    if (schedulerActive) return;
    const settingsSnapshot = quotaSettingsStore.get();
    if (!settingsSnapshot.initialized || !Object.values(settingsSnapshot.settings.prewarmModes).some((mode) => mode !== "click")) return;
    if (Date.now() - lastSchedulerPoll < settingsSnapshot.settings.pollIntervalMs) return;
    lastSchedulerPoll = Date.now();
    schedulerActive = true;
    void (async () => {
      try {
        const status = await readTokenStatus();
        for (const target of ["antigravity", "opus", "codex"] as const) {
          if (settingsSnapshot.settings.prewarmModes[target] === "click") continue;
          await executePrewarmRequest({ model: target, manual: false, idempotencyKey: crypto.randomUUID(), expectedSettingsRevision: settingsSnapshot.revision }, quotaSettingsStore, prewarmStatePath, readTokenStatus, dispatchPrewarm, status);
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
      if (schedulerTimer) clearInterval(schedulerTimer);
      return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function executePrewarmRequest(
  input: PrewarmRequest,
  settingsStore: QuotaSettingsStore,
  statePath: string,
  readTokenStatus: () => Promise<LiveTokenStatus>,
  dispatcher: BrokerServerOptions["prewarmDispatcher"],
  statusOverride?: LiveTokenStatus,
): Promise<{ httpStatus: number; result: PrewarmResult }> {
  const resolved = resolvePrewarmTarget(input.model);
  const manual = input.manual !== false;
  const idempotencyKey = input.idempotencyKey?.trim() || `legacy-${crypto.randomUUID()}`;
  if (idempotencyKey.length > 128) return { httpStatus: 400, result: { ok: false, status: "failed", timerConfirmed: false, error: "idempotencyKey must not exceed 128 characters." } };
  const windowType: "5h" | "weekly" = input.window === "weekly" ? "weekly" : "5h";
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ target: resolved.target, model: resolved.model, window: windowType, manual, expectedSettingsRevision: input.expectedSettingsRevision ?? null })).digest("hex");
  const liveStatus = statusOverride ?? await readTokenStatus();
  // Read after the awaited status refresh so concurrent requests observe a
  // claim committed by the request that resumed first.
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
  const windowKey = `${prefix}:${windowType}:${windowId}`;
  const previous = state.windows[windowKey];
  if (previous && (previous.status === "dispatching" || previous.status === "dispatched" || Date.now() - previous.attemptedAt < 30_000)) {
    return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "duplicate", timerConfirmed: false, claimId: previous.claimId, model: prefix, targetModel: resolved.model, error: "This quota window already has an active or completed prewarm claim." } });
  }
  const settings = settingsStore.get();
  if (typeof input.expectedSettingsRevision === "number" && input.expectedSettingsRevision !== settings.revision) {
    return { httpStatus: 409, result: { ok: false, status: "skipped", timerConfirmed: false, model: resolved.target, targetModel: resolved.model, error: `Quota settings revision conflict; current revision is ${settings.revision}.` } };
  }
  const mode = settings.settings.prewarmModes[resolved.target];
  if (!manual && (!settings.initialized || mode === "click")) {
    return { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: resolved.target, targetModel: resolved.model, error: "Automatic prewarm is not armed for this target." } };
  }
  const fiveHour = quotaPercentageOrUndefined((liveStatus as any)[`${prefix}Percentage`]);
  const weekly = quotaPercentageOrUndefined((liveStatus as any)[`${weeklyPrefix}Percentage`]);
  const pools = Array.isArray((liveStatus as any).quotaPools) ? (liveStatus as any).quotaPools : [];
  const fivePool = pools.find((pool: any) => pool?.id === `${prefix}.5h` || pool?.id === `${prefix}.default` || (pool?.provider === (prefix === "opus" ? "anthropic" : prefix) && pool?.windowDurationMins === 300));
  const weeklyPool = pools.find((pool: any) => pool?.id === `${prefix}.weekly` || (pool?.provider === (prefix === "opus" ? "anthropic" : prefix) && pool?.windowDurationMins === 10080));
  const fallbackTimestamp = Date.parse(String((liveStatus as any).lastSync ?? (liveStatus as any).updatedAt ?? (liveStatus as any).directUsage?.lastMeasuredAt ?? ""));
  const fiveMeasuredAt = Date.parse(String(fivePool?.measuredAt ?? "")) || fallbackTimestamp;
  const weeklyMeasuredAt = Date.parse(String(weeklyPool?.measuredAt ?? "")) || fallbackTimestamp;

  if (windowType === "5h") {
    if (fiveHour === undefined) {
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, error: `${prefix} requires reported 5-hour quota data before pre-warm.` } });
    }
    if (Number.isFinite(fiveMeasuredAt) && (fiveMeasuredAt > Date.now() + 60_000 || Date.now() - fiveMeasuredAt > 5 * 60_000)) {
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, error: `${prefix} requires fresh, reported 5-hour quota data before pre-warm.` } });
    }
    if (fiveHour < 99.95) {
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, error: `${prefix} quota is not 100% full (${fiveHour.toFixed(1)}%).` } });
    }
    const resetTimeStr = (liveStatus as any)[`${prefix}ResetTime`];
    const resetDate = resetTimeStr ? new Date(resetTimeStr) : undefined;
    const diffMs = resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate.getTime() - Date.now() : undefined;
    if (diffMs !== undefined && diffMs > 0 && diffMs < 5 * 3600 * 1000 - 15 * 60 * 1000) {
      const waitMin = Math.ceil(diffMs / 60000);
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, error: `${prefix} 5-hour quota timer is already active (${waitMin}m remaining). Pre-warm requires a full 5-hour window.` } });
    }
    if (weekly !== undefined && weekly <= 0.05) {
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, error: `${prefix} weekly quota is exhausted.` } });
    }
  } else {
    if (weekly === undefined) {
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, error: `${prefix} requires reported weekly quota data before pre-warm.` } });
    }
    if (Number.isFinite(weeklyMeasuredAt) && (weeklyMeasuredAt > Date.now() + 60_000 || Date.now() - weeklyMeasuredAt > 5 * 60_000)) {
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, error: `${prefix} requires fresh, reported weekly quota data before pre-warm.` } });
    }
    if (weekly < 99.95) {
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, error: `${prefix} weekly quota is not 100% full (${weekly.toFixed(1)}%).` } });
    }
    const weeklyResetTimeStr = (liveStatus as any)[`${weeklyPrefix}ResetTime`];
    const weeklyResetDate = weeklyResetTimeStr ? new Date(weeklyResetTimeStr) : undefined;
    const weeklyDiffMs = weeklyResetDate && !Number.isNaN(weeklyResetDate.getTime()) ? weeklyResetDate.getTime() - Date.now() : undefined;
    if (weeklyDiffMs !== undefined && weeklyDiffMs > 0 && weeklyDiffMs < 168 * 3600 * 1000 - 4 * 3600 * 1000) {
      const waitHours = Math.ceil(weeklyDiffMs / 3600000);
      return rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result: { ok: true, status: "skipped", timerConfirmed: false, model: prefix, targetModel: resolved.model, error: `${prefix} weekly quota timer is already active (${waitHours}h remaining). Pre-warm requires a full 168-hour window.` } });
    }
  }
  const claimId = crypto.createHash("sha256").update(windowKey).digest("hex").slice(0, 24);
  state.windows[windowKey] = { windowId, status: "dispatching", attemptedAt: Date.now(), claimId };
  writePrewarmState(statePath, state);
  let dispatched: { spawned: boolean; error?: string };
  try { dispatched = await (dispatcher ?? spawnPrewarm)(prefix, resolved.model); }
  catch (error) { dispatched = { spawned: false, error: error instanceof Error ? error.message : String(error) }; }
  const result: PrewarmResult = dispatched.spawned
    ? { ok: true, status: "dispatched", timerConfirmed: false, claimId, model: prefix, targetModel: resolved.model }
    : { ok: false, status: "failed", timerConfirmed: false, claimId, model: prefix, targetModel: resolved.model, error: dispatched.error ?? "Prewarm process did not start." };
  state.windows[windowKey] = { windowId, status: dispatched.spawned ? "dispatched" : "failed", attemptedAt: Date.now(), claimId, error: result.error };
  const final = rememberPrewarmResult(state, statePath, idempotencyKey, fingerprint, { httpStatus: 200, result });
  if (dispatched.spawned && !manual && mode === "once") {
    const nextModes = { ...settings.settings.prewarmModes, [prefix]: "click" as const };
    const reset = settingsStore.put({ expectedRevision: settings.revision, idempotencyKey: `once-reset-${claimId}`, settings: { ...settings.settings, prewarmModes: nextModes, prewarmMode: nextModes.antigravity } });
    if (reset.status !== 200) result.error = "Prewarm dispatched, but Once mode could not reset because quota settings changed concurrently.";
  }
  return final;
}

function resolvePrewarmTarget(model?: string): { target: "antigravity" | "opus" | "codex"; model: string } {
  const value = (model || "antigravity").toLowerCase();
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

async function spawnPrewarm(target: "antigravity" | "opus" | "codex", model: string): Promise<{ spawned: boolean; error?: string }> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: { spawned: boolean; error?: string }) => { if (finished) return; finished = true; resolve(result); };
    try {
      if (target === "codex") {
        const codexCli = findCodexCliSync();
        if (!codexCli) return finish({ spawned: false, error: "Codex CLI is unavailable." });
        const lowest = getLowestCodexModel();
        const proc = cp.spawn(codexCli, ["exec", "-m", lowest.model, "--skip-git-repo-check", "--ephemeral", "--ignore-rules", "--disable", "skills", "-c", `model="${lowest.model}"`, "-c", `model_reasoning_effort="${lowest.reasoningEffort}"`, "1"], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true, shell: codexCli === "codex" || codexCli.endsWith(".cmd") });
        const timer = setTimeout(() => {
          try { if (!proc.killed) proc.kill(); } catch {}
          finish({ spawned: true });
        }, 3000);
        proc.once("error", (error) => { clearTimeout(timer); finish({ spawned: false, error: error.message }); });
        proc.once("close", (code) => {
          clearTimeout(timer);
          finish(code === 0 || code === null ? { spawned: true } : { spawned: false, error: `Codex exited with code ${code}` });
        });
      } else {
        const agyBin = findExecutableOnPath(process.platform === "win32" ? ["agy.exe", "agy.cmd", "agy.bat", "agy"] : ["agy"])
          || (process.platform === "win32" && process.env.LOCALAPPDATA && fs.existsSync(path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe")) ? path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe") : undefined);
        if (!agyBin) return finish({ spawned: false, error: "Antigravity CLI was not found on PATH." });
        const proc = cp.spawn(agyBin, ["-p", "1", "--model", model, "--effort", "low", "--disable-slash-commands", "--print-timeout", "3s"], { windowsHide: true, shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(agyBin) });
        const timer = setTimeout(() => {
          try { if (!proc.killed) proc.kill(); } catch {}
          finish({ spawned: true });
        }, 8000);
        proc.once("error", (error) => { clearTimeout(timer); finish({ spawned: false, error: error.message }); });
        proc.once("close", (code) => {
          clearTimeout(timer);
          finish(code === 0 || code === null ? { spawned: true } : { spawned: false, error: `AGY exited with code ${code}` });
        });
      }
    } catch (error) { finish({ spawned: false, error: error instanceof Error ? error.message : String(error) }); }
  });
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
