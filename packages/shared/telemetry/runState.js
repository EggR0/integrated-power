"use strict";

const ACTIVE_STATUSES = new Set([
  "active", "running", "in_progress", "in-progress", "working", "queued", "pending", "starting", "started",
]);

function parseRunJsonl(text, options = {}) {
  const errors = [];
  const latestById = new Map();
  String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let raw;
    try {
      raw = JSON.parse(trimmed);
      if (!isObject(raw)) {
        errors.push(`Line ${index + 1}: expected JSON object`);
        return;
      }
    } catch (error) {
      errors.push(`Line ${index + 1}: ${errorMessage(error)}`);
      return;
    }
    const run = normalizeRun(raw, index, options);
    const existing = latestById.get(run.id);
    latestById.set(run.id, existing ? mergeRun(existing, run, options) : run);
  });
  const runs = [...latestById.values()].sort(compareRuns).map(toRunSummary);
  return { runs, activeRuns: runs.filter((run) => run.active), artifacts: runs.flatMap((run) => run.artifacts), parseErrors: errors };
}

function normalizeRun(raw, index, options) {
  const id = stringValue(raw.id) ?? stringValue(raw.runId) ?? stringValue(raw.run_id) ?? stringValue(raw.threadId) ?? stringValue(raw.thread_id) ?? `run-${index + 1}`;
  const status = stringValue(raw.status) ?? stringValue(raw.state) ?? stringValue(raw.phase) ?? "unknown";
  const run = {
    id,
    title: titleFromRaw(raw, id),
    status,
    active: activeStatus(status, raw),
    startedAt: stringValue(raw.startedAt) ?? stringValue(raw.started_at) ?? stringValue(raw.createdAt) ?? stringValue(raw.created_at),
    updatedAt: stringValue(raw.updatedAt) ?? stringValue(raw.updated_at) ?? stringValue(raw.finishedAt) ?? stringValue(raw.finished_at) ?? stringValue(raw.completedAt) ?? stringValue(raw.completed_at),
    model: stringValue(raw.model),
    branch: stringValue(raw.branch),
    cwd: stringValue(raw.cwd) ?? stringValue(raw.workspace),
    summary: summaryFromRaw(raw),
    agentSurface: stringValue(raw.agentSurface) ?? stringValue(raw.agent_surface),
    kind: stringValue(raw.kind),
    contextFiles: stringArrayValue(raw.contextFiles ?? raw.context_files),
    artifacts: [],
    _raw: raw,
  };
  run.artifacts = collectArtifacts(raw, run, options);
  return run;
}

function mergeRun(base, delta, options) {
  const raw = { ...base._raw, ...delta._raw };
  const status = hasAnyString(delta._raw, ["status", "state", "phase"]) ? delta.status : base.status;
  const merged = {
    id: base.id,
    title: titleFromRaw(raw, base.title || delta.title || base.id),
    status,
    active: activeStatus(status, raw),
    startedAt: earliestTimestamp(base.startedAt, delta.startedAt) ?? base.startedAt ?? delta.startedAt,
    updatedAt: latestTimestamp(base.updatedAt, delta.updatedAt) ?? delta.updatedAt ?? base.updatedAt,
    model: delta.model ?? base.model,
    branch: delta.branch ?? base.branch,
    cwd: delta.cwd ?? base.cwd,
    summary: delta.summary ?? base.summary,
    agentSurface: delta.agentSurface ?? base.agentSurface,
    kind: delta.kind ?? base.kind,
    contextFiles: uniqueStrings([...base.contextFiles, ...delta.contextFiles]),
    artifacts: [],
    _raw: raw,
  };
  merged.artifacts = uniqueArtifacts([...base.artifacts, ...delta.artifacts, ...collectArtifacts(raw, merged, options)], merged);
  return merged;
}

function collectArtifacts(raw, run, options) {
  const candidates = [raw.artifacts, raw.artifact, raw.artifact_path, raw.artifactPath, raw.artifact_paths, raw.artifactPaths, raw.outputs, raw.output, raw.reports, raw.report, raw.files];
  const artifacts = [];
  for (const candidate of candidates) appendArtifacts(candidate, run, artifacts, options);
  return uniqueArtifacts(artifacts, run);
}

function appendArtifacts(value, run, target, options) {
  if (!value) return;
  if (typeof value === "string") {
    target.push(toArtifact(artifactLabel(value), normalizeArtifactPath(value, options), run, target.length));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendArtifacts(item, run, target, options);
    return;
  }
  if (!isObject(value)) return;
  const sourcePath = stringValue(value.path) ?? stringValue(value.file) ?? stringValue(value.filePath) ?? stringValue(value.file_path) ?? stringValue(value.artifact_path) ?? stringValue(value.artifactPath) ?? stringValue(value.uri) ?? stringValue(value.href);
  const label = stringValue(value.label) ?? stringValue(value.name) ?? stringValue(value.title) ?? sourcePath;
  if (label || sourcePath) target.push(toArtifact(label ?? sourcePath ?? "Artifact", sourcePath ? normalizeArtifactPath(sourcePath, options) : undefined, run, target.length, stringValue(value.type)));
}

function normalizeArtifactPath(value, options) {
  if (options.normalizeArtifactPath) return options.normalizeArtifactPath(value);
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || /^[A-Za-z]:\//.test(trimmed) || trimmed.split("/").includes("..") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return undefined;
  return trimmed.split("/").filter((part) => part && part !== ".").join("/");
}

function uniqueArtifacts(artifacts, run) {
  const unique = new Map();
  for (const artifact of artifacts) unique.set(`${artifact.workspacePath ?? artifact.label}:${artifact.type ?? ""}`, artifact);
  return [...unique.values()].map((artifact, index) => ({ ...artifact, id: `${run.id}-artifact-${index}`, runId: run.id, runTitle: run.title, canOpen: Boolean(artifact.workspacePath) }));
}

