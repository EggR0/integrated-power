import * as http from "http";
import { ApprovalCommandInput, ApprovalRequest, CreateTaskInput, DelegateTaskInput, TaskEnvelope, TaskEvent } from "./protocol";
import { LocalLlmMetric, RunSummary } from "../types";
import { QuotaSettings, QuotaSettingsWrite } from "./quotaSettingsStore";

export interface WorkspaceScope {
  workspaceId?: string;
  workspacePath?: string;
}

export interface BrokerHealth {
  ok: boolean;
  service: string;
  schemaVersion?: number;
  brokerVersion?: string;
  brokerSource?: string;
  capabilities?: string[];
}

export interface WorkspaceListResult {
  ok: boolean;
  workspaces: Array<{ workspaceId: string }>;
  source: string;
  errors?: string[];
}

export interface RunsResult {
  ok: boolean;
  runs: RunSummary[];
  activeCount: number;
  activeRuns?: RunSummary[];
  artifacts?: RunSummary["artifacts"];
  parseErrors?: string[];
  errors: string[];
  source?: string;
  workspaceId?: string;
}

export interface LocalLlmMetricsResult {
  ok: boolean;
  metrics: LocalLlmMetric[];
  parseErrors?: string[];
  errors: string[];
  source?: string;
  workspaceId?: string;
}

export interface TasksResult {
  ok: boolean;
  tasks: TaskEnvelope[];
  activeCount: number;
  errors: string[];
  source?: string;
  workspaceId?: string;
}

export interface TaskDetailsResult {
  ok: boolean;
  task: TaskEnvelope;
  events: TaskEvent[];
  errors: string[];
  source: string;
  workspaceId: string;
}

export interface ApprovalsResult {
  ok: boolean;
  approvals: ApprovalRequest[];
  errors: string[];
  source?: string;
  workspaceId?: string;
}

export interface QuotaSettingsResult {
  ok: boolean;
  revision: number;
  initialized: boolean;
  settings: QuotaSettings;
  source: string;
  errors: string[];
  conflict?: boolean;
  idempotencyKey?: string;
}

export type PutQuotaSettingsInput = QuotaSettingsWrite;

export interface PrewarmInput {
  model?: string;
  manual: boolean;
  idempotencyKey: string;
  expectedSettingsRevision?: number;
}

export interface PrewarmResult {
  ok: boolean;
  status: "dispatched" | "duplicate" | "failed" | "skipped";
  timerConfirmed: boolean;
  claimId?: string;
  error?: string;
  model?: string;
  targetModel?: string;
}

export interface QuotaRefillNotification {
  id: string;
  configKey: string;
  window: string;
  model: string;
  title: string;
  message: string;
  previousPercent: number;
  currentPercent: number;
}

export interface QuotaRefillNotificationResult {
  ok: boolean;
  notifications: QuotaRefillNotification[];
  source: string;
  errors: string[];
}

export class BrokerClient {
  constructor(private readonly portProvider: () => number | undefined) {}

  public async health(): Promise<BrokerHealth> {
    const health = await this.request<BrokerHealth>("GET", "/health");
    if (!health.ok || health.service !== "integrated-power-broker") {
      throw new Error("The service on the configured broker port is not an Integrated Power broker.");
    }
    return health;
  }

  public async listWorkspaces(): Promise<WorkspaceListResult> {
    await this.requireCapability("workspaces.read");
    return this.request("GET", "/v1/workspaces");
  }

  public async listRuns(scope: WorkspaceScope): Promise<RunsResult> {
    await this.requireCapability("runs.read");
    return this.request("GET", `/v1/runs${scopeQuery(scope)}`);
  }

  public async listLocalLlmMetrics(scope: WorkspaceScope): Promise<LocalLlmMetricsResult> {
    await this.requireCapability("metrics.localLlm.read");
    return this.request("GET", `/v1/metrics/local-llm${scopeQuery(scope)}`);
  }

  public async listTasks(scope: WorkspaceScope): Promise<TasksResult> {
    await this.requireCapability("tasks.read");
    return this.request("GET", `/v1/tasks${scopeQuery(scope)}`);
  }

  public async getTaskDetails(taskId: string, scope: WorkspaceScope): Promise<TaskDetailsResult> {
    await this.requireCapability("tasks.read");
    return this.request("GET", `/v1/tasks/${encodeURIComponent(taskId)}${scopeQuery(scope)}`);
  }

  public async listApprovals(scope: WorkspaceScope): Promise<ApprovalsResult> {
    await this.requireCapability("approvals.read");
    return this.request("GET", `/v1/approvals${scopeQuery(scope)}`);
  }

  public async getQuotaSettings(): Promise<QuotaSettingsResult> {
    await this.requireCapability("quota.settings.read");
    return this.request("GET", "/v1/settings/quota");
  }

  public async putQuotaSettings(input: PutQuotaSettingsInput): Promise<QuotaSettingsResult> {
    await this.requireCapability("quota.settings.write");
    return this.request("POST", "/v1/settings/quota", input, [409]);
  }

  public async prewarm(input: PrewarmInput): Promise<PrewarmResult> {
    await this.requireCapability("quota.prewarm");
    return this.request("POST", "/v1/tokens/prewarm", input, [409]);
  }

