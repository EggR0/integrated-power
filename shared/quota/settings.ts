/**
 * Cross-program quota settings shared by the VSIX webview and the
 * control-center desktop UI. Holds the schema + defaults + a merge helper.
 *
 * Persistence is intentionally NOT here: the webview stores via VSIX
 * configuration, the control-center via localStorage. Each program reads
 * its own store and runs it through `mergeQuotaSettings` so the two stay
 * behavior-identical for the keys they share.
 */

export interface QuotaSettings {
  /** Background poll interval in milliseconds. */
  pollIntervalMs: number;
  /** Emit a one-time "100% full" notification + chime when all pools refill. */
  notifyOnFull: boolean;
}

export const MIN_POLL_INTERVAL_MS = 1000;
export const MAX_POLL_INTERVAL_MS = 60000;
export const DEFAULT_POLL_INTERVAL_MS = 5000;

export const QUOTA_SETTINGS_DEFAULTS: Readonly<QuotaSettings> = Object.freeze({
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  notifyOnFull: true,
});

export function clampPollInterval(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(Math.max(Math.round(number), MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS);
}

/**
 * Merge a partial, possibly-untrusted settings object (from localStorage or
 * a remote payload) over the defaults, coercing each field to its type.
 */
export function mergeQuotaSettings(partial: Partial<QuotaSettings> | null | undefined): QuotaSettings {
  const source = partial && typeof partial === "object" ? partial : {};
  return {
    pollIntervalMs: clampPollInterval(source.pollIntervalMs),
    notifyOnFull: typeof source.notifyOnFull === "boolean" ? source.notifyOnFull : QUOTA_SETTINGS_DEFAULTS.notifyOnFull,
  };
}
