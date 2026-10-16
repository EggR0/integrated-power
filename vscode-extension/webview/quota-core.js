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
    ANTIGRAVITY_STOP_SELECTORS: () => ANTIGRAVITY_STOP_SELECTORS,
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
    PREWARM_MODE_OPTIONS: () => PREWARM_MODE_OPTIONS,
    PREWARM_PING_PROMPT: () => PREWARM_PING_PROMPT,
    PREWARM_TARGETS: () => PREWARM_TARGETS,
    QUOTA_NOTIFICATION_DEFAULTS: () => QUOTA_NOTIFICATION_DEFAULTS,
    QUOTA_NOTIFICATION_TARGETS: () => QUOTA_NOTIFICATION_TARGETS,
    QUOTA_SETTINGS_DEFAULTS: () => QUOTA_SETTINGS_DEFAULTS,
    absoluteTokenText: () => absoluteTokenText,
    applyPrewarmTransition: () => applyPrewarmTransition,
    buildGaugeTickGradient: () => buildGaugeTickGradient,
    buildTokenMetric: () => buildTokenMetric,
    calculateCapacitySummary: () => calculateCapacitySummary,
    calculateEffective5HourQuota: () => calculateEffective5HourQuota,
    canTriggerPrewarm: () => canTriggerPrewarm,
    capacitySummaryEntry: () => capacitySummaryEntry,
    capacityTone: () => capacityTone,
    clamp: () => clamp,
    clampPollInterval: () => clampPollInterval,
    defaultModelPrewarmModes: () => defaultModelPrewarmModes,
    detectRefilledQuotaWindows: () => detectRefilledQuotaWindows,
    executePrewarmPing: () => executePrewarmPing,
    formatNumber: () => formatNumber,
    formatRefreshCountdown: () => formatRefreshCountdown,
    formatResetTime: () => formatResetTime,
    formatTokenCount: () => formatTokenCount,
    generateAntigravityStopScript: () => generateAntigravityStopScript,
    isServiceActiveForSummary: () => isServiceActiveForSummary,
    localLoadedModelLabel: () => localLoadedModelLabel,
    localServerBadge: () => localServerBadge,
    mergeQuotaSettings: () => mergeQuotaSettings,
    modelDiscoveryUrls: () => modelDiscoveryUrls,
    normalizeModelPrewarmModes: () => normalizeModelPrewarmModes,
    normalizePrewarmMode: () => normalizePrewarmMode,
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
  var LIMIT_KEYS = ["limit", "limitTokens", "limit_tokens", "max", "maxTokens", "max_tokens"];
  var REMAINING_ABS_KEYS = ["remainingTokens", "remaining_tokens", "tokensRemaining", "tokens_remaining", "left", "leftTokens", "left_tokens", "availableTokens", "available_tokens"];
  var USED_ABS_KEYS = ["usedTokens", "used_tokens", "tokensUsed", "tokens_used", "used", "consumed", "consumedTokens", "consumed_tokens"];
  function tokenPairRemaining(raw) {
    const limit = toFiniteNumber2(raw[LIMIT_KEYS[0]] ?? raw["limitTokens"] ?? raw["limit_tokens"] ?? raw["max"] ?? raw["maxTokens"] ?? raw["max_tokens"]);
    if (limit === void 0 || limit <= 0) return void 0;
    for (const key of REMAINING_ABS_KEYS) {
      const value = toFiniteNumber2(raw[key]);
      if (value !== void 0) return value >= 0 && value <= limit ? value / limit * 100 : void 0;
    }
    const genericRemaining = toFiniteNumber2(raw.remaining);
    if (genericRemaining !== void 0) return genericRemaining >= 0 && genericRemaining <= limit ? genericRemaining / limit * 100 : void 0;
    for (const key of USED_ABS_KEYS) {
      const value = toFiniteNumber2(raw[key]);
      if (value !== void 0) return value >= 0 && value <= limit ? (limit - value) / limit * 100 : void 0;
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
    const paired = tokenPairRemaining(raw);
    const hasAbsoluteInputs = [...LIMIT_KEYS, ...REMAINING_ABS_KEYS, ...USED_ABS_KEYS, "remaining"].some((key) => raw[key] !== void 0 && raw[key] !== null);
    const explicit = [...REMAINING_KEYS, ...USED_KEYS].map((key) => ({
      key,
      value: toFiniteNumber2(raw[key])
    })).find((entry) => entry.value !== void 0);
    if (hasAbsoluteInputs && paired === void 0 && explicit?.value !== void 0) return void 0;
    if (paired !== void 0 && explicit?.value !== void 0) {
      const reported = USED_KEYS.includes(explicit.key) ? 100 - explicit.value : explicit.value;
      if (reported < 0 || reported > 100 || Math.abs(reported - paired) > 0.01) return void 0;
    }
    if (paired !== void 0) return paired;
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
  function isErrorEnvelope(raw) {
    const error = raw.error;
    if (error !== void 0 && error !== null && error !== false && error !== "") return true;
    const status = raw.status ?? raw.statusCode;
    if (typeof status === "number" && status >= 400) return true;
    if (raw.success === false || Array.isArray(raw.errors) && raw.errors.length > 0) return true;
    return typeof raw.message === "string" && raw.label === void 0 && raw.name === void 0;
  }
  function windowFrom(raw, index, toneOf) {
    if (raw === null || typeof raw !== "object") return null;
    const obj = raw;
    if (isErrorEnvelope(obj)) return null;
    const remaining = extractRemaining(obj);
    const label = labelOf(obj, index);
    const note = typeof obj["note"] === "string" ? obj["note"] : typeof obj["description"] === "string" ? obj["description"] : void 0;
    if (remaining === void 0) {
      return { label, tone: "healthy", unavailable: true, note: note || "remaining field not found or outside the 0..100 range" };
    }
    if (remaining < 0 || remaining > 100) {
      return { label, tone: "healthy", unavailable: true, note: note || "remaining percentage outside the 0..100 range" };
    }
    const percentage = remaining;
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
      if (isErrorEnvelope(obj)) {
        return { ok: false, name, windows: [], error: "provider returned an error response" };
      }
      const windows2 = obj["windows"];
      if (Array.isArray(windows2) && windows2.length > 0) {
        entries = windows2;
      } else if (extractRemaining(obj) !== void 0) {
        entries = [obj];
      } else {
        const candidates = [];
        for (const value of Object.values(obj)) {
          if (value && typeof value === "object" && !isErrorEnvelope(value) && extractRemaining(value) !== void 0) {
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
    const padMins = String(diffMins).padStart(2, "0");
    if (diffHours >= 24) {
      return {
        full: `\xB7 Refreshes in ${diffHours}h ${diffMins}m`,
        medium: `\xB7 ${diffHours}h ${diffMins}m`,
        short: `\xB7 ${diffHours}:${padMins}`
      };
    }
    if (diffHours > 0) {
      return {
        full: `\xB7 Refreshes in ${diffHours}h ${diffMins}m`,
        medium: `\xB7 ${diffHours}h ${diffMins}m`,
        short: `\xB7 ${diffHours}:${padMins}`
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
  function buildGaugeTickGradient(segments) {
    if (!Number.isInteger(segments) || segments < 2 || segments > 20) {
      throw new RangeError("Gauge segments must be an integer from 2 to 20.");
    }
    const stops = [];
    for (let i = 1; i < segments; i++) {
      const at = `${100 * i / segments}%`;
      stops.push(
        `transparent ${at}`,
        `rgba(255, 255, 255, 0.55) ${at}`,
        `rgba(255, 255, 255, 0.55) calc(${at} + 2px)`,
        `transparent calc(${at} + 2px)`
      );
    }
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }
  function absoluteTokenText(left, max, estimated) {
    const safeLeft = typeof left === "number" && Number.isFinite(left) && left >= 0 ? left : void 0;
    const safeMax = typeof max === "number" && Number.isFinite(max) && max >= 0 ? max : void 0;
    if (safeLeft !== void 0 && safeMax !== void 0 && safeMax > 0) {
      return `${formatTokenCount(safeLeft)} / ${formatTokenCount(safeMax)}`;
    }
    if (typeof estimated === "number" && Number.isFinite(estimated)) {
      return `Estimated ${formatTokenCount(estimated)}`;
    }
    if (safeLeft !== void 0) {
      return formatTokenCount(safeLeft);
    }
    return void 0;
  }
  function buildTokenMetric(label, status, prefix, ariaLabel, pairedWeeklyPrefix) {
    const rawLeft = status[`${prefix}TokensLeft`];
    const rawMax = status[`${prefix}Max`];
    const left = typeof rawLeft === "number" && Number.isFinite(rawLeft) && rawLeft >= 0 ? rawLeft : void 0;
    const max = typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax >= 0 ? rawMax : void 0;
    const exactPercentage = status[`${prefix}Percentage`];
    const estimated = status[`${prefix}EstimatedAbsolute`];
    const rawResetTime = status[`${prefix}ResetTime`];
    let percentage;
    if (typeof exactPercentage === "number") {
      if (Number.isFinite(exactPercentage) && exactPercentage >= 0 && exactPercentage <= 100) percentage = exactPercentage;
    } else if (exactPercentage === void 0 && left !== void 0 && max !== void 0 && max > 0 && left <= max) {
      percentage = left / max * 100;
    }
    const hasAbsolute = typeof estimated === "number" && Number.isFinite(estimated) || left !== void 0;
    let effectivePercentage = percentage;
    let isWeeklyExhausted = false;
    let isWeeklyCapped = false;
    let capReason = "";
    if (label === "5Hours" && pairedWeeklyPrefix && percentage !== void 0) {
      const weeklyExact = status[`${pairedWeeklyPrefix}Percentage`];
      const rawWeeklyLeft = status[`${pairedWeeklyPrefix}TokensLeft`];
      const rawWeeklyMax = status[`${pairedWeeklyPrefix}Max`];
      const weeklyLeft = typeof rawWeeklyLeft === "number" && Number.isFinite(rawWeeklyLeft) && rawWeeklyLeft >= 0 ? rawWeeklyLeft : void 0;
      const weeklyMax = typeof rawWeeklyMax === "number" && Number.isFinite(rawWeeklyMax) && rawWeeklyMax >= 0 ? rawWeeklyMax : void 0;
      let weeklyPct = typeof weeklyExact === "number" ? Number.isFinite(weeklyExact) && weeklyExact >= 0 && weeklyExact <= 100 ? weeklyExact : void 0 : weeklyExact === void 0 && weeklyLeft !== void 0 && weeklyMax !== void 0 && weeklyMax > 0 && weeklyLeft <= weeklyMax ? weeklyLeft / weeklyMax * 100 : void 0;
      if (weeklyPct !== void 0 && effectivePercentage !== void 0) {
        const sync = calculateEffective5HourQuota(effectivePercentage, weeklyPct, prefix);
        effectivePercentage = sync.effectivePct;
        isWeeklyExhausted = sync.isWeeklyExhausted;
        isWeeklyCapped = sync.isWeeklyCapped;
        if (isWeeklyExhausted) {
          capReason = "Weekly exhausted";
        } else if (isWeeklyCapped) {
          capReason = `Weekly capped (${weeklyPct.toFixed(1)}% \xD7 ${sync.K})`;
        }
      }
    }
    const displayPercentage = isWeeklyExhausted ? 0 : percentage;
    const mainText = isWeeklyExhausted ? "0.00%" : percentage !== void 0 ? `${percentage.toFixed(2)}%` : "Unavailable";
    let subtextFull = "Waiting for quota data";
    let subtextMedium = "Waiting";
    let subtextShort = "Waiting";
    if (isWeeklyExhausted) {
      subtextFull = "0.00% remaining (Weekly exhausted)";
      subtextMedium = "0.00%";
      subtextShort = "0.0%";
    } else if (percentage !== void 0) {
      subtextFull = `${percentage.toFixed(2)}% remaining`;
      subtextMedium = `${percentage.toFixed(2)}%`;
      subtextShort = `${percentage.toFixed(1)}%`;
    }
    let effectiveResetTime = rawResetTime;
    if (isWeeklyExhausted && pairedWeeklyPrefix) {
      const pairedResetTime = status[`${pairedWeeklyPrefix}ResetTime`];
      if (pairedResetTime) {
        effectiveResetTime = pairedResetTime;
      }
    }
    const weeklyExactForPrewarm = pairedWeeklyPrefix ? status[`${pairedWeeklyPrefix}Percentage`] : void 0;
    const weeklyLeftForPrewarm = pairedWeeklyPrefix ? status[`${pairedWeeklyPrefix}TokensLeft`] : void 0;
    const weeklyMaxForPrewarm = pairedWeeklyPrefix ? status[`${pairedWeeklyPrefix}Max`] : void 0;
    const weeklyKnownForPrewarm = !pairedWeeklyPrefix || typeof weeklyExactForPrewarm === "number" && Number.isFinite(weeklyExactForPrewarm) && weeklyExactForPrewarm >= 0 && weeklyExactForPrewarm <= 100 || weeklyExactForPrewarm === void 0 && typeof weeklyLeftForPrewarm === "number" && typeof weeklyMaxForPrewarm === "number" && weeklyMaxForPrewarm > 0 && weeklyLeftForPrewarm >= 0 && weeklyLeftForPrewarm <= weeklyMaxForPrewarm;
    const is5HourAt100 = label === "5Hours" && percentage !== void 0 && percentage >= 99.95 && !isWeeklyExhausted;
    const is5HourReady = is5HourAt100 && weeklyKnownForPrewarm;
    const resetDate = effectiveResetTime ? new Date(effectiveResetTime) : void 0;
    const resetEpoch = resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate.getTime() : void 0;
    const diffMs = resetEpoch !== void 0 ? resetEpoch - Date.now() : void 0;
    const countdown = formatRefreshCountdown(effectiveResetTime);
    const is5HourActiveCountdown = label === "5Hours" && diffMs !== void 0 && diffMs > 0 && diffMs < 5 * 3600 * 1e3;
    const isPrewarmed = false;
    let refreshFull = "";
    let refreshMedium = "";
    let refreshShort = "";
    let canPrewarm = false;
    let isReady = false;
    if (is5HourReady && !is5HourActiveCountdown) {
      refreshFull = "\xB7 Ready";
      refreshMedium = "\xB7 Ready";
      refreshShort = "\xB7 Ready";
      canPrewarm = true;
      isReady = true;
    } else if (countdown) {
      refreshFull = countdown.full;
      refreshMedium = countdown.medium || countdown.short;
      refreshShort = countdown.short;
      if (is5HourReady) {
        canPrewarm = true;
        isReady = true;
      }
    } else if (is5HourReady) {
      refreshFull = "\xB7 Ready";
      refreshMedium = "\xB7 Ready";
      refreshShort = "\xB7 Ready";
      canPrewarm = true;
      isReady = true;
    }
    let tooltip = percentage === void 0 ? `${ariaLabel || label}: quota percentage unavailable${hasAbsolute ? "; absolute token count is estimated or incomplete" : ""}.` : `${ariaLabel || label}: Reported ${subtextFull}${refreshFull ? ` ${refreshFull}` : ""}. Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.`;
    if (isWeeklyExhausted) {
      tooltip = `${ariaLabel || label}: Reported ${subtextFull}; weekly quota is exhausted. Pre-warm and routing policy are blocked until fresh weekly quota data allows them.`;
    } else if (isWeeklyCapped) {
      tooltip = `${ariaLabel || label}: Reported ${subtextFull}; policy ceiling ${effectivePercentage?.toFixed(1)}% (${capReason}).`;
    } else if (is5HourReady) {
      tooltip = `${ariaLabel || label}: Reported ${subtextFull} (Ready for policy-gated pre-warm). Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.`;
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
      percentage,
      effectivePercentage,
      displayPercentage,
      unavailable: percentage === void 0,
      tone: percentage === void 0 ? "healthy" : isWeeklyExhausted ? "critical" : capacityTone(percentage),
      tooltip,
      isWeeklyExhausted,
      isWeeklyCapped,
      canPrewarm,
      isReady,
      isPrewarmed
    };
  }
  function capacitySummaryEntry(labelFull, labelMedium, labelShort, exactPercentage, left, max) {
    let percentage;
    if (typeof exactPercentage === "number") {
      if (Number.isFinite(exactPercentage) && exactPercentage >= 0 && exactPercentage <= 100) percentage = exactPercentage;
    } else if (exactPercentage === void 0) {
      const safeLeft = typeof left === "number" && Number.isFinite(left) && left >= 0 ? left : void 0;
      const safeMax = typeof max === "number" && Number.isFinite(max) && max >= 0 ? max : void 0;
      if (safeLeft !== void 0 && safeMax !== void 0 && safeMax > 0) {
        if (safeLeft <= safeMax) percentage = safeLeft / safeMax * 100;
      }
    }
    return typeof percentage === "number" ? { label: labelFull, labelFull, labelMedium, labelShort, percentage } : void 0;
  }
  function isServiceActiveForSummary(status, service, filter) {
    if (filter) {
      if (service === "gemini" && filter.showAntigravity === false) return false;
      if (service === "claude" && filter.showClaude === false) return false;
      if (service === "codex" && filter.showCodex === false) return false;
    }
    const viewConfig = status.viewConfig || status.view_config;
    if (viewConfig) {
      if (service === "gemini" && viewConfig.showAntigravity === false) return false;
      if (service === "claude" && viewConfig.showClaude === false) return false;
      if (service === "codex" && viewConfig.showCodex === false) return false;
    }
    if (service === "codex") {
      const s = String(status.codexStatus || status.codexState || "").toLowerCase();
      if (s === "offline" || s === "unauthenticated" || s === "disabled" || s === "missing" || s === "not_logged_in") {
        return false;
      }
    } else if (service === "claude") {
      const s = String(status.opusStatus || status.claudeStatus || "").toLowerCase();
      if (s === "offline" || s === "unauthenticated" || s === "disabled" || s === "missing" || s === "not_logged_in") {
        return false;
      }
    } else if (service === "gemini") {
      const s = String(status.antigravityStatus || status.geminiStatus || "").toLowerCase();
      if (s === "offline" || s === "unauthenticated" || s === "disabled" || s === "missing" || s === "not_logged_in") {
        return false;
      }
    }
    return true;
  }
  function calculateCapacitySummary(status, filter) {
    const entries = [];
    if (isServiceActiveForSummary(status, "gemini", filter)) {
      const gw = capacitySummaryEntry("Gemini Weekly", "Gemini Weekly", "Gemini W", status.antigravityWeeklyPercentage, status.antigravityWeeklyTokensLeft, status.antigravityWeeklyMax);
      const g5 = capacitySummaryEntry("Gemini 5Hours", "Gemini 5Hours", "Gemini 5H", status.antigravityPercentage, status.antigravityTokensLeft, status.antigravityMax);
      if (g5 && gw && typeof gw.percentage === "number") {
        g5.percentage = calculateEffective5HourQuota(g5.percentage, gw.percentage, "antigravity").effectivePct;
      }
      if (g5) entries.push(g5);
      if (gw) entries.push(gw);
    }
    if (isServiceActiveForSummary(status, "claude", filter)) {
      const cw = capacitySummaryEntry("Claude Weekly", "Claude Weekly", "Claude W", status.opusWeeklyPercentage, status.opusWeeklyTokensLeft, status.opusWeeklyMax);
      const c5 = capacitySummaryEntry("Claude 5Hours", "Claude 5Hours", "Claude 5H", status.opusPercentage, status.opusTokensLeft, status.opusMax);
      if (c5 && cw && typeof cw.percentage === "number") {
        c5.percentage = calculateEffective5HourQuota(c5.percentage, cw.percentage, "opus").effectivePct;
      }
      if (c5) entries.push(c5);
      if (cw) entries.push(cw);
    }
    if (isServiceActiveForSummary(status, "codex", filter)) {
      const xw = capacitySummaryEntry("ChatGPT Weekly", "ChatGPT Weekly", "ChatGPT W", status.codexWeeklyPercentage, status.codexWeeklyTokensLeft, status.codexWeeklyMax);
      const x5 = capacitySummaryEntry("ChatGPT 5Hours", "ChatGPT 5Hours", "ChatGPT 5H", status.codexPercentage, status.codexTokensLeft, status.codexMax);
      if (x5 && xw && typeof xw.percentage === "number") {
        x5.percentage = calculateEffective5HourQuota(x5.percentage, xw.percentage, "codex").effectivePct;
      }
      if (x5) entries.push(x5);
      if (xw) entries.push(xw);
    }
    if (!entries.length) {
      return null;
    }
    const sorted = entries.slice().sort((a, b) => a.percentage - b.percentage);
    return { entries, lowest: sorted[0], strongest: sorted[sorted.length - 1] };
  }

  // shared/quota/notifications.ts
  var QUOTA_NOTIFICATION_TARGETS = [
    // 1 & 2: Antigravity IDE Gemini (5h, Weekly)
    {
      id: "antigravity-gemini-5h",
      configKey: "notifications.antigravityGemini5h",
      model: "Antigravity Gemini",
      window: "5Hours",
      title: "Antigravity IDE Gemini (5\uC2DC\uAC04)",
      message: "Antigravity IDE Gemini 5\uC2DC\uAC04 \uCFFC\uD130\uAC00 100%\uB85C \uC644\uCDA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4!",
      getPercentage: (s) => {
        if (!s) return void 0;
        if (typeof s.antigravityPercentage === "number") return s.antigravityPercentage;
        if (s.antigravityMax > 0 && typeof s.antigravityTokensLeft === "number") {
          return s.antigravityTokensLeft / s.antigravityMax * 100;
        }
        return void 0;
      }
    },
    {
      id: "antigravity-gemini-weekly",
      configKey: "notifications.antigravityGeminiWeekly",
      model: "Antigravity Gemini",
      window: "Weekly",
      title: "Antigravity IDE Gemini (\uC8FC\uAC04)",
      message: "Antigravity IDE Gemini \uC8FC\uAC04 \uCFFC\uD130\uAC00 100%\uB85C \uC644\uCDA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4!",
      getPercentage: (s) => {
        if (!s) return void 0;
        if (typeof s.antigravityWeeklyPercentage === "number") return s.antigravityWeeklyPercentage;
        if (s.antigravityWeeklyMax > 0 && typeof s.antigravityWeeklyTokensLeft === "number") {
          return s.antigravityWeeklyTokensLeft / s.antigravityWeeklyMax * 100;
        }
        return void 0;
      }
    },
    // 3 & 4: Antigravity IDE Claude (5h, Weekly)
    {
      id: "antigravity-claude-5h",
      configKey: "notifications.antigravityClaude5h",
      model: "Antigravity Claude",
      window: "5Hours",
      title: "Antigravity IDE Claude (5\uC2DC\uAC04)",
      message: "Antigravity IDE Claude 5\uC2DC\uAC04 \uCFFC\uD130\uAC00 100%\uB85C \uC644\uCDA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4!",
      getPercentage: (s) => {
        if (!s) return void 0;
        if (typeof s.opusPercentage === "number") return s.opusPercentage;
        if (s.opusMax > 0 && typeof s.opusTokensLeft === "number") {
          return s.opusTokensLeft / s.opusMax * 100;
        }
        return void 0;
      }
    },
    {
      id: "antigravity-claude-weekly",
      configKey: "notifications.antigravityClaudeWeekly",
      model: "Antigravity Claude",
      window: "Weekly",
      title: "Antigravity IDE Claude (\uC8FC\uAC04)",
      message: "Antigravity IDE Claude \uC8FC\uAC04 \uCFFC\uD130\uAC00 100%\uB85C \uC644\uCDA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4!",
      getPercentage: (s) => {
        if (!s) return void 0;
        if (typeof s.opusWeeklyPercentage === "number") return s.opusWeeklyPercentage;
        if (s.opusWeeklyMax > 0 && typeof s.opusWeeklyTokensLeft === "number") {
          return s.opusWeeklyTokensLeft / s.opusWeeklyMax * 100;
        }
        return void 0;
      }
    },
    // 5 & 6: ChatGPT (OpenAI / Codex) (5h, Weekly)
    {
      id: "chatgpt-5h",
      configKey: "notifications.chatgpt5h",
      model: "ChatGPT",
      window: "5Hours",
      title: "ChatGPT (5\uC2DC\uAC04)",
      message: "ChatGPT 5\uC2DC\uAC04 \uCFFC\uD130\uAC00 100%\uB85C \uC644\uCDA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4!",
      getPercentage: (s) => {
        if (!s) return void 0;
        if (typeof s.codexPercentage === "number") return s.codexPercentage;
        if (s.codexMax > 0 && typeof s.codexTokensLeft === "number") {
          return s.codexTokensLeft / s.codexMax * 100;
        }
        return void 0;
      }
    },
    {
      id: "chatgpt-weekly",
      configKey: "notifications.chatgptWeekly",
      model: "ChatGPT",
      window: "Weekly",
      title: "ChatGPT (\uC8FC\uAC04)",
      message: "ChatGPT \uC8FC\uAC04 \uCFFC\uD130\uAC00 100%\uB85C \uC644\uCDA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4!",
      getPercentage: (s) => {
        if (!s) return void 0;
        if (typeof s.codexWeeklyPercentage === "number") return s.codexWeeklyPercentage;
        if (s.codexWeeklyMax > 0 && typeof s.codexWeeklyTokensLeft === "number") {
          return s.codexWeeklyTokensLeft / s.codexWeeklyMax * 100;
        }
        return void 0;
      }
    },
    // 7 & 8: Claude (Anthropic Direct API / CLI / Cowork) (5h, Weekly)
    {
      id: "claude-5h",
      configKey: "notifications.claude5h",
      model: "Claude",
      window: "5Hours",
      title: "Claude (5\uC2DC\uAC04)",
      message: "Claude 5\uC2DC\uAC04 \uCFFC\uD130\uAC00 100%\uB85C \uC644\uCDA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4!",
      getPercentage: (s) => {
        if (!s) return void 0;
        if (typeof s.claudePercentage === "number") return s.claudePercentage;
        if (s.claudeMax > 0 && typeof s.claudeTokensLeft === "number") {
          return s.claudeTokensLeft / s.claudeMax * 100;
        }
        return void 0;
      }
    },
    {
      id: "claude-weekly",
      configKey: "notifications.claudeWeekly",
      model: "Claude",
      window: "Weekly",
      title: "Claude (\uC8FC\uAC04)",
      message: "Claude \uC8FC\uAC04 \uCFFC\uD130\uAC00 100%\uB85C \uC644\uCDA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4!",
      getPercentage: (s) => {
        if (!s) return void 0;
        if (typeof s.claudeWeeklyPercentage === "number") return s.claudeWeeklyPercentage;
        if (s.claudeWeeklyMax > 0 && typeof s.claudeWeeklyTokensLeft === "number") {
          return s.claudeWeeklyTokensLeft / s.claudeWeeklyMax * 100;
        }
        return void 0;
      }
    }
  ];
  function detectRefilledQuotaWindows(previous, current, alreadyNotifiedSet) {
    const updatedSet = new Set(alreadyNotifiedSet);
    const notifications = [];
    if (!current) {
      return { notifications, updatedNotifiedSet: updatedSet };
    }
    for (const target of QUOTA_NOTIFICATION_TARGETS) {
      const currPct = target.getPercentage(current);
      const prevPct = previous ? target.getPercentage(previous) : void 0;
      if (typeof currPct !== "number" || !Number.isFinite(currPct)) {
        continue;
      }
      if (currPct < 100) {
        updatedSet.delete(target.id);
      } else if (currPct >= 100) {
        const wasDepleted = typeof prevPct === "number" && prevPct < 100;
        if (wasDepleted && !updatedSet.has(target.id)) {
          updatedSet.add(target.id);
          notifications.push({
            target,
            previousPercent: prevPct,
            currentPercent: currPct
          });
        }
      }
    }
    return { notifications, updatedNotifiedSet: updatedSet };
  }

  // shared/quota/prewarm.ts
  var ANTIGRAVITY_STOP_SELECTORS = Object.freeze({
    /** Primary cancel tooltip button in Antigravity Agent Panel */
    cancelButton: '[data-tooltip-id="input-send-button-cancel-tooltip"]',
    /** Fallback stop square icon button in send container */
    stopSquareButton: "button svg.lucide-square",
    /** Antigravity Agent side panel input box */
    inputBox: "#antigravity\\.agentSidePanelInputBox",
    /** Alternative chat/conversation containers in Antigravity IDE */
    chatContainers: ["#conversation", "#chat", "#cascade"]
  });
  var PREWARM_PING_PROMPT = "integrated power";
  var PREWARM_MODE_OPTIONS = Object.freeze([
    {
      value: "click",
      label: "Click to Pre-warm",
      description: "Manual on-demand trigger when the [\u26A1 Pre-warm] button is clicked."
    },
    {
      value: "once",
      label: "Once Pre-warm",
      description: "Automatically pre-warms once on the next 100% Ready window, then returns to Click mode."
    },
    {
      value: "always",
      label: "Always Pre-warm",
      description: "Continuously keeps 5-hour rolling recharge cycles running ahead of time."
    }
  ]);
  function normalizePrewarmMode(value) {
    if (value === "always" || value === "once" || value === "click") {
      return value;
    }
    return "click";
  }
  function defaultModelPrewarmModes() {
    return {
      antigravity: "click",
      opus: "click",
      codex: "click"
    };
  }
  function normalizeModelPrewarmModes(raw, fallbackMode) {
    const fallback = normalizePrewarmMode(fallbackMode);
    const safe = raw && typeof raw === "object" ? raw : {};
    return {
      antigravity: normalizePrewarmMode(safe.antigravity || safe.gemini || fallback),
      opus: normalizePrewarmMode(safe.opus || safe.claude || fallback),
      codex: normalizePrewarmMode(safe.codex || safe.chatgpt || fallback)
    };
  }
  var PREWARM_TARGETS = Object.freeze([
    { id: "antigravity-gemini-5h", model: "antigravity", displayName: "Gemini 5Hours", prefix: "antigravity" },
    { id: "codex-chatgpt-5h", model: "codex", displayName: "ChatGPT 5Hours", prefix: "codex" },
    { id: "opus-claude-5h", model: "opus", displayName: "Claude 5Hours", prefix: "opus" },
    { id: "claude-5h", model: "claude", displayName: "Claude 5Hours", prefix: "claude" }
  ]);
  function canTriggerPrewarm(metric) {
    return metric.label === "5Hours" && metric.percentage !== void 0 && metric.percentage >= 99.95 && !metric.isWeeklyExhausted && Boolean(metric.canPrewarm);
  }
  function generateAntigravityStopScript() {
    return `(function() {
    const cancel = document.querySelector('${ANTIGRAVITY_STOP_SELECTORS.cancelButton}');
    if (cancel && cancel.offsetParent !== null) {
      cancel.click();
      return { success: true, method: 'cancel_tooltip' };
    }
    const stopBtn = document.querySelector('${ANTIGRAVITY_STOP_SELECTORS.stopSquareButton}')?.closest('button');
    if (stopBtn && stopBtn.offsetParent !== null) {
      stopBtn.click();
      return { success: true, method: 'fallback_square' };
    }
    return { success: false, reason: 'no_active_generation' };
  })()`;
  }
  function applyPrewarmTransition(currentStatus, prefix, _nowMs = Date.now()) {
    void prefix;
    return { ...currentStatus };
  }
  async function executePrewarmPing(target, dispatcher) {
    const AC = typeof AbortController !== "undefined" ? AbortController : typeof globalThis !== "undefined" ? globalThis.AbortController : void 0;
    const abortController = AC ? new AC() : void 0;
    if (dispatcher && abortController) {
      const promise = dispatcher(PREWARM_PING_PROMPT, abortController.signal);
      abortController.abort();
      try {
        await promise;
      } catch {
      }
    }
    return {
      ok: Boolean(dispatcher),
      targetId: target.id,
      model: target.model,
      message: dispatcher ? `Pre-warm request dispatched for ${target.displayName}; provider quota and timer state are unconfirmed.` : `Pre-warm was not dispatched for ${target.displayName}; provider quota and timer state are unconfirmed.`,
      stopMethod: dispatcher ? "abort_controller" : "simulated"
    };
  }

  // shared/quota/settings.ts
  var QUOTA_NOTIFICATION_DEFAULTS = Object.freeze({
    antigravityGemini5h: true,
    antigravityGeminiWeekly: true,
    antigravityClaude5h: true,
    antigravityClaudeWeekly: true,
    chatgpt5h: true,
    chatgptWeekly: true,
    claude5h: true,
    claudeWeekly: true
  });
  var MIN_POLL_INTERVAL_MS = 1e3;
  var MAX_POLL_INTERVAL_MS = 6e4;
  var DEFAULT_POLL_INTERVAL_MS = 5e3;
  var QUOTA_SETTINGS_DEFAULTS = Object.freeze({
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    notifyOnFull: true,
    prewarmMode: "click",
    prewarmModes: Object.freeze({ antigravity: "click", opus: "click", codex: "click" }),
    notifications: QUOTA_NOTIFICATION_DEFAULTS
  });
  function clampPollInterval(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_POLL_INTERVAL_MS;
    return Math.min(Math.max(Math.round(number), MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS);
  }
  function mergeQuotaSettings(partial) {
    const source = partial && typeof partial === "object" ? partial : {};
    const legacyMode = normalizePrewarmMode(source.prewarmMode);
    const sourceModes = source.prewarmModes;
    const modes = sourceModes && typeof sourceModes === "object" ? sourceModes : {};
    const sourceNotifications = source.notifications;
    const notifications = sourceNotifications && typeof sourceNotifications === "object" ? sourceNotifications : {};
    const prewarmModes = {
      antigravity: normalizePrewarmMode(modes.antigravity ?? legacyMode),
      opus: normalizePrewarmMode(modes.opus ?? legacyMode),
      codex: normalizePrewarmMode(modes.codex ?? legacyMode)
    };
    return {
      pollIntervalMs: clampPollInterval(source.pollIntervalMs),
      notifyOnFull: typeof source.notifyOnFull === "boolean" ? source.notifyOnFull : QUOTA_SETTINGS_DEFAULTS.notifyOnFull,
      prewarmMode: prewarmModes.antigravity,
      prewarmModes,
      notifications: Object.fromEntries(Object.entries(QUOTA_NOTIFICATION_DEFAULTS).map(([key, defaultValue]) => [
        key,
        typeof notifications[key] === "boolean" ? notifications[key] : defaultValue
      ]))
    };
  }
  return __toCommonJS(index_exports);
})();
