/**
 * External provider support — shared by the IDE webview and the control-center.
 *
 * Users can register a provider endpoint (self-hosted gateways, OpenAI usage
 * API, OpenRouter, local vLLM/LM Studio/Ollama/SGLang servers, ...). The
 * broker fetches URLs server-side (loopback origin), so browser CORS is not a
 * problem. Two facets are supported, mirroring the Hermes custom-endpoint
 * settings screen:
 *
 *   1. Quota windows — the endpoint returns JSON with remaining/used
 *      percentage fields (or absolute token pairs); parsed by
 *      parseExternalPayload.
 *   2. Model discovery — an OpenAI-compatible `GET /v1/models` (or Ollama
 *      `GET /api/tags`) lists the models the server can serve; parsed by
 *      parseModelList. The discovery pattern reuses the LM Studio / vLLM
 *      probe the IDE TokenManager already runs (same `data[].id` shape).
 *
 * No DOM or Node dependency.
 */

export interface ExternalWindowMetric {
  label: string;
  /** Remaining percentage 0..100. */
  percentage: number;
  /** Shared capacity tone for pill/tag coloring. */
  tone: string;
  /** True when the window exists but no remaining value was found. */
  unavailable: boolean;
  note?: string;
}

export interface ExternalProviderData {
  ok: boolean;
  name: string;
  windows: ExternalWindowMetric[];
  error?: string;
}

/** Parsed + validated user input for the provider form. */
export interface ExternalProviderSpec {
  id: string;
  name: string;
  /**
   * Base endpoint (Hermes "Endpoint URL"), e.g. `http://host:18082/v1`.
   * Model discovery is derived from it (`/models` or `/api/tags`).
   */
  baseUrl: string;
  /** Quota URL: absolute if the endpoint reports it (legacy `url` kept as-is), relative to baseUrl, or empty. */
  quotaUrl?: string;
  /** Bearer token sent as Authorization when probing (optional for local servers). */
  apiKey?: string;
  /** Preferred model shown first in the discovered list. */
  defaultModel?: string;
  /** Fetch `/models` (or `/api/tags`) alongside the quota poll. */
  discoverModels: boolean;
  /** Refresh cadence in milliseconds (clamped 10s..1h). */
  pollMs: number;
  enabled: boolean;
}

export const EXTERNAL_POLL_MIN_MS = 10_000;
export const EXTERNAL_POLL_MAX_MS = 60 * 60 * 1000;
export const EXTERNAL_FETCH_TIMEOUT_MS = 8_000;
/** Hard cap so a misconfigured URL cannot drag the broker down. */
export const EXTERNAL_FETCH_MAX_BYTES = 512 * 1024;
/** Discovery list is capped so a chatty /models response cannot bloat the card. */
export const EXTERNAL_MODELS_MAX = 50;

const REMAINING_KEYS = [
  "remainingPercentage",
  "remaining_percentage",
  "remainingPercent",
  "remaining_percent",
  "percentRemaining",
  "percent_remaining",
  "percentUsedIsComplement",
  "remaining",
  "pctRemaining",
  "pct_remaining",
] as const;

const USED_KEYS = [
  "usedPercentage",
  "used_percentage",
  "percentUsed",
  "percent_used",
  "usagePercent",
  "usage_percent",
] as const;

// Absolute-token pairs (a percentage is derived from them).
const LIMIT_KEYS = ["limit", "limitTokens", "limit_tokens", "max", "maxTokens", "max_tokens", "total", "totalTokens", "total_tokens"] as const;
const REMAINING_ABS_KEYS = ["remainingTokens", "remaining_tokens", "tokensRemaining", "tokens_remaining", "left", "leftTokens", "left_tokens", "availableTokens", "available_tokens"] as const;
const USED_ABS_KEYS = ["usedTokens", "used_tokens", "tokensUsed", "tokens_used", "used", "consumed", "consumedTokens", "consumed_tokens"] as const;

/**
 * Derive a remaining percentage from absolute token fields, e.g.
 * OpenAI's `limit_tokens`/`remaining_tokens` or a generic `limit`/`used`.
 * Explicit percentage fields always win — this is the fallback path.
 */
