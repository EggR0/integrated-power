// GOLDEN SNAPSHOT of the pre-refactor webview quota functions.
// Generated once from webview/main.js before those functions were moved to
// shared/quota. test-quota-core.js compares the shared bundle against these.
// DO NOT edit by hand.

const K_CAPACITY_RATIOS = Object.freeze({
  opus: 4.5,
  antigravity: 5.0,
  codex: 4.0,
  claude: 4.5,
});
const K_DEFAULT_RATIO = 4.5;

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
      effectivePct: 0.0,
      isWeeklyExhausted: true,
      isWeeklyCapped: true,
      K,
    };
  }

  if (typeof weeklyPct === "number" && Number.isFinite(weeklyPct)) {
    const weeklyCeiling = weeklyPct * K;
    if (weeklyCeiling < fiveHourPct) {
      return {
        effectivePct: clamp(weeklyCeiling, 0, 100),
        isWeeklyExhausted: false,
        isWeeklyCapped: true,
        K,
      };
    }
  }

  return {
    effectivePct: fiveHourPct,
    isWeeklyExhausted: false,
    isWeeklyCapped: false,
    K,
  };
}

function formatRefreshCountdown(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return { full: "\u00B7 Refreshes soon", medium: "\u00B7 Soon", short: "\u00B7 Soon" };
  
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffHours >= 24) {
    return {
      full: `\u00B7 Refreshes in ${diffHours}h ${diffMins}m`,
      medium: `\u00B7 ${diffHours}h`,
      short: `\u00B7 ${diffHours}h`,
    };
  }
  if (diffHours > 0) {
    return {
      full: `\u00B7 Refreshes in ${diffHours}h ${diffMins}m`,
      medium: `\u00B7 ${diffHours}h ${diffMins}m`,
      short: `\u00B7 ${diffHours}h`,
    };
  }
  return {
    full: `\u00B7 Refreshes in ${diffMins}m`,
    medium: `\u00B7 ${diffMins}m`,
    short: `\u00B7 ${diffMins}m`,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(toFiniteNumber(value));
}

function formatTokenCount(value) {
  const number = toFiniteNumber(value);
  if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 1 : 2)}M tokens`;
  }
  if (number >= 1_000) {
    return `${(number / 1_000).toFixed(number >= 10_000 ? 1 : 2)}K tokens`;
  }
  return `${formatNumber(number)} tokens`;
}

function formatResetTime(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const diffHours = (date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (diffHours > 24) {
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

module.exports = { K_CAPACITY_RATIOS, K_DEFAULT_RATIO, toFiniteNumber, clamp, capacityTone, calculateEffective5HourQuota, formatRefreshCountdown, formatNumber, formatTokenCount, formatResetTime };
