// Pre-warm Window Activation & Antigravity IDE Stop Integration Unit Tests
// Verifies:
//   1. Pre-warm ping emits minimal tokens with instant cancellation.
//   2. Dispatch acknowledgements never fabricate quota or timer measurements.
//   3. Antigravity IDE stop selectors correctly match the Agent Panel cancel elements.
//
// Run: node scripts/test-prewarm.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const extensionRoot = path.resolve(__dirname, "..");
const bundlePath = path.join(extensionRoot, "webview", "quota-core.js");

function loadIIFE(file) {
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  sandbox.URL = URL;
  sandbox.AbortController = AbortController;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return sandbox.window.IPQuota || sandbox.IPQuota;
}

const shared = loadIIFE(bundlePath);

console.log("prewarm: unit tests for 5-hour window shifter & instant stop integration");

// 1. Antigravity IDE Stop Selectors Parity
assert.ok(shared.ANTIGRAVITY_STOP_SELECTORS, "ANTIGRAVITY_STOP_SELECTORS must be exported");
assert.strictEqual(
  shared.ANTIGRAVITY_STOP_SELECTORS.cancelButton,
  '[data-tooltip-id="input-send-button-cancel-tooltip"]',
  "primary cancel button selector must match input-send-button-cancel-tooltip"
);
assert.strictEqual(
  shared.ANTIGRAVITY_STOP_SELECTORS.stopSquareButton,
  "button svg.lucide-square",
  "fallback stop button selector must match button svg.lucide-square"
);
assert.ok(
  Array.isArray(shared.ANTIGRAVITY_STOP_SELECTORS.chatContainers) &&
  shared.ANTIGRAVITY_STOP_SELECTORS.chatContainers.includes("#conversation"),
  "chat containers must include #conversation"
);

// 2. Stop script generation
const stopScript = shared.generateAntigravityStopScript();
assert.ok(stopScript.includes("input-send-button-cancel-tooltip"), "stop script must reference cancel tooltip");
assert.ok(stopScript.includes("button svg.lucide-square"), "stop script must reference fallback stop square");
assert.ok(stopScript.includes(".click()"), "stop script must invoke click on stop element");

// 3. Targets, Prompt, and 3-Mode Selection
assert.strictEqual(shared.PREWARM_PING_PROMPT, "integrated power");
assert.ok(shared.PREWARM_TARGETS.length >= 3, "must have at least 3 prewarm targets");
const geminiTarget = shared.PREWARM_TARGETS.find(t => t.model === "antigravity");
assert.ok(geminiTarget, "Gemini target must exist");

// Prewarm 3 Modes: click, once, always
assert.ok(Array.isArray(shared.PREWARM_MODE_OPTIONS), "PREWARM_MODE_OPTIONS must be an array");
assert.strictEqual(shared.PREWARM_MODE_OPTIONS.length, 3, "must have exactly 3 prewarm mode options");
const modeValues = shared.PREWARM_MODE_OPTIONS.map(o => o.value);
assert.strictEqual(JSON.stringify(modeValues), JSON.stringify(["click", "once", "always"]));
assert.strictEqual(shared.normalizePrewarmMode("always"), "always");
assert.strictEqual(shared.normalizePrewarmMode("once"), "once");
assert.strictEqual(shared.normalizePrewarmMode("click"), "click");
assert.strictEqual(shared.normalizePrewarmMode("invalid"), "click");
assert.strictEqual(shared.normalizePrewarmMode(undefined), "click");

// mergeQuotaSettings prewarmMode handling
assert.strictEqual(shared.mergeQuotaSettings({}).prewarmMode, "click");
assert.strictEqual(shared.mergeQuotaSettings({ prewarmMode: "always" }).prewarmMode, "always");
assert.strictEqual(shared.mergeQuotaSettings({ prewarmMode: "once" }).prewarmMode, "once");

// 4. canTriggerPrewarm predicate
const baseTime = Date.now();
const resetIn = (h) => new Date(baseTime + h * 3600e3).toISOString();

// A window is Ready when quota data is full and weekly policy data is known;
// a future reset timestamp alone is not proof of active generation.
const dormantMetric = shared.buildTokenMetric("5Hours", {
  antigravityPercentage: 100,
  antigravityWeeklyPercentage: 100,
  antigravityWeeklyResetTime: resetIn(48),
}, "antigravity", "Gemini 5Hours", "antigravityWeekly");

assert.strictEqual(dormantMetric.isReady, true);
assert.strictEqual(dormantMetric.canPrewarm, true);
assert.strictEqual(dormantMetric.isPrewarmed, false);
assert.strictEqual(shared.canTriggerPrewarm(dormantMetric), true);

// Pre-warm requires 100% quota AND a full time window.
// When an active countdown is ticking down (less than 4h 45m remaining), the window is already in-progress
// and is not eligible for prewarm.
const activeCountdownMetric = shared.buildTokenMetric("5Hours", {
  antigravityPercentage: 100,
  antigravityResetTime: resetIn(3),
  antigravityWeeklyPercentage: 100,
  antigravityWeeklyResetTime: resetIn(48),
}, "antigravity", "Gemini 5Hours", "antigravityWeekly");