function tokenPairRemaining(raw: Record<string, unknown>): number | undefined {
  const limit = toFiniteNumber(raw[LIMIT_KEYS[0]] ?? raw["limitTokens"] ?? raw["limit_tokens"] ?? raw["max"] ?? raw["maxTokens"] ?? raw["max_tokens"] ?? raw["total"] ?? raw["totalTokens"] ?? raw["total_tokens"]);
  if (limit === undefined || limit <= 0) return undefined;
  for (const key of REMAINING_ABS_KEYS) {
    const value = toFiniteNumber(raw[key]);
    if (value !== undefined) return Math.min(100, Math.max(0, (value / limit) * 100));
  }
  for (const key of USED_ABS_KEYS) {
    const value = toFiniteNumber(raw[key]);
    if (value !== undefined) return Math.min(100, Math.max(0, ((limit - value) / limit) * 100));
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/%$/, "");
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractRemaining(raw: Record<string, unknown>): number | undefined {
  for (const key of REMAINING_KEYS) {
    const value = toFiniteNumber(raw[key]);
    if (value !== undefined) return value;
  }
  for (const key of USED_KEYS) {
    const value = toFiniteNumber(raw[key]);
    if (value !== undefined) return 100 - value;
  }
  return tokenPairRemaining(raw);
}

function labelOf(raw: Record<string, unknown>, index: number): string {
  for (const key of ["label", "name", "window", "period", "id"]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Window " + (index + 1);
}

function windowFrom(raw: unknown, index: number, toneOf: (pct: number) => string): ExternalWindowMetric | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const remaining = extractRemaining(obj);
  const label = labelOf(obj, index);
  const note = typeof obj["note"] === "string" ? obj["note"] : typeof obj["description"] === "string" ? obj["description"] : undefined;
  if (remaining === undefined) {
    return { label: label, percentage: 0, tone: "critical", unavailable: true, note: note || "remaining field not found" };
  }
  const percentage = Math.min(100, Math.max(0, remaining));
  return { label: label, percentage: percentage, tone: toneOf(percentage), unavailable: false, note: note };
}

/**
 * Parse an arbitrary external payload into window metrics.
 *
 * Accepted shapes (first match wins):
 *   - an array of window objects
 *   - an object with a "windows" array
 *   - a single window object (a remaining/used percentage field is present)
 *   - an object with per-window keys like fiveHour/weekly (each an object)
 *
 * Never throws — returns { ok:false, error } for unusable payloads.
 */
export function parseExternalPayload(name: string, raw: unknown, toneOf: (pct: number) => string = (p) => (p <= 15 ? "critical" : p <= 35 ? "warning" : "ok")): ExternalProviderData {
  if (raw === undefined || raw === null) {
    return { ok: false, name: name, windows: [], error: "empty response" };
  }
  if (typeof raw !== "object") {
    return { ok: false, name: name, windows: [], error: "payload is not a JSON object or array" };
  }

  let entries: unknown[] = [];
  if (Array.isArray(raw)) {
    entries = raw;
  } else {
    const obj = raw as Record<string, unknown>;
    const windows = obj["windows"];
    if (Array.isArray(windows) && windows.length > 0) {
      entries = windows;
    } else if (extractRemaining(obj) !== undefined) {
      entries = [obj];
    } else {
      const candidates: unknown[] = [];
      for (const value of Object.values(obj)) {
        if (value && typeof value === "object" && extractRemaining(value as Record<string, unknown>) !== undefined) {
          candidates.push(value);
        }
      }
      if (candidates.length > 0) entries = candidates;
    }
  }
  if (entries.length === 0) {
    return { ok: false, name: name, windows: [], error: "no quota windows found (needs a remaining/used percentage field)" };
  }

  const windows: ExternalWindowMetric[] = [];
  entries.forEach((entry, index) => {
    const metric = windowFrom(entry, index + 1, toneOf);
    if (metric) windows.push(metric);
  });
  if (windows.length === 0) {
    return { ok: false, name: name, windows: [], error: "no quota windows found" };
  }
  return { ok: true, name: name, windows: windows };
}

/**
 * Derive the model-discovery URL(s) from a provider base endpoint, matching
 * the probe pattern the IDE TokenManager already runs for LM Studio / vLLM:
 * OpenAI-compatible servers answer `GET {base}/models` with
 * `{ data: [{ id }] }`; Ollama answers `GET /api/tags` with
 * `{ models: [{ name }] }`. A base ending in `/v1` gets `/models` appended;
 * a bare host gets both candidates. Pure.
 */
export function modelDiscoveryUrls(baseUrl: string): string[] {
  try {
    const parsed = new URL(baseUrl);
    const root = parsed.toString().replace(/\/+$/, "");
    if (/\/v1$/.test(parsed.pathname.replace(/\/+$/, ""))) return [`${root}/models`];
    const openai = `${root}/v1/models`;
    const ollama = `${root}/api/tags`;
    return openai === ollama ? [openai] : [openai, ollama];
  } catch {
    return [];
  }
}

/**
 * Parse an OpenAI-compatible models payload (`{ data: [{ id }] }`) or an
 * Ollama tags payload (`{ models: [{ name }] }`) into model names. The
 * `id`/`name` extraction mirrors TokenManager's LM Studio / vLLM probes.
 * Returns `[]` when the payload is not a model list.
 */
export function parseModelList(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const list = obj["data"] ?? obj["models"];
  if (!Array.isArray(list)) return [];
  const names: string[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e["id"] === "string" && e["id"].trim() ? e["id"].trim() : undefined;
    const name = typeof e["name"] === "string" && e["name"].trim() ? e["name"].trim() : undefined;
    const model = id || name;
    if (model && !names.includes(model)) names.push(model);
  }
  return names.slice(0, EXTERNAL_MODELS_MAX);
}

/**
 * Validate the provider form. Backwards compatible: a bare `url` (absolute)
 * is treated as both the base endpoint and the quota URL — so existing
 * registered providers keep working unchanged.
 */
export function validateExternalProvider(input: {
  name: string;
  url?: string;
  baseUrl?: string;
  quotaUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  discoverModels?: boolean;
  pollMs?: number;
  id?: string;
  enabled?: boolean;
}): { spec?: ExternalProviderSpec; error?: string } {
  const name = (input.name || "").trim();
  if (!name) return { error: "provider name is required" };

  const baseText = (input.baseUrl ?? input.url ?? "").trim();
  if (!baseText) return { error: "provider endpoint URL is required" };
  let base: URL;
  try {
    base = new URL(baseText);
  } catch {
    return { error: "invalid endpoint URL (must start with http:// or https://)" };
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { error: "only http/https URLs are supported" };
  }

  // Quota URL: absolute as given, relative resolved against the base, or
  // legacy (url === the quota source) where it doubles as the base.
  const quotaText = (input.quotaUrl ?? "").trim();
  let quotaUrl: string | undefined;
  if (quotaText) {
    try {
      const resolved = new URL(quotaText, base.toString());
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        return { error: "quota URL must be http/https" };
      }
      quotaUrl = resolved.toString();
    } catch {
      return { error: "invalid quota URL" };
    }
  } else if (!input.baseUrl) {
    // Legacy form: the single URL is the quota source itself.
    quotaUrl = base.toString();
  }

  const requested = input.pollMs !== undefined ? Math.round(input.pollMs) : 60_000;
  const pollMs = Math.min(EXTERNAL_POLL_MAX_MS, Math.max(EXTERNAL_POLL_MIN_MS, Number.isFinite(requested) ? requested : 60_000));
  const rawId = input.id || "ext-" + Date.now().toString(36);
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "ext-" + Date.now().toString(36);
  const key = (input.apiKey ?? "").trim();
  const defaultModel = (input.defaultModel ?? "").trim();
  return {
    spec: {
      id: id,
      name: name,
      baseUrl: base.toString(),
      quotaUrl: quotaUrl,
      apiKey: key || undefined,
      defaultModel: defaultModel || undefined,
      discoverModels: input.discoverModels !== false,
      pollMs: pollMs,
      enabled: input.enabled !== false,
    },
  };
}