  /** Claims shared refill events without sending provider quota data; the broker reads its authoritative TokenManager snapshot. */
  public async claimQuotaRefillNotifications(): Promise<QuotaRefillNotificationResult> {
    await this.requireCapability("quota.notifications.claim");
    return this.request("POST", "/v1/notifications/quota-refill", {});
  }

  public async createTask(input: CreateTaskInput): Promise<TaskEnvelope> {
    await this.requireCapability("tasks.write");
    return (await this.request<{ task: TaskEnvelope }>("POST", "/v1/tasks", input)).task;
  }

  public async delegateTask(input: DelegateTaskInput): Promise<TaskEvent> {
    await this.requireCapability("tasks.write");
    return (await this.request<{ event: TaskEvent }>("POST", "/v1/tasks/delegate", input)).event;
  }

  public async cancelTask(taskId: string, expectedRevision: number, idempotencyKey?: string): Promise<TaskEvent> {
    await this.requireCapability("tasks.write");
    return (await this.request<{ event: TaskEvent }>("POST", `/v1/tasks/${encodeURIComponent(taskId)}/cancel`, { expectedRevision, idempotencyKey })).event;
  }

  public async classifyTask(
    taskId: string,
    expectedRevision: number,
    provider?: import("./protocol").ProviderId,
    mode?: "offline" | "agent",
    idempotencyKey?: string,
  ): Promise<{ task: TaskEnvelope; event: TaskEvent }> {
    await this.requireCapability("tasks.write");
    return await this.request<{ task: TaskEnvelope; event: TaskEvent }>(
      "POST",
      `/v1/tasks/${encodeURIComponent(taskId)}/classify`,
      { expectedRevision, provider, mode, idempotencyKey },
    );
  }

  public async getTags(): Promise<string[]> {
    return (await this.request<{ tags: string[] }>("GET", "/v1/tags")).tags;
  }

  public async listCapabilities(): Promise<import("./protocol").AgentCapability[]> {
    try {
      return (await this.request<{ capabilities: import("./protocol").AgentCapability[] }>("GET", "/v1/capabilities")).capabilities;
    } catch {
      return [];
    }
  }

  public async requestApproval(input: ApprovalCommandInput): Promise<ApprovalRequest> {
    await this.requireCapability("approvals.userDecision");
    return (await this.request<{ approval: ApprovalRequest }>("POST", "/v1/approvals", input)).approval;
  }

  public async approve(approvalId: string, expectedRevision: number, idempotencyKey?: string): Promise<void> {
    await this.requireCapability("approvals.userDecision");
    await this.request("POST", `/v1/approvals/${encodeURIComponent(approvalId)}/approve`, { expectedRevision, idempotencyKey });
  }

  public async reject(approvalId: string, expectedRevision: number, idempotencyKey?: string): Promise<void> {
    await this.requireCapability("approvals.userDecision");
    await this.request("POST", `/v1/approvals/${encodeURIComponent(approvalId)}/reject`, { expectedRevision, idempotencyKey });
  }

  private async requireCapability(capability: string): Promise<void> {
    const health = await this.health();
    if (health.schemaVersion !== 2 || !health.capabilities?.includes(capability)) {
      const version = health.brokerVersion ?? "legacy version";
      throw new Error(`Broker ${version} does not support ${capability} (schema ${health.schemaVersion ?? "unknown"}). It remains running; no automatic replacement was attempted.`);
    }
  }

  private async request<T>(method: "GET" | "POST", route: string, body?: unknown, acceptedStatusCodes: number[] = []): Promise<T> {
    const port = this.portProvider();
    if (!port) throw new Error("Integrated Power broker is not started.");
    return new Promise<T>((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
      const request = http.request({ host: "127.0.0.1", port, method, path: route, timeout: 5000, headers: payload ? { "content-type": "application/json", "content-length": payload.length } : undefined }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let value: unknown;
          try { value = text ? JSON.parse(text) : {}; }
          catch { return reject(new Error(`Broker returned invalid JSON (${response.statusCode ?? "unknown status"}) for ${route}.`)); }
          if (((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) && !acceptedStatusCodes.includes(response.statusCode ?? 500)) {
            const error = value && typeof value === "object" && "error" in value ? String((value as { error: unknown }).error) : JSON.stringify(value);
            return reject(new Error(`Broker ${method} ${route} failed (${response.statusCode}): ${error}`));
          }
          resolve(value as T);
        });
      });
      request.on("timeout", () => request.destroy(new Error(`Broker ${method} ${route} timed out.`)));
      request.on("error", (error) => reject(new Error(`Broker ${method} ${route} transport error: ${error.message}`)));
      if (payload) request.write(payload);
      request.end();
    });
  }
}

function scopeQuery(scope: WorkspaceScope): string {
  const workspaceId = scope.workspaceId?.trim();
  const workspacePath = scope.workspacePath?.trim();
  if (!workspaceId && !workspacePath) throw new Error("An explicit workspaceId or workspacePath is required.");
  const query = new URLSearchParams();
  if (workspaceId) query.set("workspaceId", workspaceId);
  if (workspacePath) query.set("workspacePath", workspacePath);
  return `?${query.toString()}`;
}
