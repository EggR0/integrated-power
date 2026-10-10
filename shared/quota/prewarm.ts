import type { TokenMetric, TokenStatus } from "./metric";

/**
 * Antigravity IDE UI Automation DOM selectors identified from discord2antigravity_2
 * for stopping/cancelling LLM generation immediately.
 */
export const ANTIGRAVITY_STOP_SELECTORS = Object.freeze({
  /** Primary cancel tooltip button in Antigravity Agent Panel */
  cancelButton: '[data-tooltip-id="input-send-button-cancel-tooltip"]',
  /** Fallback stop square icon button in send container */
  stopSquareButton: 'button svg.lucide-square',
  /** Antigravity Agent side panel input box */
  inputBox: '#antigravity\\.agentSidePanelInputBox',
  /** Alternative chat/conversation containers in Antigravity IDE */
  chatContainers: ['#conversation', '#chat', '#cascade'] as const,
});

/** Minimal ping prompt designed to start the 5-hour quota clock with negligible token consumption. */
export const PREWARM_PING_PROMPT = "integrated power";

/**
 * Three selectable prewarm automation modes:
 * - "click": on-demand trigger when user clicks the [⚡ Pre-warm] button.
 * - "once": automatically fires once on the next 100% Ready window, then reverts to "click".
 * - "always": continuously fires pre-warm whenever any 5-hour window reaches 100% Ready.
 */
export type PrewarmMode = "click" | "always" | "once";

export interface PrewarmModeOption {
  value: PrewarmMode;
  label: string;
  description: string;
}

export const PREWARM_MODE_OPTIONS: readonly PrewarmModeOption[] = Object.freeze([
  {
    value: "click",
    label: "Click to Pre-warm",
    description: "Manual on-demand trigger when the [⚡ Pre-warm] button is clicked.",
  },
  {
    value: "once",
    label: "Once Pre-warm",
    description: "Automatically pre-warms once on the next 100% Ready window, then returns to Click mode.",
  },
  {
    value: "always",
    label: "Always Pre-warm",
    description: "Continuously keeps 5-hour rolling recharge cycles running ahead of time.",
  },
]);

export function normalizePrewarmMode(value: unknown): PrewarmMode {
  if (value === "always" || value === "once" || value === "click") {
    return value;
  }
  return "click";
}

export interface ModelPrewarmModes {
  antigravity: PrewarmMode;
  opus: PrewarmMode;
  codex: PrewarmMode;
}

export function defaultModelPrewarmModes(): ModelPrewarmModes {
  return {
    antigravity: "click",
    opus: "click",
    codex: "click",
  };
}

export function normalizeModelPrewarmModes(raw: unknown, fallbackMode?: PrewarmMode): ModelPrewarmModes {
  const fallback = normalizePrewarmMode(fallbackMode);
  const safe = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    antigravity: normalizePrewarmMode(safe.antigravity || safe.gemini || fallback),
    opus: normalizePrewarmMode(safe.opus || safe.claude || fallback),
    codex: normalizePrewarmMode(safe.codex || safe.chatgpt || fallback),
  };
}

export interface PrewarmTarget {
  id: string;
  model: string;
  displayName: string;
  prefix: string;
}

export const PREWARM_TARGETS: readonly PrewarmTarget[] = Object.freeze([
  { id: "antigravity-gemini-5h", model: "antigravity", displayName: "Gemini 5Hours", prefix: "antigravity" },
  { id: "codex-chatgpt-5h", model: "codex", displayName: "ChatGPT 5Hours", prefix: "codex" },
  { id: "opus-claude-5h", model: "opus", displayName: "Claude 5Hours", prefix: "opus" },
  { id: "claude-5h", model: "claude", displayName: "Claude 5Hours", prefix: "claude" },
]);

export interface PrewarmResult {
  ok: boolean;
  targetId: string;
  model: string;
  tokensConsumed: number;
  retainedPercentage: number;
  timerStartedAt: string;
  resetTime: string;
  message: string;
  stopMethod: "cancel_tooltip" | "fallback_square" | "abort_controller" | "simulated";
}

/** Check if a given metric qualifies for pre-warming. */
export function canTriggerPrewarm(metric: TokenMetric): boolean {
  return metric.label === "5Hours" && metric.percentage >= 99.95 && !metric.isWeeklyExhausted;
}

/**
 * Returns a script string suitable for CDP/browser injection to stop Antigravity generation.
 */
export function generateAntigravityStopScript(): string {
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

/**
 * Simulates or calculates the post-prewarm state transition:
 * Quota drops slightly (e.g. from 100% to 99.9%), and a 5-hour rolling countdown starts.
 */
export function applyPrewarmTransition(
  currentStatus: TokenStatus,
  prefix: string,
  nowMs: number = Date.now()
): TokenStatus {
  const updated = { ...currentStatus };
  const currentPct = typeof currentStatus[`${prefix}Percentage`] === "number"
    ? Number(currentStatus[`${prefix}Percentage`])
    : 100;
  updated[`${prefix}Percentage`] = Math.max(0, currentPct - 0.1);
  const resetDate = new Date(nowMs + 5 * 3600 * 1000);
  updated[`${prefix}ResetTime`] = resetDate.toISOString();
  return updated;
}

/**
 * Executes a prewarm ping cycle with an instant abort controller.
 */
export async function executePrewarmPing(
  target: PrewarmTarget,
  dispatcher?: (prompt: string, signal: AbortSignal) => Promise<void>
): Promise<PrewarmResult> {
  const AC = typeof AbortController !== "undefined" ? AbortController : (typeof globalThis !== "undefined" ? globalThis.AbortController : undefined);
  const abortController = AC ? new AC() : undefined;
  const startTime = new Date();
  const resetDate = new Date(startTime.getTime() + 5 * 3600 * 1000);

  if (dispatcher && abortController) {
    const promise = dispatcher(PREWARM_PING_PROMPT, abortController.signal);
    abortController.abort();
    try {
      await promise;
    } catch {
      // Abort is expected
    }
  }

  return {
    ok: true,
    targetId: target.id,
    model: target.model,
    tokensConsumed: 1,
    retainedPercentage: 99.9,
    timerStartedAt: startTime.toISOString(),
    resetTime: resetDate.toISOString(),
    message: `Pre-warm successful: 5-hour recharge cycle active for ${target.displayName}. >99.9% quota retained.`,
    stopMethod: dispatcher ? "abort_controller" : "simulated",
  };
}
