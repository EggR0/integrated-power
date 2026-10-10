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
  toFiniteNumber,
} from "./capacity";
import { calculateEffective5HourQuota } from "./capacity";
import { formatRefreshCountdown, formatTokenCount } from "./format";

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
  percentage: number;
  /** No absolute data and no percentage: render "Unavailable". */
  unavailable: boolean;
  tone: CapacityTone;
  tooltip: string;
  isWeeklyExhausted: boolean;
  isWeeklyCapped: boolean;
  canPrewarm: boolean;
  isReady: boolean;
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
 *   - else `left > 0`      -> the remaining count alone
 *   - otherwise            -> undefined (no absolute data: do not show a fake
 *                              "0 tokens"; the caller shows "Unavailable"/"Waiting")
 * Returns undefined exactly when `buildTokenMetric` reports no absolute data
 * (max>0 || estimated || left>0 is false).
 */
export function absoluteTokenText(
  left: unknown,
  max: unknown,
  estimated: unknown,
): string | undefined {
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
  const left = toFiniteNumber(status[`${prefix}TokensLeft`]);
  const max = toFiniteNumber(status[`${prefix}Max`]);
  const exactPercentage = status[`${prefix}Percentage`];
  const estimated = status[`${prefix}EstimatedAbsolute`];
  const rawResetTime = status[`${prefix}ResetTime`] as string | undefined;

  let percentage;
  if (typeof exactPercentage === "number" && Number.isFinite(exactPercentage)) {
    percentage = clamp(exactPercentage, 0, 100);
  } else if (max > 0) {
    percentage = clamp((left / max) * 100, 0, 100);
  }

  const hasAbsolute = typeof estimated === "number" || max > 0 || left > 0;
  let normalizedPercentage = percentage ?? 0;
  let isWeeklyExhausted = false;
  let isWeeklyCapped = false;
  let capReason = "";

  // Dual-Window Quota Synchronization: 5Hours constrained by Weekly
  if (label === "5Hours" && pairedWeeklyPrefix && percentage !== undefined) {
    const weeklyExact = status[`${pairedWeeklyPrefix}Percentage`];
    const weeklyLeft = toFiniteNumber(status[`${pairedWeeklyPrefix}TokensLeft`]);
    const weeklyMax = toFiniteNumber(status[`${pairedWeeklyPrefix}Max`]);
    let weeklyPct = typeof weeklyExact === "number" && Number.isFinite(weeklyExact)
      ? clamp(weeklyExact, 0, 100)
      : weeklyMax > 0 ? clamp((weeklyLeft / weeklyMax) * 100, 0, 100) : undefined;

    if (weeklyPct !== undefined) {
      const sync = calculateEffective5HourQuota(normalizedPercentage, weeklyPct, prefix);
      normalizedPercentage = sync.effectivePct;
      isWeeklyExhausted = sync.isWeeklyExhausted;
      isWeeklyCapped = sync.isWeeklyCapped;
      if (isWeeklyExhausted) {
        capReason = "Weekly exhausted";
      } else if (isWeeklyCapped) {
        capReason = `Weekly capped (${weeklyPct.toFixed(1)}% × ${sync.K})`;
      }
    }
  }

  const displayPercentage = isWeeklyExhausted ? 0.0 : normalizedPercentage;
  const mainText = (hasAbsolute || percentage !== undefined) ? `${displayPercentage.toFixed(2)}%` : "Unavailable";

  let subtextFull = "Waiting for quota data";
  let subtextMedium = "Waiting";
  let subtextShort = "Waiting";
  if (hasAbsolute || percentage !== undefined) {
    subtextFull = `${normalizedPercentage.toFixed(2)}% remaining`;
    subtextMedium = `${normalizedPercentage.toFixed(2)}%`;
    subtextShort = `${normalizedPercentage.toFixed(1)}%`;
  }

  let effectiveResetTime = rawResetTime;
  if (isWeeklyExhausted && pairedWeeklyPrefix) {
    const pairedResetTime = status[`${pairedWeeklyPrefix}ResetTime`] as string | undefined;
    if (pairedResetTime) {
      effectiveResetTime = pairedResetTime;
    }
  }

  const countdown = formatRefreshCountdown(effectiveResetTime);
  const is5HourReady = label === "5Hours" && (hasAbsolute || percentage !== undefined) && normalizedPercentage >= 99.95 && !isWeeklyExhausted;
  let refreshFull = "";
  let refreshMedium = "";
  let refreshShort = "";
  let canPrewarm = false;
  let isReady = false;

  if (countdown) {
    refreshFull = countdown.full;
    refreshMedium = countdown.medium || countdown.short;
    refreshShort = countdown.short;
  } else if (is5HourReady) {
    refreshFull = "· Ready";
    refreshMedium = "· Ready";
    refreshShort = "· Ready";
  }

  if (is5HourReady) {
    canPrewarm = true;
    isReady = true;
  }

  let tooltip = `${ariaLabel || label}: ${subtextFull}${refreshFull ? ` ${refreshFull}` : ""}. Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.`;
  if (isWeeklyExhausted) {
    tooltip = `${ariaLabel || label}: 0.00% remaining (Weekly quota is exhausted${refreshFull ? ` · ${refreshFull}` : ""}). All 5-hour capacity is locked until weekly reset.`;
  } else if (isWeeklyCapped) {
    tooltip = `${ariaLabel || label}: ${subtextFull} (${capReason}). 5-hour capacity is constrained by remaining weekly budget.`;
  } else if (is5HourReady && !countdown) {
    tooltip = `${ariaLabel || label}: ${subtextFull} (Ready · Timer starts on first request). Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.`;
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
    unavailable: percentage === undefined && !hasAbsolute,
    tone: capacityTone(normalizedPercentage),
    tooltip,
    isWeeklyExhausted,
    isWeeklyCapped,
    canPrewarm,
    isReady,
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
  if (typeof exactPercentage === "number" && Number.isFinite(exactPercentage)) {
    percentage = clamp(exactPercentage, 0, 100);
  } else {
    const safeLeft = toFiniteNumber(left);
    const safeMax = toFiniteNumber(max);
    if (safeMax > 0) {
      percentage = clamp((safeLeft / safeMax) * 100, 0, 100);
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
    const g5 = capacitySummaryEntry("Gemini 5Hours", "Gemini 5Hours", "Gemini 5H", status.antigravityPercentage, status.antigravityTokensLeft, status.antigravityMax);
    const gw = capacitySummaryEntry("Gemini Weekly", "Gemini Weekly", "Gemini W", status.antigravityWeeklyPercentage, status.antigravityWeeklyTokensLeft, status.antigravityWeeklyMax);
    if (g5) entries.push(g5);
    if (gw) entries.push(gw);
  }

  if (isServiceActiveForSummary(status, "claude", filter)) {
    const c5 = capacitySummaryEntry("Claude 5Hours", "Claude 5Hours", "Claude 5H", status.opusPercentage, status.opusTokensLeft, status.opusMax);
    const cw = capacitySummaryEntry("Claude Weekly", "Claude Weekly", "Claude W", status.opusWeeklyPercentage, status.opusWeeklyTokensLeft, status.opusWeeklyMax);
    if (c5) entries.push(c5);
    if (cw) entries.push(cw);
  }

  if (isServiceActiveForSummary(status, "codex", filter)) {
    const x5 = capacitySummaryEntry("ChatGPT 5Hours", "ChatGPT 5Hours", "ChatGPT 5H", status.codexPercentage, status.codexTokensLeft, status.codexMax);
    const xw = capacitySummaryEntry("ChatGPT Weekly", "ChatGPT Weekly", "ChatGPT W", status.codexWeeklyPercentage, status.codexWeeklyTokensLeft, status.codexWeeklyMax);
    if (x5) entries.push(x5);
    if (xw) entries.push(xw);
  }

  if (!entries.length) {
    return null;
  }

  const sorted = entries.slice().sort((a, b) => a.percentage - b.percentage);
  return { entries, lowest: sorted[0], strongest: sorted[sorted.length - 1] };
}
