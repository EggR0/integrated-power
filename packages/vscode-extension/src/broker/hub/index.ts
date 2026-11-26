/**
 * Canonical Hub Module for Integrated Power Broker.
 * Provides ecosystem discovery, persistent config, category playbooks,
 * bidirectional Markdown sync, and hub orchestration controller.
 */

export type LifeDomain = "private" | "relations" | "incubate" | "collab" | "core";

export type PrivacyTier =
  | "strictly_local"
  | "redacted_cloud"
  | "private_cloud"
  | "workspace_scoped";

export type ConnectorCategory =
  | "messenger"
  | "harness"
  | "local_llm"
  | "knowledge_vault"
  | "document_media";

export type ConnectorState =
  | "ready"
  | "installed_offline"
  | "installed_unconfigured"
  | "not_installed";

export type ConnectorProtocol =
  | "acp"
  | "mcp"
  | "openai-v1"
  | "rest"
  | "cli"
  | "plugin";

export interface EcosystemConnectorStatus {
  id: string;
  label: string;
  category: ConnectorCategory;
  state: ConnectorState;
  protocol: ConnectorProtocol;
  endpoint?: string;
  detectedPath?: string;
  version?: string;
  details?: string;
  installHint?: string;
  enabled: boolean;
}

export type VaultSource = "user_config" | "obsidian_registry" | "portable_default";

export interface VaultDiscoveryInfo {
  path: string;
  name: string;
  source: VaultSource;
  installedPlugins: string[];
  enabledPlugins: string[];
}

export interface EcosystemSnapshot {
  scannedAt: string;
  platform: string;
  connectors: EcosystemConnectorStatus[];
  vaults: VaultDiscoveryInfo[];
  activeTodoFilePath: string;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  options?: string[];
  answer?: string;
  answeredAt?: string;
}

export type HubTodoStatus =
  | "needs_clarification"
  | "ready"
  | "in_progress"
  | "awaiting_approval"
  | "done";

export type TodoOriginChannel =
  | "dashboard"
  | "markdown"
  | "openclaw"
  | "mcp"
  | "api";

export interface HubTodoItem {
  id: string;
  blockId: string;
  title: string;
  rawText: string;
  status: HubTodoStatus;
  domain: LifeDomain;
  privacyTier: PrivacyTier;
  category: string;
  urgencyScore: number;
  ambiguityScore: number;
  clarificationQuestions: ClarificationQuestion[];
  contextNotes: string[];
  allowManualCredit: boolean;
  linkedBrokerTaskId?: string;
  assignedRoute?: string;
  originChannel: TodoOriginChannel;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodicMemoryItem {
  id: string;
  summary: string;
  recordedAt: string;
}

export interface SemanticMemoryItem {
  id: string;
  preference: string;
  rationale: string;
  recordedAt: string;
}

export interface ProceduralMemoryItem {
  id: string;
  trigger: string;
  rule: string;
  recordedAt: string;
}

export interface CategoryPlaybook {
  category: string;
  label: string;
  episodic: EpisodicMemoryItem[];
  semantic: SemanticMemoryItem[];
  procedural: ProceduralMemoryItem[];
  updatedAt: string;
}

export interface HubConfig {
  customVaultPath?: string;
  customTodoFilePath?: string;
  disabledConnectors?: string[];
  autoSyncMarkdown: boolean;
}

export interface HubOverviewSnapshot {
  schemaVersion: 1;
  config: HubConfig;
  ecosystem: EcosystemSnapshot;
  todos: HubTodoItem[];
  playbooks: CategoryPlaybook[];
}

export * from "./ecosystemDiscovery";
export * from "./hubConfigStore";
export * from "./playbookStore";
export * from "./todoMarkdownSync";
export * from "./hubController";