function toArtifact(label, workspacePath, run, index, type) {
  return { id: `${run.id}-artifact-${index}`, label, workspacePath, type, runId: run.id, runTitle: run.title, canOpen: Boolean(workspacePath) };
}

function toRunSummary(run) {
  const { _raw, ...summary } = run;
  return summary;
}

function activeStatus(status, raw) {
  if (raw.active === true || raw.isActive === true) return true;
  if (raw.active === false || raw.isActive === false) return false;
  return ACTIVE_STATUSES.has(status.toLowerCase());
}

function compareRuns(a, b) {
  const aTime = Date.parse(a.updatedAt ?? a.startedAt ?? "");
  const bTime = Date.parse(b.updatedAt ?? b.startedAt ?? "");
  if (Number.isFinite(aTime) && Number.isFinite(bTime)) return bTime - aTime;
  if (Number.isFinite(aTime)) return -1;
  if (Number.isFinite(bTime)) return 1;
  return a.title.localeCompare(b.title);
}

function titleFromRaw(raw, fallback) {
  return stringValue(raw.command_invoked) ?? stringValue(raw.commandInvoked) ?? stringValue(raw.title) ?? stringValue(raw.name) ?? stringValue(raw.task) ?? stringValue(raw.objective) ?? fallback;
}

function summaryFromRaw(raw) {
  return stringValue(raw.summary) ?? stringValue(raw.message) ?? stringValue(raw.lastMessage) ?? stringValue(raw.last_message) ?? stringValue(raw.error);
}

function latestTimestamp(first, second) {
  const a = Date.parse(first ?? "");
  const b = Date.parse(second ?? "");
  if (Number.isFinite(a) && Number.isFinite(b)) return b >= a ? second : first;
  return second ?? first;
}

function earliestTimestamp(first, second) {
  const a = Date.parse(first ?? "");
  const b = Date.parse(second ?? "");
  if (Number.isFinite(a) && Number.isFinite(b)) return b <= a ? second : first;
  return first ?? second;
}

function artifactLabel(value) {
  const parts = value.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : value;
}

function hasAnyString(raw, keys) { return keys.some((key) => stringValue(raw[key]) !== undefined); }
function stringArrayValue(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()));
}
function uniqueStrings(values) { return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))]; }
function stringValue(value) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }

function parseLocalLlmMetricsCsv(text) {
  const rows = parseCsvRecords(String(text ?? "").replace(/^\uFEFF/, ""));
  const parseErrors = rows.errors;
  if (!rows.records.length) return { metrics: [], parseErrors };
  const headers = rows.records[0].map((value) => value.trim());
  const read = (cells, name, fallbackIndex) => {
    const index = headers.indexOf(name);
    return index >= 0 ? (cells[index] ?? "") : fallbackIndex === undefined ? "" : (cells[fallbackIndex] ?? "");
  };
  const metrics = rows.records.slice(1).filter((cells) => cells.some((cell) => cell !== "")).map((cells, index) => {
    if (cells.length !== headers.length) parseErrors.push(`Row ${index + 2}: expected ${headers.length} columns, received ${cells.length}`);
    const number = (value) => { const result = Number.parseFloat(value); return Number.isFinite(result) ? result : 0; };
    const optionalNumber = (value) => { if (!value.trim()) return undefined; const result = Number.parseFloat(value); return Number.isFinite(result) ? result : undefined; };
    const boolean = (value) => /^(true|1|yes)$/i.test(value.trim()) ? true : /^(false|0|no)$/i.test(value.trim()) ? false : undefined;
    const metric = {
      timestamp: read(cells, "Timestamp", 0), taskTitle: read(cells, "TaskTitle", 1), model: read(cells, "Model", 2), taskScale: read(cells, "TaskScale", 3),
      actualElapsedSeconds: number(read(cells, "ActualElapsedSeconds", 4)), totalTokens: Math.trunc(number(read(cells, "TotalTokens", 5))),
    };
    const taskType = read(cells, "TaskType"); if (taskType) metric.taskType = taskType;
    const provider = read(cells, "Provider"); if (provider) metric.provider = provider;
    metric.success = boolean(read(cells, "Success"));
    metric.outputChars = optionalNumber(read(cells, "OutputChars"));
    metric.tokensPerSecond = optionalNumber(read(cells, "TokensPerSecond"));
    const selectedBy = read(cells, "SelectedBy"); if (selectedBy) metric.selectedBy = selectedBy;
    const selectionReason = read(cells, "SelectionReason"); if (selectionReason) metric.selectionReason = selectionReason;
    const errorMessageValue = read(cells, "ErrorMessage"); if (errorMessageValue) metric.errorMessage = errorMessageValue;
    return metric;
  });
  return { metrics, parseErrors };
}

function parseCsvRecords(text) {
  const records = [];
  const errors = [];
  let record = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
      continue;
    }
    if (afterQuote && char !== "," && char !== "\r" && char !== "\n" && char !== " " && char !== "\t") {
      errors.push(`CSV character after closing quote at offset ${i}`);
      afterQuote = false;
    }
    if (char === '"' && field === "") { quoted = true; continue; }
    if (char === ",") { record.push(field); field = ""; afterQuote = false; continue; }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field); records.push(record); record = []; field = ""; afterQuote = false; continue;
    }
    field += char;
  }
  if (quoted) errors.push("CSV ended inside a quoted field");
  if (field.length || record.length) { record.push(field); records.push(record); }
  return { records, errors };
}

module.exports = { parseRunJsonl, parseLocalLlmMetricsCsv };
