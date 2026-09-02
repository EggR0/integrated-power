var IPQuota = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // shared/quota/index.ts
  var index_exports = {};
  __export(index_exports, {
    DEFAULT_POLL_INTERVAL_MS: () => DEFAULT_POLL_INTERVAL_MS,
    EXTERNAL_FETCH_MAX_BYTES: () => EXTERNAL_FETCH_MAX_BYTES,
    EXTERNAL_FETCH_TIMEOUT_MS: () => EXTERNAL_FETCH_TIMEOUT_MS,
    EXTERNAL_MODELS_MAX: () => EXTERNAL_MODELS_MAX,
    EXTERNAL_POLL_MAX_MS: () => EXTERNAL_POLL_MAX_MS,
    EXTERNAL_POLL_MIN_MS: () => EXTERNAL_POLL_MIN_MS,
    K_CAPACITY_RATIOS: () => K_CAPACITY_RATIOS,
    K_DEFAULT_RATIO: () => K_DEFAULT_RATIO,
    MAX_POLL_INTERVAL_MS: () => MAX_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS: () => MIN_POLL_INTERVAL_MS,
    QUOTA_SETTINGS_DEFAULTS: () => QUOTA_SETTINGS_DEFAULTS,
    absoluteTokenText: () => absoluteTokenText,
    buildTokenMetric: () => buildTokenMetric,
    calculateCapacitySummary: () => calculateCapacitySummary,
    calculateEffective5HourQuota: () => calculateEffective5HourQuota,
    capacitySummaryEntry: () => capacitySummaryEntry,
    capacityTone: () => capacityTone,
    clamp: () => clamp,
    clampPollInterval: () => clampPollInterval,
    formatNumber: () => formatNumber,
    formatRefreshCountdown: () => formatRefreshCountdown,
    formatResetTime: () => formatResetTime,
    formatTokenCount: () => formatTokenCount,
    localLoadedModelLabel: () => localLoadedModelLabel,
    localServerBadge: () => localServerBadge,
    mergeQuotaSettings: () => mergeQuotaSettings,
    modelDiscoveryUrls: () => modelDiscoveryUrls,
    parseExternalPayload: () => parseExternalPayload,
    parseModelList: () => parseModelList,
    toFiniteNumber: () => toFiniteNumber,
    validateExternalProvider: () => validateExternalProvider
  });

  // shared/quota/capacity.ts
  var K_CAPACITY_RATIOS = Object.freeze({
    opus: 4.5,
    antigravity: 5,
    codex: 4,
    claude: 4.5
  });
  var K_DEFAULT_RATIO = 4.5;
  function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }
  function clamp(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : min;
  }
  function capacityTone(percentage) {
    return percentage <= 15 ? "critical" : percentage <= 35 ? "warning" : "healthy";
  }
  function calculateEffective5HourQuota(fiveHourPct, weeklyPct, prefix) {
    const modelKey = prefix.toLowerCase().replace(/weekly/i, "");
    const K = K_CAPACITY_RATIOS[modelKey] ?? K_DEFAULT_RATIO;
    if (weeklyPct === 0) {
      return {
        effectivePct: 0,
        isWeeklyExhausted: true,
        isWeeklyCapped: true,
        K
      };
    }
    if (typeof weeklyPct === "number" && Number.isFinite(weeklyPct)) {
      const weeklyCeiling = weeklyPct * K;
      if (weeklyCeiling < fiveHourPct) {
        return {
          effectivePct: clamp(weeklyCeiling, 0, 100),
          isWeeklyExhausted: false,
          isWeeklyCapped: true,
          K
        };
      }
    }
    return {
      effectivePct: fiveHourPct,
      isWeeklyExhausted: false,
      isWeeklyCapped: false,
      K
    };
  }

  // shared/quota/external.ts
  var EXTERNAL_POLL_MIN_MS = 1e4;
  var EXTERNAL_POLL_MAX_MS = 60 * 60 * 1e3;
  var EXTERNAL_FETCH_TIMEOUT_MS = 8e3;
  var EXTERNAL_FETCH_MAX_BYTES = 512 * 1024;
  var EXTERNAL_MODELS_MAX = 50;
  var REMAINING_KEYS = [
    "remainingPercentage",
    "remaining_percentage",
    "remainingPercent",
    "remaining_percent",
    "percentRemaining",
    "percent_remaining",
    "percentUsedIsComplement",
    "remaining",
    "pctRemaining",
    "pct_remaining"
  ];
  var USED_KEYS = [
    "usedPercentage",
    "used_percentage",
    "percentUsed",
    "percent_used",
    "usagePercent",
    "usage_percent"
  ];
  var LIMIT_KEYS = ["limit", "limitTokens", "limit_tokens", "max", "maxTokens", "max_tokens", "total", "totalTokens", "total_tokens"];
  var REMAINING_ABS_KEYS = ["remainingTokens", "remaining_tokens", "tokensRemaining", "tokens_remaining", "left", "leftTokens", "left_tokens", "availableTokens", "available_tokens"];
  var USED_ABS_KEYS = ["usedTokens", "used_tokens", "tokensUsed", "tokens_used", "used", "consumed", "consumedTokens", "consumed_tokens"];
  function tokenPairRemaining(raw) {
    const limit = toFiniteNumber2(raw[LIMIT_KEYS[0]] ?? raw["limitTokens"] ?? raw["limit_tokens"] ?? raw["max"] ?? raw["maxTokens"] ?? raw["max_tokens"] ?? raw["total"] ?? raw["totalTokens"] ?? raw["total_tokens"]);
    if (limit === void 0 || limit <= 0) return void 0;
    for (const key of REMAINING_ABS_KEYS) {
      const value = toFiniteNumber2(raw[key]);
      if (value !== void 0) return Math.min(100, Math.max(0, value / limit * 100));
    }
    for (const key of USED_ABS_KEYS) {
      const value = toFiniteNumber2(raw[key]);
      if (value !== void 0) return Math.min(100, Math.max(0, (limit - value) / limit * 100));
    }
    return void 0;
  }
  function toFiniteNumber2(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const trimmed = value.trim().replace(/%$/, "");
      if (!trimmed) return void 0;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : void 0;
    }
    return void 0;
  }
  function extractRemaining(raw) {
    for (const key of REMAINING_KEYS) {
      const value = toFiniteNumber2(raw[key]);
      if (value !== void 0) return value;
    }
    for (const key of USED_KEYS) {
      const value = toFiniteNumber2(raw[key]);
      if (value !== void 0) return 100 - value;
    }
    return tokenPairRemaining(raw);
  }
  function labelOf(raw, index) {
    for (const key of ["label", "name", "window", "period", "id"]) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "Window " + (index + 1);
  }
  function windowFrom(raw, index, toneOf) {
    if (raw === null || typeof raw !== "object") return null;
    const obj = raw;
    const remaining = extractRemaining(obj);
    const label = labelOf(obj, index);
    const note = typeof obj["note"] === "string" ? obj["note"] : typeof obj["description"] === "string" ? obj["description"] : void 0;
    if (remaining === void 0) {
      return { label, percentage: 0, tone: "critical", unavailable: true, note: note || "remaining field not found" };
    }
    const percentage = Math.min(100, Math.max(0, remaining));
    return { label, percentage, tone: toneOf(percentage), unavailable: false, note };
  }
  function parseExternalPayload(name, raw, toneOf = (p) => p <= 15 ? "critical" : p <= 35 ? "warning" : "ok") {
    if (raw === void 0 || raw === null) {
      return { ok: false, name, windows: [], error: "empty response" };
    }
    if (typeof raw !== "object") {
      return { ok: false, name, windows: [], error: "payload is not a JSON object or array" };
    }
    let entries = [];
    if (Array.isArray(raw)) {
      entries = raw;
    } else {
      const obj = raw;
      const windows2 = obj["windows"];
      if (Array.isArray(windows2) && windows2.length > 0) {
        entries = windows2;
      } else if (extractRemaining(obj) !== void 0) {
        entries = [obj];
      } else {
        const candidates = [];
        for (const value of Object.values(obj)) {
          if (value && typeof value === "object" && extractRemaining(value) !== void 0) {
            candidates.push(value);
          }
        }
        if (candidates.length > 0) entries = candidates;
      }
    }
    if (entries.length === 0) {
      return { ok: false, name, windows: [], error: "no quota windows found (needs a remaining/used percentage field)" };
    }
    const windows = [];
    entries.forEach((entry, index) => {
      const metric = windowFrom(entry, index + 1, toneOf);
      if (metric) windows.push(metric);
    });
    if (windows.length === 0) {
      return { ok: false, name, windows: [], error: "no quota windows found" };
    }
    return { ok: true, name, windows };
  }
  function modelDiscoveryUrls(baseUrl) {
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
  function parseModelList(raw) {
    if (raw === null || typeof raw !== "object") return [];
    const obj = raw;
    const list = obj["data"] ?? obj["models"];
    if (!Array.isArray(list)) return [];
    const names = [];
    for (const entry of list) {
      if (entry === null || typeof entry !== "object") continue;
      const e = entry;
      const id = typeof e["id"] === "string" && e["id"].trim() ? e["id"].trim() : void 0;
      const name = typeof e["name"] === "string" && e["name"].trim() ? e["name"].trim() : void 0;
      const model = id || name;
      if (model && !names.includes(model)) names.push(model);
    }
    return names.slice(0, EXTERNAL_MODELS_MAX);
  }
  function validateExternalProvider(input) {
    const name = (input.name || "").trim();
    if (!name) return { error: "provider name is required" };
    const baseText = (input.baseUrl ?? input.url ?? "").trim();
    if (!baseText) return { error: "provider endpoint URL is required" };
    let base;
    try {
      base = new URL(baseText);
    } catch {
      return { error: "invalid endpoint URL (must start with http:// or https://)" };
    }
    if (base.protocol !== "http:" && base.protocol !== "https:") {
      return { error: "only http/https URLs are supported" };
    }
    const quotaText = (input.quotaUrl ?? "").trim();
    let quotaUrl;
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
      quotaUrl = base.toString();
    }
    const requested = input.pollMs !== void 0 ? Math.round(input.pollMs) : 6e4;
    const pollMs = Math.min(EXTERNAL_POLL_MAX_MS, Math.max(EXTERNAL_POLL_MIN_MS, Number.isFinite(requested) ? requested : 6e4));
    const rawId = input.id || "ext-" + Date.now().toString(36);
    const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "ext-" + Date.now().toString(36);
    const key = (input.apiKey ?? "").trim();
    const defaultModel = (input.defaultModel ?? "").trim();
    return {
      spec: {
        id,
        name,
        baseUrl: base.toString(),
        quotaUrl,
        apiKey: key || void 0,
        defaultModel: defaultModel || void 0,
        discoverModels: input.discoverModels !== false,
        pollMs,
        enabled: input.enabled !== false
      }
    };
  }

  // shared/quota/format.ts
  function formatRefreshCountdown(value) {
    if (!value) return void 0;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return void 0;
    const diffMs = date.getTime() - Date.now();
    if (diffMs <= 0) return { full: "\xB7 Refreshes soon", medium: "\xB7 Soon", short: "\xB7 Soon" };
    const diffHours = Math.floor(diffMs / (1e3 * 60 * 60));
    const diffMins = Math.floor(diffMs % (1e3 * 60 * 60) / (1e3 * 60));
    if (diffHours >= 24) {
      return {
        full: `\xB7 Refreshes in ${diffHours}h ${diffMins}m`,
        medium: `\xB7 ${diffHours}h`,
        short: `\xB7 ${diffHours}h`
      };
    }
    if (diffHours > 0) {
      return {
        full: `\xB7 Refreshes in ${diffHours}h ${diffMins}m`,
        medium: `\xB7 ${diffHours}h ${diffMins}m`,
        short: `\xB7 ${diffHours}h`
      };
    }
    return {
      full: `\xB7 Refreshes in ${diffMins}m`,
      medium: `\xB7 ${diffMins}m`,
      short: `\xB7 ${diffMins}m`
    };
  }
  function formatNumber(value) {
    return new Intl.NumberFormat().format(toFiniteNumber(value));
  }
  function formatTokenCount(value) {
    const number = toFiniteNumber(value);
    if (number >= 1e6) {
      return `${(number / 1e6).toFixed(number >= 1e7 ? 1 : 2)}M tokens`;
    }
    if (number >= 1e3) {
      return `${(number / 1e3).toFixed(number >= 1e4 ? 1 : 2)}K tokens`;
    }
    return `${formatNumber(number)} tokens`;
  }
  function formatResetTime(value) {
    if (!value) return void 0;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const diffHours = (date.getTime() - Date.now()) / (1e3 * 60 * 60);
    if (diffHours > 24) {
      return date.toLocaleString(void 0, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return date.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  // shared/quota/local.ts
  function localServerBadge(endpointHealth, loadedModels, programName) {
    const models = Array.isArray(loadedModels) ? loadedModels : [];
    const hasLoadedModels = models.length > 0;
    const health = typeof endpointHealth === "string" ? endpointHealth : "offline";
    const isServerRunning = health === "ok" || health === "idle";
    const program = typeof programName === "string" && programName.trim() ? programName : "Server";
    if (hasLoadedModels) {
      return {
        text: `Active \xB7 ${models[0]}`,
        tone: "active",
        hasLoadedModels,
        isServerRunning,
        programName: program
      };
    }
    if (isServerRunning) {
      return {
        text: `${program} (Idle)`,
        tone: "idle",
        hasLoadedModels,
        isServerRunning,
        programName: program
      };
    }
    return {
      text: "Offline",
      tone: "offline",
      hasLoadedModels,
      isServerRunning,
      programName: program
    };
  }
  function localLoadedModelLabel(loadedModels) {
    const models = Array.isArray(loadedModels) ? loadedModels : [];
    return models.length > 0 ? String(models[0]) : "\u2014";
  }

  // shared/quota/metric.ts
  function absoluteTokenText(left, max, estimated) {
    const safeLeft = toFiniteNumber(left);
    const safeMax = toFiniteNumber(max);
    if (safeMax > 0) {
      return `${formatTokenCount(safeLeft)} / ${formatTokenCount(safeMax)}`;
    }
    if (typeof estimated === "number" && Number.isFinite(estimated)) {
      return formatTokenCount(estimated);
    }
    if (safeLeft > 0) {
      return formatTokenCount(safeLeft);
    }
    return void 0;
  }
  function buildTokenMetric(label, status, prefix, ariaLabel, pairedWeeklyPrefix) {
    const left = toFiniteNumber(status[`${prefix}TokensLeft`]);
    const max = toFiniteNumber(status[`${prefix}Max`]);
    const exactPercentage = status[`${prefix}Percentage`];
    const estimated = status[`${prefix}EstimatedAbsolute`];
    const rawResetTime = status[`${prefix}ResetTime`];
    let percentage;
    if (typeof exactPercentage === "number" && Number.isFinite(exactPercentage)) {
      percentage = clamp(exactPercentage, 0, 100);
    } else if (max > 0) {
      percentage = clamp(left / max * 100, 0, 100);
    }
    const hasAbsolute = typeof estimated === "number" || max > 0 || left > 0;
    let normalizedPercentage = percentage ?? 0;
    let isWeeklyExhausted = false;
    let isWeeklyCapped = false;
    let capReason = "";
    if (label === "5Hours" && pairedWeeklyPrefix && percentage !== void 0) {
      const weeklyExact = status[`${pairedWeeklyPrefix}Percentage`];
      const weeklyLeft = toFiniteNumber(status[`${pairedWeeklyPrefix}TokensLeft`]);
      const weeklyMax = toFiniteNumber(status[`${pairedWeeklyPrefix}Max`]);
      let weeklyPct = typeof weeklyExact === "number" && Number.isFinite(weeklyExact) ? clamp(weeklyExact, 0, 100) : weeklyMax > 0 ? clamp(weeklyLeft / weeklyMax * 100, 0, 100) : void 0;
      if (weeklyPct !== void 0) {
        const sync = calculateEffective5HourQuota(normalizedPercentage, weeklyPct, prefix);
        normalizedPercentage = sync.effectivePct;
        isWeeklyExhausted = sync.isWeeklyExhausted;
        isWeeklyCapped = sync.isWeeklyCapped;
        if (isWeeklyExhausted) {
          capReason = "Weekly exhausted";
        } else if (isWeeklyCapped) {
          capReason = `Weekly capped (${weeklyPct.toFixed(1)}% \xD7 ${sync.K})`;
        }
      }
    }
    const displayPercentage = isWeeklyExhausted ? 0 : normalizedPercentage;
    const mainText = hasAbsolute || percentage !== void 0 ? `${displayPercentage.toFixed(2)}%` : "Unavailable";
    let subtextFull = "Waiting for quota data";
    let subtextMedium = "Waiting";
    let subtextShort = "Waiting";
    if (hasAbsolute || percentage !== void 0) {
      subtextFull = `${normalizedPercentage.toFixed(2)}% remaining`;
      subtextMedium = `${normalizedPercentage.toFixed(2)}%`;
      subtextShort = `${normalizedPercentage.toFixed(1)}%`;
    }
    let effectiveResetTime = rawResetTime;
    if (isWeeklyExhausted && pairedWeeklyPrefix) {
      const pairedResetTime = status[`${pairedWeeklyPrefix}ResetTime`];
      if (pairedResetTime) {
        effectiveResetTime = pairedResetTime;
      }
    }
    const countdown = formatRefreshCountdown(effectiveResetTime);
    const refreshFull = countdown ? countdown.full : "";
    const refreshMedium = countdown ? countdown.medium || countdown.short : "";
    const refreshShort = countdown ? countdown.short : "";
    let tooltip = `${ariaLabel || label}: ${subtextFull}${refreshFull ? ` ${refreshFull}` : ""}. Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.`;
    if (isWeeklyExhausted) {
      tooltip = `${ariaLabel || label}: 0.00% remaining (Weekly quota is exhausted${refreshFull ? ` \xB7 ${refreshFull}` : ""}). All 5-hour capacity is locked until weekly reset.`;
    } else if (isWeeklyCapped) {
      tooltip = `${ariaLabel || label}: ${subtextFull} (${capReason}). 5-hour capacity is constrained by remaining weekly budget.`;
    }
    const labelFull = label;
    const labelMedium = label;
    const labelShort = label === "5Hours" ? "5H" : label === "Weekly" ? "W" : label;
    return {
      label,
      labelFull,
      labelMedium,
      labelShort,
      ariaLabel: ariaLabel || label,
      mainText,
      subtext: subtextFull,
      subtextFull,
      subtextMedium,
      subtextShort,
      refreshText: refreshFull,
      refreshFull,
      refreshMedium,
      refreshShort,
      percentage: normalizedPercentage,
      unavailable: percentage === void 0 && !hasAbsolute,
      tone: capacityTone(normalizedPercentage),
      tooltip,
      isWeeklyExhausted,
      isWeeklyCapped
    };
  }
  function capacitySummaryEntry(labelFull, labelMedium, labelShort, exactPercentage, left, max) {
    let percentage;
    if (typeof exactPercentage === "number" && Number.isFinite(exactPercentage)) {
      percentage = clamp(exactPercentage, 0, 100);
    } else {
      const safeLeft = toFiniteNumber(left);
      const safeMax = toFiniteNumber(max);
      if (safeMax > 0) {
        percentage = clamp(safeLeft / safeMax * 100, 0, 100);
      }
    }
    return typeof percentage === "number" ? { label: labelFull, labelFull, labelMedium, labelShort, percentage } : void 0;
  }
  function calculateCapacitySummary(status) {
    const entries = [
      capacitySummaryEntry("Gemini 5Hours", "Gemini 5Hours", "Gemini 5H", status.antigravityPercentage, status.antigravityTokensLeft, status.antigravityMax),
      capacitySummaryEntry("Gemini Weekly", "Gemini Weekly", "Gemini W", status.antigravityWeeklyPercentage, status.antigravityWeeklyTokensLeft, status.antigravityWeeklyMax),
      capacitySummaryEntry("Opus 5Hours", "Opus 5Hours", "Opus 5H", status.opusPercentage, status.opusTokensLeft, status.opusMax),
      capacitySummaryEntry("Opus Weekly", "Opus Weekly", "Opus W", status.opusWeeklyPercentage, status.opusWeeklyTokensLeft, status.opusWeeklyMax),
      capacitySummaryEntry("ChatGPT 5Hours", "ChatGPT 5Hours", "ChatGPT 5H", status.codexPercentage, status.codexTokensLeft, status.codexMax),
      capacitySummaryEntry("ChatGPT Weekly", "ChatGPT Weekly", "ChatGPT W", status.codexWeeklyPercentage, status.codexWeeklyTokensLeft, status.codexWeeklyMax)
    ].filter((entry) => entry !== void 0);
    if (!entries.length) {
      return null;
    }
    const sorted = entries.slice().sort((a, b) => a.percentage - b.percentage);
    return { entries, lowest: sorted[0], strongest: sorted[sorted.length - 1] };
  }

  // shared/quota/settings.ts
  var MIN_POLL_INTERVAL_MS = 1e3;
  var MAX_POLL_INTERVAL_MS = 6e4;
  var DEFAULT_POLL_INTERVAL_MS = 5e3;
  var QUOTA_SETTINGS_DEFAULTS = Object.freeze({
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    notifyOnFull: true
  });
  function clampPollInterval(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_POLL_INTERVAL_MS;
    return Math.min(Math.max(Math.round(number), MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS);
  }
  function mergeQuotaSettings(partial) {
    const source = partial && typeof partial === "object" ? partial : {};
    return {
      pollIntervalMs: clampPollInterval(source.pollIntervalMs),
      notifyOnFull: typeof source.notifyOnFull === "boolean" ? source.notifyOnFull : QUOTA_SETTINGS_DEFAULTS.notifyOnFull
    };
  }
  return __toCommonJS(index_exports);
})();
