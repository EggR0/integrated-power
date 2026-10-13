/**
 * Cross-program quota settings shared by the VSIX webview and the
 * control-center desktop UI. Holds the schema + defaults + a merge helper.
 *
 * Persistence is intentionally NOT here: the webview stores via VSIX
 * configuration, the control-center via localStorage. Each program reads
 * its own store and runs it through `mergeQuotaSettings` so the two stay
 * behavior-identical for the keys they share.
 */

import { type PrewarmMode, normalizePrewarmMode } from "./prewarm";

export interface QuotaSettings {
  /** Background poll interval in milliseconds. */
  pollIntervalMs: number;
  /** Emit a one-time "100% full" notification + chime when all pools refill. */
  notifyOnFull: boolean;
  /** 5-hour quota pre-warm automation mode: click (manual), once (arm once), or always (continuous). */
  prewarmMode: PrewarmMode;
  /** Per-target extension used by the canonical broker settings API. */
  prewarmModes: { antigravity: PrewarmMode; opus: PrewarmMode; codex: PrewarmMode };
  /** Existing per-target/per-window notification switches, keyed without the `notifications.` prefix. */
  notifications: Record<string, boolean>;
}

export const QUOTA_NOTIFICATION_DEFAULTS: Readonly<Record<string, boolean>> = Object.freeze({
  antigravityGemini5h: true,
  antigravityGeminiWeekly: true,
  antigravityClaude5h: true,
  antigravityClaudeWeekly: true,
  chatgpt5h: true,
  chatgptWeekly: true,
  claude5h: true,
  claudeWeekly: true,
});

export const MIN_POLL_INTERVAL_MS = 1000;
export const MAX_POLL_INTERVAL_MS = 60000;
export const DEFAULT_POLL_INTERVAL_MS = 5000;

export const QUOTA_SETTINGS_DEFAULTS: Readonly<QuotaSettings> = Object.freeze({
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  notifyOnFull: true,
  prewarmMode: "click",
  prewarmModes: Object.freeze({ antigravity: "click", opus: "click", codex: "click" }),
  notifications: QUOTA_NOTIFICATION_DEFAULTS,
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
  const legacyMode = normalizePrewarmMode((source as Record<string, unknown>).prewarmMode);
  const sourceModes = (source as Record<string, unknown>).prewarmModes;
  const modes = sourceModes && typeof sourceModes === "object" ? sourceModes as Record<string, unknown> : {};
  const sourceNotifications = (source as Record<string, unknown>).notifications;
  const notifications = sourceNotifications && typeof sourceNotifications === "object" ? sourceNotifications as Record<string, unknown> : {};
  const prewarmModes = {
    antigravity: normalizePrewarmMode(modes.antigravity ?? legacyMode),
    opus: normalizePrewarmMode(modes.opus ?? legacyMode),
    codex: normalizePrewarmMode(modes.codex ?? legacyMode),
  };
  return {
    pollIntervalMs: clampPollInterval(source.pollIntervalMs),
    notifyOnFull: typeof source.notifyOnFull === "boolean" ? source.notifyOnFull : QUOTA_SETTINGS_DEFAULTS.notifyOnFull,
    prewarmMode: prewarmModes.antigravity,
    prewarmModes,
    notifications: Object.fromEntries(Object.entries(QUOTA_NOTIFICATION_DEFAULTS).map(([key, defaultValue]) => [
      key,
      typeof notifications[key] === "boolean" ? notifications[key] as boolean : defaultValue,
    ])),
  };
}
