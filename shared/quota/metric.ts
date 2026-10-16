/**
 * Per-window token metrics shared by the VSIX webview and the control-center
 * desktop UI. Pure functions only (no DOM, no Node).
 *
 * These are the P3 parity features from docs/spec/quota-ui-parity-spec.md:
 *   A4 absolute-token availability — a window shows a value only when real
 *      data exists (`*TokensLeft` / `*Max` > 0 or a number `*Percentage`, or an
 *      `*EstimatedAbsolute`); otherwise it renders "Unavailable" instead of a
 *      fake 0%. When no explicit percentage exists, it is derived from
 *      left / max.
 *   A5 Best / Lowest summary — `calculateCapacitySummary` ranks the six
 *      windows and picks the strongest and the lowest remaining.
 *   A7 tooltips — `buildTokenMetric.tooltip` carries the remaining %, the
 *      reset countdown, and the health/capped/exhausted explanation.
 *
 * The bodies are extracted verbatim from the VSIX webview (webview/main.js)
 * so the control-center and the IDE cannot drift; the original webview bodies
 * are snapshotted in scripts/quota-golden.js and compared in
 * scripts/test-quota-core.js.
 */

import {
  type CapacityTone,
  capacityTone,
  clamp,
} from "./capacity";
import { calculateEffective5HourQuota } from "./capacity";
import { formatRefreshCountdown, formatTokenCount } from "./format";

