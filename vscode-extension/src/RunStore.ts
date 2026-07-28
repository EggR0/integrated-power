import * as path from "path";
import * as vscode from "vscode";
import { ArtifactRef, JsonObject, RunSummary } from "./types";

export interface RunStoreReadOptions {
  normalizeArtifactPath?: (value: string) => string | undefined;
}

export interface RunStoreData {
  runs: RunSummary[];
  activeRuns: RunSummary[];
  artifacts: ArtifactRef[];
  parseErrors: string[];
}

interface StoredRun extends RunSummary {
  raw: JsonObject;
}

export class RunStore {
  public async readRuns(
    fileUri: vscode.Uri | undefined,
    options: RunStoreReadOptions = {},
  ): Promise<RunStoreData> {
    if (!fileUri) {
      return this.emptyData();
    }

    const text = await this.readJsonlFile(fileUri);
    if (text === undefined) {
      return this.emptyData();
    }

    const parseErrors: string[] = [];
    const latestById = new Map<string, StoredRun>();

    text.split(/\r?\n/).forEach((line, index) => {
      const parsed = this.parseJsonlLine(line, index, parseErrors);
      if (!parsed) {
        return;
      }

      const run = this.normalizeRun(parsed, index, options);
      const existing = latestById.get(run.id);
      latestById.set(run.id, existing ? this.mergeRun(existing, run, options) : run);
    });

    const runs = Array.from(latestById.values())
      .map((run) => this.toRunSummary(run))
      .sort(this.compareRuns);
    const artifacts = runs.flatMap((run) => run.artifacts);

    return {
      runs,
      activeRuns: runs.filter((run) => run.active),
      artifacts,
      parseErrors,
    };
  }