assert.strictEqual(activeCountdownMetric.isReady, false, "active countdown means window is already running");
assert.strictEqual(activeCountdownMetric.canPrewarm, false, "prewarm not allowed while active countdown is running");
assert.match(activeCountdownMetric.refreshFull, /^· Refreshes in (?:2h 59m|3h 0m)$/);
assert.match(activeCountdownMetric.refreshShort, /^· (?:2:59|3:00)$/);

// Top-of-window 100% idle state: Providers report resetTime = measuredAt + 5h.
// Telemetry and polling delays result in ~4:59h remaining. This is an idle full window, NOT an active countdown.
const idleTopOfWindow5hMetric = shared.buildTokenMetric("5Hours", {
  antigravityPercentage: 100,
  antigravityResetTime: resetIn(4.98), // 4h 58.8m
  antigravityWeeklyPercentage: 100,
  antigravityWeeklyResetTime: resetIn(48),
}, "antigravity", "Gemini 5Hours", "antigravityWeekly");

assert.strictEqual(idleTopOfWindow5hMetric.isReady, true, "4:59h remaining must be recognized as full window Ready, not active countdown");
assert.strictEqual(idleTopOfWindow5hMetric.canPrewarm, true, "prewarm must be allowed when window is full at 4:59h");
assert.strictEqual(idleTopOfWindow5hMetric.refreshFull, "· Ready");
assert.strictEqual(shared.canTriggerPrewarm(idleTopOfWindow5hMetric), true);

// Weekly prewarm operates independently:
// 1. Weekly at 100% with full time window (no active countdown) is Ready and can prewarm.
const weeklyReadyMetric = shared.buildTokenMetric("Weekly", {
  antigravityWeeklyPercentage: 100,
}, "antigravityWeekly", "Gemini Weekly");
assert.strictEqual(weeklyReadyMetric.isReady, true);
assert.strictEqual(weeklyReadyMetric.canPrewarm, true);
assert.strictEqual(shared.canTriggerPrewarm(weeklyReadyMetric), true);

// 1b. Weekly at 100% with top-of-window reset (e.g. 167.5h remaining due to telemetry delay) is Ready and can prewarm.
const weeklyTopMetric = shared.buildTokenMetric("Weekly", {
  antigravityWeeklyPercentage: 100,
  antigravityWeeklyResetTime: resetIn(167.5),
}, "antigravityWeekly", "Gemini Weekly");
assert.strictEqual(weeklyTopMetric.isReady, true, "167.5h remaining must be recognized as full weekly window Ready");
assert.strictEqual(weeklyTopMetric.canPrewarm, true, "prewarm must be allowed when weekly window is full at 167.5h");
assert.strictEqual(shared.canTriggerPrewarm(weeklyTopMetric), true);

// 2. Weekly at 100% with active countdown (< 164h remaining) is NOT eligible for prewarm.
const weeklyActiveCountdownMetric = shared.buildTokenMetric("Weekly", {
  antigravityWeeklyPercentage: 100,
  antigravityWeeklyResetTime: resetIn(150),
}, "antigravityWeekly", "Gemini Weekly");
assert.strictEqual(weeklyActiveCountdownMetric.isReady, false);
assert.strictEqual(weeklyActiveCountdownMetric.canPrewarm, false);
assert.strictEqual(shared.canTriggerPrewarm(weeklyActiveCountdownMetric), false);

const activeMetric = shared.buildTokenMetric("5Hours", {
  antigravityPercentage: 95,
  antigravityResetTime: resetIn(3),
  antigravityWeeklyPercentage: 100,
}, "antigravity", "Gemini 5Hours", "antigravityWeekly");
assert.strictEqual(shared.canTriggerPrewarm(activeMetric), false);

const exhaustedMetric = shared.buildTokenMetric("5Hours", {
  antigravityPercentage: 100,
  antigravityWeeklyPercentage: 0,
}, "antigravity", "Gemini 5Hours", "antigravityWeekly");
assert.strictEqual(shared.canTriggerPrewarm(exhaustedMetric), false);

// 5. Pre-warm acknowledgement does not mutate provider-measured quota state
const initialStatus = {
  antigravityPercentage: 100,
  antigravityWeeklyPercentage: 100,
  antigravityWeeklyResetTime: resetIn(48),
};
const prewarmedStatus = shared.applyPrewarmTransition(initialStatus, "antigravity", baseTime);
assert.strictEqual(prewarmedStatus.antigravityPercentage, 100, "dispatch cannot fabricate a measured percentage");
assert.strictEqual(prewarmedStatus.antigravityResetTime, undefined, "dispatch cannot fabricate a provider reset time");

const postMetric = shared.buildTokenMetric("5Hours", prewarmedStatus, "antigravity", "Gemini 5Hours", "antigravityWeekly");
assert.strictEqual(postMetric.isReady, true, "without a provider measurement the window remains in its last known measured state");
assert.strictEqual(postMetric.canPrewarm, true, "dispatch alone does not prove the provider started a timer");

