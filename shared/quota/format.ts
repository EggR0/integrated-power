/**
 * Quota display formatting shared by the VSIX webview and the
 * control-center desktop UI. Pure functions only (no DOM, no Node).
 *
 * Text is kept provider-neutral so each program can localize or re-phrase
 * around it without forking the logic.
 */

import { toFiniteNumber } from "./capacity";

/**
 * Three-stage refresh countdown for a reset ISO timestamp.
 * Returns undefined when the value is missing or unparseable.
 *
 * - `full`:   "· Refreshes in 1h 4m" / "· Refreshes in 151h" / "· Refreshes soon"
 * - `medium`: "· 1h 4m" / "· 151h" / "· Soon"
 * - `short`:  "· 1h" / "· 151h" / "· Soon"
 */
export function formatRefreshCountdown(value: string | Date | number | null | undefined): {
  full: string;
  medium: string;
  short: string;
} | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return { full: "· Refreshes soon", medium: "· Soon", short: "· Soon" };

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffHours >= 24) {
    return {
      full: `· Refreshes in ${diffHours}h ${diffMins}m`,
      medium: `· ${diffHours}h`,
      short: `· ${diffHours}h`,
    };
  }
  if (diffHours > 0) {
    return {
      full: `· Refreshes in ${diffHours}h ${diffMins}m`,
      medium: `· ${diffHours}h ${diffMins}m`,
      short: `· ${diffHours}h`,
    };
  }
  return {
    full: `· Refreshes in ${diffMins}m`,
    medium: `· ${diffMins}m`,
    short: `· ${diffMins}m`,
  };
}

/** Whole number with the default locale grouping (display only). */
export function formatNumber(value: unknown): string {
  return new Intl.NumberFormat().format(toFiniteNumber(value));
}

/** Compact human token count: 12.34M / 123.4K / 1,234 tokens. */
export function formatTokenCount(value: unknown): string {
  const number = toFiniteNumber(value);
  if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 1 : 2)}M tokens`;
  }
  if (number >= 1_000) {
    return `${(number / 1_000).toFixed(number >= 10_000 ? 1 : 2)}K tokens`;
  }
  return `${formatNumber(number)} tokens`;
}

/**
 * Reset timestamp for direct display. Values more than 24h out keep a
 * date; closer values show time only. Returns undefined when empty.
 */
export function formatResetTime(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const diffHours = (date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (diffHours > 24) {
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}
