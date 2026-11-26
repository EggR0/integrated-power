import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {
  HubConfig,
  HubOverviewSnapshot,
  HubTodoItem,
  HubTodoStatus,
  TodoOriginChannel,
  ClarificationQuestion,
  CategoryPlaybook,
  EcosystemSnapshot,
} from "./index";
import type { IntegratedPowerBroker } from "../broker";
import type { ProviderId, TaskEnvelope, TaskEvent } from "../protocol";
import { resolvePlatformStateRoot } from "../platformPaths";
import { scanEcosystem } from "./ecosystemDiscovery";
import { HubConfigStore } from "./hubConfigStore";
import { PlaybookStore } from "./playbookStore";
import { TodoMarkdownSync } from "./todoMarkdownSync";

let _sharedHub: any;
function getSharedHub(): any {
  if (!_sharedHub) {
    try {
      _sharedHub = require(path.join(__dirname, "..", "shared-hub.js"));
    } catch {
      try {
        _sharedHub = require("../../../../shared/hub");
      } catch {
        _sharedHub = undefined;
      }
    }
  }
  return _sharedHub;
}

function normPct(val?: number): number {
  if (val === undefined || val === null || isNaN(val)) return 1.0;
  return val > 1 ? val / 100 : val;
}

export class HubController {
  private readonly stateRoot: string;
  private readonly todosFilePath: string;
  private readonly configStore: HubConfigStore;
  private readonly playbookStore: PlaybookStore;
  private readonly todoSync: TodoMarkdownSync;
  private readonly broker?: IntegratedPowerBroker;
  private todos: HubTodoItem[] = [];
  private lastEcosystem?: EcosystemSnapshot;

  public constructor(
    stateRoot?: string,
    broker?: IntegratedPowerBroker,
    configStore?: HubConfigStore,
    playbookStore?: PlaybookStore,
    todoSync?: TodoMarkdownSync
  ) {
    this.stateRoot = stateRoot ? path.resolve(stateRoot) : resolvePlatformStateRoot();
    this.todosFilePath = path.join(this.stateRoot, "hub-todos.json");
    this.broker = broker;
    this.configStore = configStore || new HubConfigStore(path.join(this.stateRoot, "hub-config.json"));
    this.playbookStore = playbookStore || new PlaybookStore(this.stateRoot);
    this.todoSync = todoSync || new TodoMarkdownSync();
    this.loadTodos();
  }

  public getConfigStore(): HubConfigStore {
    return this.configStore;
  }

  public getPlaybookStore(): PlaybookStore {
    return this.playbookStore;
  }

  public getTodoSync(): TodoMarkdownSync {
    return this.todoSync;
  }

  public updateConfig(partial: Partial<HubConfig>): HubConfig {
    return this.configStore.updateConfig(partial);
  }

  public savePlaybook(playbook: CategoryPlaybook): CategoryPlaybook {
    this.playbookStore.savePlaybook(playbook);
    return this.playbookStore.getPlaybook(playbook.category) || playbook;
  }

  public async syncTodos(): Promise<{ ok: boolean; todos: HubTodoItem[]; fileUpdated: boolean; activeFilePath: string }> {
    const config = this.configStore.getConfig();
    const activePath = config.customTodoFilePath
      ? path.resolve(config.customTodoFilePath)
      : (this.lastEcosystem?.activeTodoFilePath || path.join(this.stateRoot, "Todo.md"));

    const syncResult = this.todoSync.sync(activePath, this.todos, {
      playbookStore: this.playbookStore,
    });
    this.todos = syncResult.todos;
    this.saveTodos();
    return { ok: true, ...syncResult };
  }

  public getTodos(): HubTodoItem[] {
    return [...this.todos];
  }

  public getTodo(id: string): HubTodoItem | undefined {
    return this.todos.find((t) => t.id === id || t.blockId === id);
  }