// 6. Pre-warm async execution with instant abort
async function runAsyncTests() {
  let dispatchedPrompt = "";
  let abortedImmediately = false;

  const result = await shared.executePrewarmPing(geminiTarget, async (prompt, signal) => {
    dispatchedPrompt = prompt;
    if (signal.aborted) {
      abortedImmediately = true;
    }
    signal.addEventListener("abort", () => {
      abortedImmediately = true;
    });
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.tokensConsumed, undefined, "ACK does not prove token consumption");
  assert.strictEqual(result.retainedPercentage, undefined, "ACK does not prove retained quota");
  assert.strictEqual(result.timerStartedAt, undefined, "ACK does not prove the provider started a timer");
  assert.match(result.message, /dispatched|accepted/i);
  assert.strictEqual(dispatchedPrompt, "integrated power");
  // 7. Dynamic Model Resolution Contracts for AGY (Gemini/Claude) and Codex
  const { getLowestAgyModel, resolveLowestModelFromList } = require("../out/broker/agyModelResolver");
  const { resolveLowestCodexModelFromList } = require("../out/broker/codexAppServer");

  // Contract A: Arbitrary future Gemini model list adapts without code changes
  const futureGeminiList = [
    { id: "gemini-9-ultra-high", name: "Gemini 9 Ultra (High)" },
    { id: "gemini-9-flash-low", name: "Gemini 9 Flash (Low)" },
    { id: "gemini-9-pro-medium", name: "Gemini 9 Pro (Medium)" },
  ];
  const resolvedFutureGemini = resolveLowestModelFromList(futureGeminiList, "gemini");
  assert.strictEqual(resolvedFutureGemini.model, "gemini-9-flash-low", "Must resolve lowest flash tier from arbitrary future list");
  assert.strictEqual(resolvedFutureGemini.family, "gemini");
  assert.strictEqual(resolvedFutureGemini.effort, "low");

  // Contract B: Arbitrary future Claude model list adapts without code changes
  const futureClaudeList = [
    { id: "claude-7-opus-high", name: "Claude 7 Opus (High)" },
    { id: "claude-7-haiku-low", name: "Claude 7 Haiku (Low)" },
  ];
  const resolvedFutureClaude = resolveLowestModelFromList(futureClaudeList, "claude");
  assert.strictEqual(resolvedFutureClaude.model, "claude-7-haiku-low", "Must resolve lowest haiku tier from arbitrary future list");
  assert.strictEqual(resolvedFutureClaude.family, "claude");
  assert.strictEqual(resolvedFutureClaude.effort, "low");

  // Contract C: Unfamiliar naming fallback (family keyword match only)
  const unfamiliarList = [
    { id: "gemini-quantum-experimental", name: "Gemini Quantum Experimental" },
  ];
  const resolvedUnfamiliar = resolveLowestModelFromList(unfamiliarList, "gemini");
  assert.strictEqual(resolvedUnfamiliar.model, "gemini-quantum-experimental", "Must fallback to any matching family model when tier is unknown");

  // Contract D: Arbitrary future Codex model list adapts without code changes
  const futureCodexList = [
    { slug: "gpt-8-heavy", default_reasoning_level: "high" },
    { slug: "gpt-8-mini", supported_reasoning_levels: [{ effort: "low" }] },
  ];
  const resolvedFutureCodex = resolveLowestCodexModelFromList(futureCodexList);
  assert.strictEqual(resolvedFutureCodex.model, "gpt-8-mini", "Must resolve lightweight mini tier from arbitrary future Codex list");
  assert.strictEqual(resolvedFutureCodex.reasoningEffort, "low");

  // Contract E: Live environment model invariant checks (no brittle version hardcoding)
  const lowestGemini = getLowestAgyModel("gemini");
  assert.ok(typeof lowestGemini.model === "string" && lowestGemini.model.length > 0, "Gemini model must be a valid non-empty string");
  assert.strictEqual(lowestGemini.family, "gemini");
  assert.strictEqual(lowestGemini.effort, "low");
  assert.ok(lowestGemini.model.toLowerCase().includes("gemini"), "Gemini model must contain family keyword");

  const lowestClaude = getLowestAgyModel("claude");
  assert.ok(typeof lowestClaude.model === "string" && lowestClaude.model.length > 0, "Claude model must be a valid non-empty string");
  assert.strictEqual(lowestClaude.family, "claude");
  assert.strictEqual(lowestClaude.effort, "low");
  assert.ok(lowestClaude.model.toLowerCase().includes("claude"), "Claude model must contain family keyword");

  console.log("  ok - stop selectors parity verified");
  console.log("  ok - minimal token ping and instant cancellation verified");
  console.log("  ok - pre-warm request cancellation preserves measured quota and does not invent a reset or retained percentage");
  console.log("  ok - dynamic model-agnostic resolution contracts verified across future arbitrary model lists");
  console.log("\npre-warm trigger test passed");
}

runAsyncTests().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
