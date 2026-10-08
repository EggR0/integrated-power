// Pre-warm Window Activation & Antigravity IDE Stop Integration Unit Tests
// Verifies:
//   1. Pre-warm ping emits minimal tokens with instant cancellation.
//   2. 5-hour window transitions from Ready into active 5h rolling countdown.
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

const fullMetric = shared.buildTokenMetric("5Hours", {
  antigravityPercentage: 100,
  antigravityResetTime: resetIn(3),
  antigravityWeeklyPercentage: 100,
  antigravityWeeklyResetTime: resetIn(48),
}, "antigravity", "Gemini 5Hours", "antigravityWeekly");

assert.strictEqual(fullMetric.isReady, true);
assert.strictEqual(fullMetric.canPrewarm, true);
assert.strictEqual(shared.canTriggerPrewarm(fullMetric), true);

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

// 5. Pre-warm state transition
const initialStatus = {
  antigravityPercentage: 100,
  antigravityWeeklyPercentage: 100,
  antigravityWeeklyResetTime: resetIn(48),
};
const prewarmedStatus = shared.applyPrewarmTransition(initialStatus, "antigravity", baseTime);
assert.ok(prewarmedStatus.antigravityPercentage >= 99.9, "must retain >= 99.9% quota");
assert.ok(prewarmedStatus.antigravityResetTime, "resetTime must be populated");

const postMetric = shared.buildTokenMetric("5Hours", prewarmedStatus, "antigravity", "Gemini 5Hours", "antigravityWeekly");
assert.strictEqual(postMetric.isReady, false, "post-prewarm window must no longer be ready");
assert.strictEqual(postMetric.canPrewarm, false, "post-prewarm window cannot be prewarmed again");
assert.ok(postMetric.refreshFull.includes("Refreshes in"), "post-prewarm countdown must show active refresh");
assert.ok(postMetric.refreshFull.includes("4h 59m") || postMetric.refreshFull.includes("5h"), "post-prewarm countdown must show ~5h refresh");

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
  assert.strictEqual(result.tokensConsumed, 1);
  assert.ok(result.retainedPercentage >= 99.9);
  assert.strictEqual(dispatchedPrompt, "integrated power");
  assert.strictEqual(abortedImmediately, true, "pre-warm ping must abort immediately upon dispatch");
  assert.strictEqual(result.stopMethod, "abort_controller");

  console.log("  ok - stop selectors parity verified");
  console.log("  ok - minimal token ping and instant cancellation verified");
  console.log("  ok - 5-hour window transition verified (>99% quota retained)");
  console.log("\npre-warm trigger test passed");
}

runAsyncTests().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
