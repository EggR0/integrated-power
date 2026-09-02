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
    K_CAPACITY_RATIOS: () => K_CAPACITY_RATIOS,
    K_DEFAULT_RATIO: () => K_DEFAULT_RATIO,
    MAX_POLL_INTERVAL_MS: () => MAX_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS: () => MIN_POLL_INTERVAL_MS,
    QUOTA_SETTINGS_DEFAULTS: () => QUOTA_SETTINGS_DEFAULTS,
    calculateEffective5HourQuota: () => calculateEffective5HourQuota,
    capacityTone: () => capacityTone,
    clamp: () => clamp,
    clampPollInterval: () => clampPollInterval,
    formatNumber: () => formatNumber,
    formatRefreshCountdown: () => formatRefreshCountdown,
    formatResetTime: () => formatResetTime,
    formatTokenCount: () => formatTokenCount,
    mergeQuotaSettings: () => mergeQuotaSettings,
    toFiniteNumber: () => toFiniteNumber
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