  private loadTodos(): void {
    try {
      if (fs.existsSync(this.todosFilePath)) {
        const raw = fs.readFileSync(this.todosFilePath, "utf8");
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          this.todos = list;
          return;
        }
      }
    } catch {
      // Fall back to empty list on read error
    }
    this.todos = [];
  }

  private saveTodos(): void {
    try {
      const dir = path.dirname(this.todosFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.todosFilePath, JSON.stringify(this.todos, null, 2), "utf8");
    } catch (err) {
      throw new Error(`Failed to save hub todos to ${this.todosFilePath}: ${err}`);
    }
  }

  public async getOverview(forceRefresh?: boolean): Promise<HubOverviewSnapshot> {
    const config = this.configStore.getConfig();
    const ecosystem = await scanEcosystem(config, forceRefresh, undefined, undefined, this.stateRoot);
    this.lastEcosystem = ecosystem;

    const activeTodoPath = config.customTodoFilePath
      ? path.resolve(config.customTodoFilePath)
      : ecosystem.activeTodoFilePath;

    if (config.autoSyncMarkdown && activeTodoPath) {
      const syncResult = this.todoSync.sync(activeTodoPath, this.todos, {
        playbookStore: this.playbookStore,
      });
      this.todos = syncResult.todos;
      this.saveTodos();
    }

    return {
      schemaVersion: 1,
      config,
      ecosystem,
      todos: [...this.todos],
      playbooks: this.playbookStore.getPlaybooks(),
    };
  }

  public async ingestTodo(input: {
    text: string;
    originChannel?: TodoOriginChannel;
    categoryOverride?: string;
    allowManualCredit?: boolean;
  }): Promise<HubTodoItem> {
    const rawText = input.text.trim();
    if (!rawText) {
      throw new Error("Task text cannot be empty.");
    }

    const id = `todo-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const blockId = `tsk-${crypto.randomBytes(4).toString("hex")}`;
    const shared = getSharedHub();

    const category = input.categoryOverride || (shared?.inferCategory ? shared.inferCategory(rawText) : "general");
    const playbook = this.playbookStore.getPlaybook(category);

    let item: HubTodoItem;
    if (shared?.triageTodoItem) {
      item = shared.triageTodoItem(id, blockId, rawText, {
        originChannel: input.originChannel || "dashboard",
        playbook,
      });
    } else {
      const now = new Date().toISOString();
      item = {
        id,
        blockId,
        title: rawText.split("\n")[0].trim().substring(0, 80),
        rawText,
        status: "ready",
        domain: "core",
        privacyTier: "private_cloud",
        category,
        urgencyScore: 0.35,
        ambiguityScore: 0.2,
        clarificationQuestions: [],
        contextNotes: [],
        allowManualCredit: false,
        originChannel: input.originChannel || "dashboard",
        createdAt: now,
        updatedAt: now,
      };
    }

    if (input.categoryOverride) {
      item.category = input.categoryOverride;
    }
    if (input.allowManualCredit !== undefined) {
      item.allowManualCredit = input.allowManualCredit;
    }

    this.todos.unshift(item);
    this.saveTodos();

    const config = this.configStore.getConfig();
    if (config.autoSyncMarkdown) {
      const activePath = config.customTodoFilePath || this.lastEcosystem?.activeTodoFilePath || path.join(this.stateRoot, "Todo.md");
      const syncResult = this.todoSync.sync(activePath, this.todos, {
        playbookStore: this.playbookStore,
        direction: "push",
      });
      this.todos = syncResult.todos;
      this.saveTodos();
      const updated = this.todos.find((t) => t.id === id);
      if (updated) return updated;
    }

    return item;
  }

  public async clarifyTodo(
    id: string,
    clarification: {
      answers: ClarificationQuestion[];
      learnedPreference?: string;
      learnedRule?: string;
    }
  ): Promise<HubTodoItem> {
    const index = this.todos.findIndex((t) => t.id === id || t.blockId === id);
    if (index === -1) {
      throw new Error(`Todo not found: ${id}`);
    }
    let todo = this.todos[index];

    const answersSummary = clarification.answers
      .filter((q) => q.answer?.trim())
      .map((q) => `${q.question}: ${q.answer}`)
      .join("; ");

    this.playbookStore.extractPlaybookInsightsFromClarification(
      todo,
      answersSummary,
      clarification.learnedPreference,
      clarification.learnedRule
    );

    const playbook = this.playbookStore.getPlaybook(todo.category);
    const shared = getSharedHub();

    if (shared?.evaluateAmbiguity) {
      const result = shared.evaluateAmbiguity(todo.rawText, clarification.answers, playbook);
      todo = {
        ...todo,
        clarificationQuestions: result.questions,
        ambiguityScore: result.ambiguityScore,
        status: result.ambiguityScore < 0.4 ? "ready" : "needs_clarification",
        updatedAt: new Date().toISOString(),
      };
    } else {
      todo = {
        ...todo,
        clarificationQuestions: clarification.answers,
        ambiguityScore: 0.2,
        status: "ready",
        updatedAt: new Date().toISOString(),
      };
    }

    this.todos[index] = todo;
    this.saveTodos();

    const config = this.configStore.getConfig();
    if (config.autoSyncMarkdown) {
      const activePath = config.customTodoFilePath || this.lastEcosystem?.activeTodoFilePath || path.join(this.stateRoot, "Todo.md");
      const syncResult = this.todoSync.sync(activePath, this.todos, {
        playbookStore: this.playbookStore,
        direction: "push",
      });
      this.todos = syncResult.todos;
      this.saveTodos();
      const updated = this.todos.find((t) => t.id === todo.id);
      if (updated) return updated;
    }

    return todo;
  }

  public async dispatchTodo(
    id: string,
    options?: {
      preferredProvider?: ProviderId;
      tokenSnapshot?: any;
      executeNow?: boolean;
    }
  ): Promise<{ todo: HubTodoItem; task?: TaskEnvelope; delegationEvent?: TaskEvent }> {
    const index = this.todos.findIndex((t) => t.id === id || t.blockId === id);
    if (index === -1) {
      throw new Error(`Todo not found: ${id}`);
    }
    let todo = this.todos[index];

    // Guard 1: Reject if clarification is still required
    if (todo.status === "needs_clarification") {
      throw new Error("Task requires clarification before dispatch. Please answer pending clarification questions first.");
    }

    // Determine initial provider candidate
    let provider: ProviderId = options?.preferredProvider || "openai.codex.app";

    // Guard 2: Privacy Firewall (strictly_local MUST route to local engine)
    if (todo.privacyTier === "strictly_local") {
      provider = "local.openai-compatible";
    }

    // Guard 3: Manual GCP Credit Lock (Never route to agy without explicit user opt-in)
    if (provider.startsWith("google.antigravity") && !todo.allowManualCredit) {
      provider = "openai.codex.app";
    }

    // Guard 4: Quota & Cascading (<15% triggers cascade to alternate or local)
    if (options?.tokenSnapshot && provider !== "local.openai-compatible") {
      const getProviderQuota = (p: ProviderId): number => {
        if (p.startsWith("google.antigravity")) {
          return normPct(options.tokenSnapshot.antigravityPercentage ?? options.tokenSnapshot.antigravityWeeklyPercentage);
        }
        if (p === "openai.codex.app") {
          return normPct(options.tokenSnapshot.codexPercentage ?? options.tokenSnapshot.codexWeeklyPercentage);
        }
        return 1.0;
      };

      const currentQuota = getProviderQuota(provider);
      if (currentQuota < 0.15) {
        if (provider === "openai.codex.app") {
          const agyQuota = getProviderQuota("google.antigravity.ide");
          if (todo.privacyTier !== "strictly_local" && todo.allowManualCredit && agyQuota >= 0.15) {
            provider = "google.antigravity.ide";
          } else {
            provider = "local.openai-compatible";
          }
        } else if (provider.startsWith("google.antigravity")) {
          const codexQuota = getProviderQuota("openai.codex.app");
          if (todo.privacyTier !== "strictly_local" && codexQuota >= 0.15) {
            provider = "openai.codex.app";
          } else {
            provider = "local.openai-compatible";
          }
        }
      }
    }

    // Format category playbook context slice
    const playbook = this.playbookStore.getPlaybook(todo.category);
    let playbookSlice = "";
    if (playbook) {
      const parts: string[] = [];
      if (playbook.semantic.length > 0) {
        parts.push("Learned Preferences:\n" + playbook.semantic.map((s) => `- ${s.preference} (${s.rationale})`).join("\n"));
      }
      if (playbook.procedural.length > 0) {
        parts.push("Procedural Rules:\n" + playbook.procedural.map((p) => `- Trigger: ${p.trigger} => Rule: ${p.rule}`).join("\n"));
      }
      if (parts.length > 0) {
        playbookSlice = `\n\n--- [Playbook Context: ${playbook.label}] ---\n` + parts.join("\n\n");
      }
    }

    let task: TaskEnvelope | undefined;
    let delegationEvent: TaskEvent | undefined;

    if (this.broker) {
      task = await this.broker.createTask({
        title: todo.title,
        goal: todo.rawText + playbookSlice,
        originProvider: provider,
        recommendedProvider: provider,
        privacy: todo.privacyTier === "strictly_local" ? "local" : "private",
      });

      todo = {
        ...todo,
        linkedBrokerTaskId: task.id,
        assignedRoute: provider,
        status: "in_progress",
        updatedAt: new Date().toISOString(),
      };

      if (options?.executeNow) {
        delegationEvent = await this.broker.delegate({
          taskId: task.id,
          provider,
          prompt: task.goal,
          expectedRevision: task.revision,
        });
      }
    } else {
      todo = {
        ...todo,
        assignedRoute: provider,
        status: "in_progress",
        updatedAt: new Date().toISOString(),
      };
    }

    this.todos[index] = todo;
    this.saveTodos();

    const config = this.configStore.getConfig();
    if (config.autoSyncMarkdown) {
      const activePath = config.customTodoFilePath || this.lastEcosystem?.activeTodoFilePath || path.join(this.stateRoot, "Todo.md");
      const syncResult = this.todoSync.sync(activePath, this.todos, {
        playbookStore: this.playbookStore,
        direction: "push",
      });
      this.todos = syncResult.todos;
      this.saveTodos();
      const updated = this.todos.find((t) => t.id === todo.id);
      if (updated) {
        return { todo: updated, task, delegationEvent };
      }
    }

    return { todo, task, delegationEvent };
  }
}