/** Build the existing desktop gauge divider gradient for an equal-segment track. */
export function buildGaugeTickGradient(segments: number): string {
  if (!Number.isInteger(segments) || segments < 2 || segments > 20) {
    throw new RangeError("Gauge segments must be an integer from 2 to 20.");
  }
  const stops: string[] = [];
  for (let i = 1; i < segments; i++) {
    const at = `${(100 * i) / segments}%`;
    stops.push(
      `transparent ${at}`,
      `rgba(255, 255, 255, 0.55) ${at}`,
      `rgba(255, 255, 255, 0.55) calc(${at} + 2px)`,
      `transparent calc(${at} + 2px)`
    );
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** A token_status object: a flat bag of per-window numeric/string fields. */
export type TokenStatus = Record<string, unknown>;

/** Shape of the object `buildTokenMetric` returns (one window). */
export interface TokenMetric {
  label: string;
  labelFull: string;
  labelMedium: string;
  labelShort: string;
  ariaLabel: string;
  mainText: string;
  subtext: string;
  subtextFull: string;
  subtextMedium: string;
  subtextShort: string;
  refreshText: string;
  refreshFull: string;
  refreshMedium: string;
  refreshShort: string;
  /** Effective (K-synced) remaining percentage, 0–100. */
  percentage?: number;
  /** Policy-only 5h ceiling after weekly synchronization; never presented as measured quota. */
  effectivePercentage?: number;
  /** Effective display percentage taking weekly exhaustion into account (0 when weekly exhausted). */
  displayPercentage?: number;
  /** No absolute data and no percentage: render "Unavailable". */
  unavailable: boolean;
  tone: CapacityTone;
  tooltip: string;
  isWeeklyExhausted: boolean;
  isWeeklyCapped: boolean;
  canPrewarm: boolean;
  isReady: boolean;
  isPrewarmed: boolean;
}

/** One entry in the Best / Lowest summary (a single window). */
export interface CapacitySummaryEntry {
  label: string;
  labelFull: string;
  labelMedium: string;
  labelShort: string;
  percentage: number;
}

/** Result of `calculateCapacitySummary`: the ranked windows + extremes. */
export interface CapacitySummary {
  entries: CapacitySummaryEntry[];
  lowest: CapacitySummaryEntry;
  strongest: CapacitySummaryEntry;
}

/**
 * A4 absolute-token text for one window.
 *   - `max > 0`            -> "left / max" (the explicit window budget)
 *   - else `estimated`     -> the EstimatedAbsolute fallback (a single number)
 *   - else `left >= 0`     -> the measured remaining count alone
 *   - otherwise            -> undefined (no absolute data: do not show a fake
 *                              "0 tokens"; the caller shows "Unavailable"/"Waiting")
 * Returns undefined exactly when `buildTokenMetric` reports no absolute data
 * (max>0 || estimated || left is absent).
 */
export function absoluteTokenText(
  left: unknown,
  max: unknown,
  estimated: unknown,
): string | undefined {
  const safeLeft = typeof left === "number" && Number.isFinite(left) && left >= 0 ? left : undefined;
  const safeMax = typeof max === "number" && Number.isFinite(max) && max >= 0 ? max : undefined;
  if (safeLeft !== undefined && safeMax !== undefined && safeMax > 0) {
    return `${formatTokenCount(safeLeft)} / ${formatTokenCount(safeMax)}`;
  }
  if (typeof estimated === "number" && Number.isFinite(estimated)) {
    return `Estimated ${formatTokenCount(estimated)}`;
  }
  if (safeLeft !== undefined) {
    return formatTokenCount(safeLeft);
  }
  return undefined;
}

/**
 * Build the display model for one quota window (5Hours or Weekly).
 *
 * @param label one of "5Hours" | "Weekly" (drives the K-sync + short label)
 * @param status the full token_status object
 * @param prefix window key, e.g. "antigravity", "opus", "codex", "claude"
 * @param ariaLabel human label used in the tooltip / aria
 * @param pairedWeeklyPrefix the sibling Weekly window prefix, so a 5Hours
 *   window can be constrained by its weekly budget
 */
export function buildTokenMetric(
  label: string,
  status: TokenStatus,
  prefix: string,
  ariaLabel?: string,
  pairedWeeklyPrefix?: string,
): TokenMetric {
  const rawLeft = status[`${prefix}TokensLeft`];
  const rawMax = status[`${prefix}Max`];
  const left = typeof rawLeft === "number" && Number.isFinite(rawLeft) && rawLeft >= 0 ? rawLeft : undefined;
  const max = typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax >= 0 ? rawMax : undefined;
  const exactPercentage = status[`${prefix}Percentage`];
  const estimated = status[`${prefix}EstimatedAbsolute`];
  const rawResetTime = status[`${prefix}ResetTime`] as string | undefined;

  let percentage;
  if (typeof exactPercentage === "number") {
    if (Number.isFinite(exactPercentage) && exactPercentage >= 0 && exactPercentage <= 100) percentage = exactPercentage;
  } else if (exactPercentage === undefined && left !== undefined && max !== undefined && max > 0 && left <= max) {
    percentage = (left / max) * 100;
  }

  const hasAbsolute = (typeof estimated === "number" && Number.isFinite(estimated)) || left !== undefined;
  let effectivePercentage = percentage;
  let isWeeklyExhausted = false;
  let isWeeklyCapped = false;
  let capReason = "";

  // Dual-Window policy: keep reported values intact and expose only the
  // routing ceiling separately.
  if (label === "5Hours" && pairedWeeklyPrefix && percentage !== undefined) {
    const weeklyExact = status[`${pairedWeeklyPrefix}Percentage`];
    const rawWeeklyLeft = status[`${pairedWeeklyPrefix}TokensLeft`];
    const rawWeeklyMax = status[`${pairedWeeklyPrefix}Max`];
    const weeklyLeft = typeof rawWeeklyLeft === "number" && Number.isFinite(rawWeeklyLeft) && rawWeeklyLeft >= 0 ? rawWeeklyLeft : undefined;
    const weeklyMax = typeof rawWeeklyMax === "number" && Number.isFinite(rawWeeklyMax) && rawWeeklyMax >= 0 ? rawWeeklyMax : undefined;
    let weeklyPct = typeof weeklyExact === "number"
      ? Number.isFinite(weeklyExact) && weeklyExact >= 0 && weeklyExact <= 100 ? weeklyExact : undefined
      : weeklyExact === undefined && weeklyLeft !== undefined && weeklyMax !== undefined && weeklyMax > 0 && weeklyLeft <= weeklyMax
        ? (weeklyLeft / weeklyMax) * 100
        : undefined;

    if (weeklyPct !== undefined && effectivePercentage !== undefined) {
      const sync = calculateEffective5HourQuota(effectivePercentage, weeklyPct, prefix);
      effectivePercentage = sync.effectivePct;
      isWeeklyExhausted = sync.isWeeklyExhausted;
      isWeeklyCapped = sync.isWeeklyCapped;
      if (isWeeklyExhausted) {
        capReason = "Weekly exhausted";
      } else if (isWeeklyCapped) {
        capReason = `Weekly capped (${weeklyPct.toFixed(1)}% × ${sync.K})`;
      }
    }
  }

  const displayPercentage = isWeeklyExhausted ? 0.0 : percentage;
  const mainText = isWeeklyExhausted
    ? "0.00%"
    : percentage !== undefined
      ? `${percentage.toFixed(2)}%`
      : "Unavailable";

  let subtextFull = "Waiting for quota data";
  let subtextMedium = "Waiting";
  let subtextShort = "Waiting";
  if (isWeeklyExhausted) {
    subtextFull = "0.00% remaining (Weekly exhausted)";
    subtextMedium = "0.00%";
    subtextShort = "0.0%";
  } else if (percentage !== undefined) {
    subtextFull = `${percentage.toFixed(2)}% remaining`;
    subtextMedium = `${percentage.toFixed(2)}%`;
    subtextShort = `${percentage.toFixed(1)}%`;
  }

  let effectiveResetTime = rawResetTime;
  if (isWeeklyExhausted && pairedWeeklyPrefix) {
    const pairedResetTime = status[`${pairedWeeklyPrefix}ResetTime`] as string | undefined;
    if (pairedResetTime) {
      effectiveResetTime = pairedResetTime;
    }
  }

  const weeklyExactForPrewarm = pairedWeeklyPrefix ? status[`${pairedWeeklyPrefix}Percentage`] : undefined;
  const weeklyLeftForPrewarm = pairedWeeklyPrefix ? status[`${pairedWeeklyPrefix}TokensLeft`] : undefined;
  const weeklyMaxForPrewarm = pairedWeeklyPrefix ? status[`${pairedWeeklyPrefix}Max`] : undefined;
  const weeklyKnownForPrewarm = !pairedWeeklyPrefix
    || (typeof weeklyExactForPrewarm === "number" && Number.isFinite(weeklyExactForPrewarm) && weeklyExactForPrewarm >= 0 && weeklyExactForPrewarm <= 100)
    || (weeklyExactForPrewarm === undefined && typeof weeklyLeftForPrewarm === "number" && typeof weeklyMaxForPrewarm === "number" && weeklyMaxForPrewarm > 0 && weeklyLeftForPrewarm >= 0 && weeklyLeftForPrewarm <= weeklyMaxForPrewarm);
  const is5HourAt100 = label === "5Hours" && percentage !== undefined && percentage >= 99.95 && !isWeeklyExhausted;
  const is5HourReady = is5HourAt100 && weeklyKnownForPrewarm;
  const isWeeklyAt100 = label === "Weekly" && percentage !== undefined && percentage >= 99.95;
  const resetDate = effectiveResetTime ? new Date(effectiveResetTime) : undefined;
  const resetEpoch = resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate.getTime() : undefined;
  const diffMs = resetEpoch !== undefined ? resetEpoch - Date.now() : undefined;
  const countdown = formatRefreshCountdown(effectiveResetTime);
  // Pre-warm requires 100% quota AND a full time window.
  // If the reset countdown is already actively ticking down (less than full duration),
  // the window has already started its rolling cycle and is not eligible for prewarm.
  const is5HourActiveCountdown = label === "5Hours" && diffMs !== undefined && diffMs > 0 && diffMs < 5 * 3600 * 1000 - 15 * 60 * 1000;
  const isWeeklyActiveCountdown = label === "Weekly" && diffMs !== undefined && diffMs > 0 && diffMs < 168 * 3600 * 1000 - 4 * 3600 * 1000;
  const isPrewarmed = false;
  let refreshFull = "";
  let refreshMedium = "";
  let refreshShort = "";
  let canPrewarm = false;
  let isReady = false;

  if (is5HourReady && !is5HourActiveCountdown) {
    refreshFull = "· Ready";
    refreshMedium = "· Ready";
    refreshShort = "· Ready";
    canPrewarm = true;
    isReady = true;
  } else if (isWeeklyAt100 && !isWeeklyActiveCountdown) {
    refreshFull = "· Ready";
    refreshMedium = "· Ready";
    refreshShort = "· Ready";
    canPrewarm = true;
    isReady = true;
  } else if (countdown) {
    refreshFull = countdown.full;
    refreshMedium = countdown.medium || countdown.short;
    refreshShort = countdown.short;
    canPrewarm = false;
    isReady = false;
  } else if (is5HourReady || isWeeklyAt100) {
    refreshFull = "· Ready";
    refreshMedium = "· Ready";
    refreshShort = "· Ready";
    canPrewarm = true;
    isReady = true;
  }

  let tooltip = percentage === undefined
    ? `${ariaLabel || label}: quota percentage unavailable${hasAbsolute ? "; absolute token count is estimated or incomplete" : ""}.`
    : `${ariaLabel || label}: Reported ${subtextFull}${refreshFull ? ` ${refreshFull}` : ""}. Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.`;
  if (isWeeklyExhausted) {
    tooltip = `${ariaLabel || label}: Reported ${subtextFull}; weekly quota is exhausted. Pre-warm and routing policy are blocked until fresh weekly quota data allows them.`;
  } else if (isWeeklyCapped) {
    tooltip = `${ariaLabel || label}: Reported ${subtextFull}; policy ceiling ${effectivePercentage?.toFixed(1)}% (${capReason}).`;
  } else if (label === "5Hours" && canPrewarm) {
    tooltip = `${ariaLabel || label}: Reported ${subtextFull} (Ready for policy-gated pre-warm). Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.`;
  } else if (label === "Weekly" && canPrewarm) {
    tooltip = `${ariaLabel || label}: Reported ${subtextFull} (Ready for policy-gated weekly pre-warm). Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.`;
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
    unavailable: percentage === undefined,
    tone: percentage === undefined ? "healthy" : isWeeklyExhausted ? "critical" : capacityTone(percentage),
    tooltip,
    isWeeklyExhausted,
    isWeeklyCapped,
    canPrewarm,
    isReady,
    isPrewarmed,
  };
}

/**
 * One Best / Lowest summary entry. Returns undefined when the window has no
 * usable percentage (neither an exact value nor left / max data).
 */
export function capacitySummaryEntry(
  labelFull: string,
  labelMedium: string,
  labelShort: string,
  exactPercentage: unknown,
  left: unknown,
  max: unknown,
): CapacitySummaryEntry | undefined {
  let percentage;
  if (typeof exactPercentage === "number") {
    if (Number.isFinite(exactPercentage) && exactPercentage >= 0 && exactPercentage <= 100) percentage = exactPercentage;
  } else if (exactPercentage === undefined) {
    const safeLeft = typeof left === "number" && Number.isFinite(left) && left >= 0 ? left : undefined;
    const safeMax = typeof max === "number" && Number.isFinite(max) && max >= 0 ? max : undefined;
    if (safeLeft !== undefined && safeMax !== undefined && safeMax > 0) {
      if (safeLeft <= safeMax) percentage = (safeLeft / safeMax) * 100;
    }
  }

  return typeof percentage === "number" ? { label: labelFull, labelFull, labelMedium, labelShort, percentage } : undefined;
}

export interface CapacitySummaryFilter {
  showAntigravity?: boolean;
  showClaude?: boolean;
  showCodex?: boolean;
}

/**
 * Checks if a provider service is active, authenticated, and enabled.
 * Excludes services that are offline, unauthenticated, disabled, or hidden by viewConfig.
 */
export function isServiceActiveForSummary(
  status: TokenStatus,
  service: "gemini" | "claude" | "codex",
  filter?: CapacitySummaryFilter
): boolean {
  if (filter) {
    if (service === "gemini" && filter.showAntigravity === false) return false;
    if (service === "claude" && filter.showClaude === false) return false;
    if (service === "codex" && filter.showCodex === false) return false;
  }
  const viewConfig = (status.viewConfig || (status as Record<string, unknown>).view_config) as Record<string, unknown> | undefined;
  if (viewConfig) {
    if (service === "gemini" && viewConfig.showAntigravity === false) return false;
    if (service === "claude" && viewConfig.showClaude === false) return false;
    if (service === "codex" && viewConfig.showCodex === false) return false;
  }

  if (service === "codex") {
    const s = String(status.codexStatus || (status as Record<string, unknown>).codexState || "").toLowerCase();
    if (s === "offline" || s === "unauthenticated" || s === "disabled" || s === "missing" || s === "not_logged_in") {
      return false;
    }
  } else if (service === "claude") {
    const s = String((status as Record<string, unknown>).opusStatus || (status as Record<string, unknown>).claudeStatus || "").toLowerCase();
    if (s === "offline" || s === "unauthenticated" || s === "disabled" || s === "missing" || s === "not_logged_in") {
      return false;
    }
  } else if (service === "gemini") {
    const s = String((status as Record<string, unknown>).antigravityStatus || (status as Record<string, unknown>).geminiStatus || "").toLowerCase();
    if (s === "offline" || s === "unauthenticated" || s === "disabled" || s === "missing" || s === "not_logged_in") {
      return false;
    }
  }

  return true;
}

/**
 * Rank the quota windows and pick the Best (highest remaining) and the
 * Lowest (lowest remaining). Returns null when no window has usable data.
 * Unauthenticated, offline, or disabled services are excluded from the ranking.
 */
export function calculateCapacitySummary(
  status: TokenStatus,
  filter?: CapacitySummaryFilter
): CapacitySummary | null {
  const entries: CapacitySummaryEntry[] = [];

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