  private async readJsonlFile(fileUri: vscode.Uri): Promise<string | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      return Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "");
    } catch (error) {
      if (this.isFileNotFound(error)) {
        return undefined;
      }

      throw error;
    }
  }

  private parseJsonlLine(
    line: string,
    index: number,
    parseErrors: string[],
  ): JsonObject | undefined {
    const trimmed = line.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const value = JSON.parse(trimmed) as unknown;
      if (!this.isObject(value)) {
        parseErrors.push(`Line ${index + 1}: expected JSON object`);
        return undefined;
      }

      return value;
    } catch (error) {
      parseErrors.push(`Line ${index + 1}: ${this.errorMessage(error)}`);
      return undefined;
    }
  }

  private normalizeRun(
    raw: JsonObject,
    index: number,
    options: RunStoreReadOptions,
  ): StoredRun {
    const id = this.stringValue(raw.id)
      ?? this.stringValue(raw.runId)
      ?? this.stringValue(raw.run_id)
      ?? this.stringValue(raw.threadId)
      ?? this.stringValue(raw.thread_id)
      ?? `run-${index + 1}`;

    const status = this.stringValue(raw.status)
      ?? this.stringValue(raw.state)
      ?? this.stringValue(raw.phase)
      ?? "unknown";

    const title = this.titleFromRaw(raw, id);
    const run: StoredRun = {
      id,
      title,
      status,
      active: this.isActiveStatus(status, raw),
      startedAt: this.stringValue(raw.startedAt)
        ?? this.stringValue(raw.started_at)
        ?? this.stringValue(raw.createdAt)
        ?? this.stringValue(raw.created_at),
      updatedAt: this.stringValue(raw.updatedAt)
        ?? this.stringValue(raw.updated_at)
        ?? this.stringValue(raw.finishedAt)
        ?? this.stringValue(raw.finished_at)
        ?? this.stringValue(raw.completedAt)
        ?? this.stringValue(raw.completed_at),
      model: this.stringValue(raw.model),
      branch: this.stringValue(raw.branch),
      cwd: this.stringValue(raw.cwd) ?? this.stringValue(raw.workspace),
      summary: this.summaryFromRaw(raw),
      agentSurface: this.stringValue(raw.agentSurface) ?? this.stringValue(raw.agent_surface),
      kind: this.stringValue(raw.kind),
      contextFiles: this.stringArrayValue(raw.contextFiles ?? raw.context_files),
      artifacts: [],
      raw,
    };

    run.artifacts = this.collectArtifacts(raw, run, options);
    return run;
  }

  private mergeRun(
    base: StoredRun,
    delta: StoredRun,
    options: RunStoreReadOptions,
  ): StoredRun {
    const raw = { ...base.raw, ...delta.raw };
    const status = this.hasAnyString(delta.raw, ["status", "state", "phase"])
      ? delta.status
      : base.status;
    const title = this.titleFromRaw(raw, base.title || delta.title || base.id);

    const merged: StoredRun = {
      id: base.id,
      title,
      status,
      active: this.isActiveStatus(status, raw),
      startedAt: this.earliestTimestamp(base.startedAt, delta.startedAt)
        ?? base.startedAt
        ?? delta.startedAt,
      updatedAt: this.latestTimestamp(base.updatedAt, delta.updatedAt)
        ?? delta.updatedAt
        ?? base.updatedAt,
      model: delta.model ?? base.model,
      branch: delta.branch ?? base.branch,
      cwd: delta.cwd ?? base.cwd,
      summary: delta.summary ?? base.summary,
      agentSurface: delta.agentSurface ?? base.agentSurface,
      kind: delta.kind ?? base.kind,
      contextFiles: this.uniqueStrings([...base.contextFiles, ...delta.contextFiles]),
      artifacts: [],
      raw,
    };

    merged.artifacts = this.uniqueArtifacts(
      [...base.artifacts, ...delta.artifacts, ...this.collectArtifacts(raw, merged, options)],
      merged,
    );
    return merged;
  }

  private collectArtifacts(
    raw: JsonObject,
    run: Omit<RunSummary, "artifacts">,
    options: RunStoreReadOptions,
  ): ArtifactRef[] {
    const candidates = [
      raw.artifacts,
      raw.artifact,
      raw.artifact_path,
      raw.artifactPath,
      raw.artifact_paths,
      raw.artifactPaths,
      raw.outputs,
      raw.output,
      raw.reports,
      raw.report,
      raw.files,
    ];

    const artifacts: ArtifactRef[] = [];
    for (const candidate of candidates) {
      this.appendArtifacts(candidate, run, artifacts, options);
    }

    return this.uniqueArtifacts(artifacts, run);
  }

  private appendArtifacts(
    value: unknown,
    run: Omit<RunSummary, "artifacts">,
    target: ArtifactRef[],
    options: RunStoreReadOptions,
  ): void {
    if (!value) {
      return;
    }

    if (typeof value === "string") {
      const workspacePath = this.normalizeArtifactPath(value, options);
      target.push(this.toArtifact(this.artifactLabel(value), workspacePath, run, target.length));
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.appendArtifacts(item, run, target, options);
      }
      return;
    }

    if (!this.isObject(value)) {
      return;
    }

    const sourcePath = this.stringValue(value.path)
      ?? this.stringValue(value.file)
      ?? this.stringValue(value.filePath)
      ?? this.stringValue(value.file_path)
      ?? this.stringValue(value.artifact_path)
      ?? this.stringValue(value.artifactPath)
      ?? this.stringValue(value.uri)
      ?? this.stringValue(value.href);

    const label = this.stringValue(value.label)
      ?? this.stringValue(value.name)
      ?? this.stringValue(value.title)
      ?? sourcePath;

    if (label || sourcePath) {
      target.push(
        this.toArtifact(
          label ?? sourcePath ?? "Artifact",
          sourcePath ? this.normalizeArtifactPath(sourcePath, options) : undefined,
          run,
          target.length,
          this.stringValue(value.type),
        ),
      );
    }
  }

  private normalizeArtifactPath(
    value: string,
    options: RunStoreReadOptions,
  ): string | undefined {
    if (options.normalizeArtifactPath) {
      return options.normalizeArtifactPath(value);
    }

    return this.safeRelativeArtifactPath(value);
  }

  private safeRelativeArtifactPath(value: string): string | undefined {
    const trimmed = value.trim();
    if (
      !trimmed ||
      path.isAbsolute(trimmed) ||
      trimmed.startsWith("\\\\") ||
      trimmed.startsWith("//") ||
      this.hasUnsupportedScheme(trimmed) ||
      trimmed.split(/[\\/]+/).includes("..")
    ) {
      return undefined;
    }

    return path.normalize(trimmed).split(path.sep).join("/");
  }

  private uniqueArtifacts(
    artifacts: ArtifactRef[],
    run: Omit<RunSummary, "artifacts">,
  ): ArtifactRef[] {
    const unique = new Map<string, ArtifactRef>();
    for (const artifact of artifacts) {
      const key = `${artifact.workspacePath ?? artifact.label}:${artifact.type ?? ""}`;
      unique.set(key, artifact);
    }

    return Array.from(unique.values()).map((artifact, index) => ({
      ...artifact,
      id: `${run.id}-artifact-${index}`,
      runId: run.id,
      runTitle: run.title,
      canOpen: Boolean(artifact.workspacePath),
    }));
  }

  private toArtifact(
    label: string,
    workspacePath: string | undefined,
    run: Omit<RunSummary, "artifacts">,
    index: number,
    type?: string,
  ): ArtifactRef {
    return {
      id: `${run.id}-artifact-${index}`,
      label,
      workspacePath,
      type,
      runId: run.id,
      runTitle: run.title,
      canOpen: Boolean(workspacePath),
    };
  }

  private toRunSummary(run: StoredRun): RunSummary {
    return {
      id: run.id,
      title: run.title,
      status: run.status,
      active: run.active,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      model: run.model,
      branch: run.branch,
      cwd: run.cwd,
      summary: run.summary,
      agentSurface: run.agentSurface,
      kind: run.kind,
      contextFiles: run.contextFiles,
      artifacts: run.artifacts,
    };
  }

  private isActiveStatus(status: string, raw: JsonObject): boolean {
    if (raw.active === true || raw.isActive === true) {
      return true;
    }

    if (raw.active === false || raw.isActive === false) {
      return false;
    }

    const normalized = status.toLowerCase();
    return [
      "active",
      "running",
      "in_progress",
      "in-progress",
      "working",
      "queued",
      "pending",
      "starting",
      "started",
    ].includes(normalized);
  }

  private compareRuns(a: RunSummary, b: RunSummary): number {
    const aTime = Date.parse(a.updatedAt ?? a.startedAt ?? "");
    const bTime = Date.parse(b.updatedAt ?? b.startedAt ?? "");

    if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
      return bTime - aTime;
    }

    if (Number.isFinite(aTime)) {
      return -1;
    }

    if (Number.isFinite(bTime)) {
      return 1;
    }

    return a.title.localeCompare(b.title);
  }

  private titleFromRaw(raw: JsonObject, fallback: string): string {
    return this.stringValue(raw.command_invoked)
      ?? this.stringValue(raw.commandInvoked)
      ?? this.stringValue(raw.title)
      ?? this.stringValue(raw.name)
      ?? this.stringValue(raw.task)
      ?? this.stringValue(raw.objective)
      ?? fallback;
  }

  private summaryFromRaw(raw: JsonObject): string | undefined {
    return this.stringValue(raw.summary)
      ?? this.stringValue(raw.message)
      ?? this.stringValue(raw.lastMessage)
      ?? this.stringValue(raw.last_message)
      ?? this.stringValue(raw.error);
  }

  private latestTimestamp(first: string | undefined, second: string | undefined): string | undefined {
    const firstTime = Date.parse(first ?? "");
    const secondTime = Date.parse(second ?? "");

    if (Number.isFinite(firstTime) && Number.isFinite(secondTime)) {
      return secondTime >= firstTime ? second : first;
    }

    return second ?? first;
  }

  private earliestTimestamp(first: string | undefined, second: string | undefined): string | undefined {
    const firstTime = Date.parse(first ?? "");
    const secondTime = Date.parse(second ?? "");

    if (Number.isFinite(firstTime) && Number.isFinite(secondTime)) {
      return secondTime <= firstTime ? second : first;
    }

    return first ?? second;
  }

  private artifactLabel(value: string): string {
    const parts = value.split(/[\\/]+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : value;
  }

  private hasAnyString(raw: JsonObject, keys: string[]): boolean {
    return keys.some((key) => this.stringValue(raw[key]) !== undefined);
  }

  private stringArrayValue(value: unknown): string[] {
    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }

    if (!Array.isArray(value)) {
      return [];
    }

    return this.uniqueStrings(
      value.flatMap((item) => {
        if (typeof item === "string" && item.trim()) {
          return [item.trim()];
        }

        return [];
      }),
    );
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.trim()).map((value) => value.trim())));
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private isObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private hasUnsupportedScheme(value: string): boolean {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value);
  }

  private isFileNotFound(error: unknown): boolean {
    return /file.*not.*found|enoent/i.test(this.errorMessage(error));
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private emptyData(): RunStoreData {
    return { runs: [], activeRuns: [], artifacts: [], parseErrors: [] };
  }
}
