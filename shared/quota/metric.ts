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
  const refreshFull = countdown ? countdown.full : "";
  const refreshMedium = countdown ? (countdown.medium || countdown.short) : "";
  const refreshShort = countdown ? countdown.short : "";

  let tooltip = `${ariaLabel || label}: ${subtextFull}${refreshFull ? ` ${refreshFull}` : ""}. Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.`;
  if (isWeeklyExhausted) {
    tooltip = `${ariaLabel || label}: 0.00% remaining (Weekly quota is exhausted${refreshFull ? ` · ${refreshFull}` : ""}). All 5-hour capacity is locked until weekly reset.`;
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
    unavailable: percentage === undefined && !hasAbsolute,
    tone: capacityTone(normalizedPercentage),
    tooltip,
    isWeeklyExhausted,
    isWeeklyCapped,
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

/**
 * Rank the six quota windows and pick the Best (highest remaining) and the
 * Lowest (lowest remaining). Returns null when no window has usable data.
 * The DOM rendering (the summary pills) stays in each program.
 */
export function calculateCapacitySummary(status: TokenStatus): CapacitySummary | null {
  const entries = [
    capacitySummaryEntry("Gemini 5Hours", "Gemini 5Hours", "Gemini 5H", status.antigravityPercentage, status.antigravityTokensLeft, status.antigravityMax),
    capacitySummaryEntry("Gemini Weekly", "Gemini Weekly", "Gemini W", status.antigravityWeeklyPercentage, status.antigravityWeeklyTokensLeft, status.antigravityWeeklyMax),
    capacitySummaryEntry("Opus 5Hours", "Opus 5Hours", "Opus 5H", status.opusPercentage, status.opusTokensLeft, status.opusMax),
    capacitySummaryEntry("Opus Weekly", "Opus Weekly", "Opus W", status.opusWeeklyPercentage, status.opusWeeklyTokensLeft, status.opusWeeklyMax),
    capacitySummaryEntry("ChatGPT 5Hours", "ChatGPT 5Hours", "ChatGPT 5H", status.codexPercentage, status.codexTokensLeft, status.codexMax),
    capacitySummaryEntry("ChatGPT Weekly", "ChatGPT Weekly", "ChatGPT W", status.codexWeeklyPercentage, status.codexWeeklyTokensLeft, status.codexWeeklyMax),
  ].filter((entry): entry is CapacitySummaryEntry => entry !== undefined);

  if (!entries.length) {
    return null;
  }

  const sorted = entries.slice().sort((a, b) => a.percentage - b.percentage);
  return { entries, lowest: sorted[0], strongest: sorted[sorted.length - 1] };
}
