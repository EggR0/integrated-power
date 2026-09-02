/**
 * Quota capacity calculation shared by the VSIX webview and the
 * control-center desktop UI. Pure functions only (no DOM, no Node).
 */

/**
 * Per-model ratio K: how much of a 5-hour window the remaining weekly
 * budget effectively allows. Weekly ceiling = weeklyPct * K.
 */
export const K_CAPACITY_RATIOS = Object.freeze({
  opus: 4.5,
  antigravity: 5.0,
  codex: 4.0,
  claude: 4.5,
});

export const K_DEFAULT_RATIO = 4.5;

/** Healthy > 35%, Caution 15–35%, Limited <= 15%. */
export type CapacityTone = "critical" | "warning" | "healthy";

export interface EffectiveQuota {
  /** Percentage to display for the 5-hour window. */
  effectivePct: number;
  /** Weekly pool is at 0%: the 5-hour window is locked. */
  isWeeklyExhausted: boolean;
  /** 5-hour value is capped by the weekly budget (not exhausted). */
  isWeeklyCapped: boolean;
  K: number;
}

export function toFiniteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function clamp(value: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : min;
}

export function capacityTone(percentage: number): CapacityTone {
  return percentage <= 15 ? "critical" : percentage <= 35 ? "warning" : "healthy";
}

/**
 * Dual-window quota synchronization: constrain the 5-hour percentage with
 * the remaining weekly budget (`weeklyPct * K`).
 *
 * @param fiveHourPct raw 5-hour window percentage (0–100)
 * @param weeklyPct raw weekly window percentage (0–100)
 * @param prefix model key used for the K lookup ("antigravity", "opus", "codex")
 */
export function calculateEffective5HourQuota(
  fiveHourPct: number,
  weeklyPct: number,
  prefix: string,
): EffectiveQuota {
  const modelKey = prefix.toLowerCase().replace(/weekly/i, "");
  const K = K_CAPACITY_RATIOS[modelKey as keyof typeof K_CAPACITY_RATIOS] ?? K_DEFAULT_RATIO;

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
