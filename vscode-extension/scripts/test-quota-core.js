// Parity tests for shared/quota (IIFE bundle -> window.IPQuota).
//
// Two goals:
//   1. The shared module behaves exactly as the ORIGINAL webview
//      implementations (extracted from webview/main.js and executed in a
//      sandbox) — the "same input, same output on both programs" proof
//      required by docs/reuse-map.md.
//   2. The control-center (which imports the same TypeScript source via the
//      vite alias @shared/quota) gets the identical functions, so the two
//      programs cannot drift.
//
// Run: node scripts/test-quota-core.js   (from vscode-extension/)
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const extensionRoot = path.resolve(__dirname, "..");
const bundlePath = path.join(extensionRoot, "webview", "quota-core.js");
const ccMain = path.resolve(extensionRoot, "..", "control-center", "src", "main.js");

function loadIIFE(file) {
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  // The shared module is browser-targeted; provide the browser globals the
  // Node vm sandbox lacks (URL for external-provider validation).
  sandbox.URL = URL;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return sandbox.window.IPQuota || sandbox.IPQuota;
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`  FAIL - ${name}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
console.log("quota-core: shared module unit tests");
const shared = loadIIFE(bundlePath);

test("K ratios frozen and correct", () => {
  assert.strictEqual(shared.K_CAPACITY_RATIOS.antigravity, 5.0);
  assert.strictEqual(shared.K_CAPACITY_RATIOS.opus, 4.5);
  assert.strictEqual(shared.K_CAPACITY_RATIOS.codex, 4.0);
  assert.strictEqual(shared.K_DEFAULT_RATIO, 4.5);
  assert.ok(Object.isFrozen(shared.K_CAPACITY_RATIOS));
});

test("weekly exhausted locks 5h to 0", () => {
  const r = shared.calculateEffective5HourQuota(80, 0, "codex");
  assert.strictEqual(r.effectivePct, 0);
  assert.strictEqual(r.isWeeklyExhausted, true);
  assert.strictEqual(r.isWeeklyCapped, true);
});

test("weekly caps 5h (codex K=4.0: 20% weekly -> 80% ceiling)", () => {
  const r = shared.calculateEffective5HourQuota(100, 20, "codex");
  assert.strictEqual(r.effectivePct, 80);
  assert.strictEqual(r.isWeeklyCapped, true);
  assert.strictEqual(r.isWeeklyExhausted, false);
});

test("no cap when weekly ceiling is above 5h", () => {
  const r = shared.calculateEffective5HourQuota(40, 100, "antigravity");
  assert.strictEqual(r.effectivePct, 40);
  assert.strictEqual(r.isWeeklyCapped, false);
});

test("unknown prefix falls back to K=4.5", () => {
  const r = shared.calculateEffective5HourQuota(100, 10, "mystery");
  assert.strictEqual(r.effectivePct, 45);
  assert.strictEqual(r.K, 4.5);
});

test("weekly substring in model key is stripped (matches original behavior)", () => {
  const a = shared.calculateEffective5HourQuota(100, 10, "codexweekly");
  assert.strictEqual(a.K, 4.0);
  // Dotted ids are NOT normalized (same as the original webview): they fall
  // back to the default K.
  const b = shared.calculateEffective5HourQuota(100, 10, "codex.weekly");
  assert.strictEqual(b.K, 4.5);
});

test("capacityTone thresholds (<=15 critical, <=35 warning, else healthy)", () => {
  assert.strictEqual(shared.capacityTone(0), "critical");
  assert.strictEqual(shared.capacityTone(15), "critical");
  assert.strictEqual(shared.capacityTone(15.01), "warning");
  assert.strictEqual(shared.capacityTone(35), "warning");
  assert.strictEqual(shared.capacityTone(35.01), "healthy");
});

test("clamp / toFiniteNumber", () => {
  assert.strictEqual(shared.clamp(150, 0, 100), 100);
  assert.strictEqual(shared.clamp(-5, 0, 100), 0);
  assert.strictEqual(shared.clamp(NaN, 0, 100), 0);
  assert.strictEqual(shared.toFiniteNumber("12"), 12);
  assert.strictEqual(shared.toFiniteNumber(-3), 0);
  assert.strictEqual(shared.toFiniteNumber(undefined), 0);
});

test("formatRefreshCountdown stages", () => {
  // Offsets avoid exact minute/hour boundaries: the value is computed at
  // call time, so an exact boundary could tick between the two reads.
  const soon = shared.formatRefreshCountdown(new Date(Date.now() + 5 * 60 * 1000 + 30e3).toISOString());
  assert.strictEqual(soon.full, "· Refreshes in 5m");
  assert.strictEqual(soon.short, "· 5m");

  const hourish = shared.formatRefreshCountdown(new Date(Date.now() + (1 * 60 + 4) * 60 * 1000 + 30e3).toISOString());
  assert.strictEqual(hourish.full, "· Refreshes in 1h 4m");
  assert.strictEqual(hourish.medium, "· 1h 4m");
  assert.strictEqual(hourish.short, "· 1h");

  const far = shared.formatRefreshCountdown(new Date(Date.now() + (26 * 60 + 10) * 60 * 1000 + 30e3).toISOString());
  assert.strictEqual(far.full, "· Refreshes in 26h 10m");
  assert.strictEqual(far.medium, "· 26h");

  const past = shared.formatRefreshCountdown(new Date(Date.now() - 60 * 1000).toISOString());
  assert.strictEqual(past.full, "· Refreshes soon");

  assert.strictEqual(shared.formatRefreshCountdown("nonsense"), undefined);
  assert.strictEqual(shared.formatRefreshCountdown(undefined), undefined);
});

test("settings merge + coercion", () => {
  assert.strictEqual(shared.mergeQuotaSettings({}).pollIntervalMs, 5000);
  assert.strictEqual(shared.mergeQuotaSettings({ pollIntervalMs: 50 }).pollIntervalMs, 1000);
  assert.strictEqual(shared.mergeQuotaSettings({ pollIntervalMs: 1e6 }).pollIntervalMs, 60000);
  assert.strictEqual(shared.mergeQuotaSettings({ pollIntervalMs: "abc" }).pollIntervalMs, 5000);
  assert.strictEqual(shared.mergeQuotaSettings({ notifyOnFull: false }).notifyOnFull, false);
  assert.strictEqual(shared.mergeQuotaSettings(null).notifyOnFull, true);
});

// ---------------------------------------------------------------------------
console.log("quota-core: parity with ORIGINAL webview implementations");
// The golden snapshot (scripts/quota-golden.js) captured the original webview
// functions BEFORE they were removed from main.js, so this proof survives the
// refactor. It runs in a vm sandbox, exactly like a browser global scope.
const golden = require("./quota-golden.js");
const names = [
  "toFiniteNumber", "clamp", "capacityTone", "calculateEffective5HourQuota",
  "formatRefreshCountdown", "formatNumber", "formatTokenCount", "formatResetTime",
  "buildTokenMetric", "capacitySummaryEntry",
];
const original = {};
for (const name of names) original[name] = golden[name];

const rand = (min, max) => min + Math.random() * (max - min);
const prefixes = ["antigravity", "opus", "codex", "claude", "unknown"];

test("calculateEffective5HourQuota identical over 2000 random inputs", () => {
  for (let i = 0; i < 2000; i++) {
    const five = rand(0, 100);
    const weekly = Math.random() < 0.2 ? 0 : rand(0, 100);
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const a = original.calculateEffective5HourQuota(five, weekly, prefix);
    const b = shared.calculateEffective5HourQuota(five, weekly, prefix);
    assert.deepStrictEqual(
      { effectivePct: b.effectivePct, isWeeklyExhausted: b.isWeeklyExhausted, isWeeklyCapped: b.isWeeklyCapped, K: b.K },
      { effectivePct: a.effectivePct, isWeeklyExhausted: a.isWeeklyExhausted, isWeeklyCapped: a.isWeeklyCapped, K: a.K },
      `mismatch at five=${five} weekly=${weekly} prefix=${prefix}`,
    );
  }
});

test("formatRefreshCountdown identical over fixed clock samples", () => {
  // Offsets in ms, no sub-second / exact-boundary values: the two
  // implementations are called at slightly different instants, so a
  // boundary sample could legitimately differ.
  const samples = [-60e3, -3600e3, 30e3, 1234e3, 3690e3, 86460e3, 350000e3];
  for (const offset of samples) {
    const iso = new Date(Date.now() + offset).toISOString();
    // Compare by value: the original runs in a vm sandbox, so its objects
    // carry the sandbox realm's prototype (deepStrictEqual would reject them).
    assert.strictEqual(JSON.stringify(shared.formatRefreshCountdown(iso)), JSON.stringify(original.formatRefreshCountdown(iso)), `offset=${offset}`);
  }
  assert.strictEqual(shared.formatRefreshCountdown("bad"), original.formatRefreshCountdown("bad"));
});

test("toFiniteNumber/clamp/capacityTone identical over random inputs", () => {
  for (let i = 0; i < 500; i++) {
    const v = Math.random() < 0.5 ? rand(-10, 200) : ["x", null, NaN, "12.5"][i % 4];
    assert.strictEqual(shared.toFiniteNumber(v), original.toFiniteNumber(v));
    assert.strictEqual(shared.clamp(v, 0, 100), original.clamp(v, 0, 100));
  }
  for (const p of [0, 14.9, 15, 15.1, 34.9, 35, 35.1, 100]) {
    assert.strictEqual(shared.capacityTone(p), original.capacityTone(p));
  }
});

test("formatTokenCount / formatResetTime / formatNumber identical", () => {
  for (const v of [0, 999, 1000, 12345, 999999, 1234567, 123456789]) {
    assert.strictEqual(shared.formatTokenCount(v), original.formatTokenCount(v));
    assert.strictEqual(shared.formatNumber(v), original.formatNumber(v));
  }
  const future23h = new Date(Date.now() + 23 * 3600e3).toISOString();
  const future3d = new Date(Date.now() + 3 * 86400e3).toISOString();
  assert.strictEqual(shared.formatResetTime(future23h), original.formatResetTime(future23h));
  assert.strictEqual(shared.formatResetTime(future3d), original.formatResetTime(future3d));
  assert.strictEqual(shared.formatResetTime("weird"), original.formatResetTime("weird"));
});

// ---------------------------------------------------------------------------
console.log("quota-core: P3 metric parity (buildTokenMetric / capacitySummaryEntry / calculateCapacitySummary)");

test("buildTokenMetric identical over 500 random windows (A4 availability + A7 tooltip)", () => {
  // Fixed clock so the refresh countdown (Date.now inside) is identical
  // between the golden (vm) and the shared bundle on the same tick.
  const base = Date.now();
  const resetIn = (hours) => new Date(base + hours * 3600e3).toISOString();
  const labels = ["5Hours", "Weekly"];
  for (let i = 0; i < 500; i++) {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const hasPct = Math.random() < 0.7;
    const max = Math.random() < 0.5 ? rand(0, 1e6) : 0;
    const left = Math.random() < 0.5 ? rand(0, max || 1e6) : 0;
    const estimated = Math.random() < 0.3 ? rand(0, 1e6) : undefined;
    const status = {};
    for (const p of [prefix, `${prefix}Weekly`]) {
      status[`${p}Percentage`] = hasPct ? rand(0, 100) : (Math.random() < 0.2 ? 0 : undefined);
      status[`${p}TokensLeft`] = p === prefix ? left : rand(0, 1e6);
      status[`${p}Max`] = p === prefix ? max : rand(0, 1e6);
      status[`${p}EstimatedAbsolute`] = p === prefix ? estimated : undefined;
      status[`${p}ResetTime`] = resetIn(rand(0.5, 200));
    }
    const label = labels[Math.floor(Math.random() * labels.length)];
    const paired = label === "5Hours" ? `${prefix}Weekly` : undefined;
    const aria = `Aria ${prefix} ${label}`;
    const a = original.buildTokenMetric(label, status, prefix, aria, paired);
    const b = shared.buildTokenMetric(label, status, prefix, aria, paired);
    // JSON compare: the bundle runs in a vm realm, so cross-realm plain
    // objects fail deepStrictEqual on prototype (same reason the
    // formatRefreshCountdown test compares by value). Key order is fixed by
    // the source, so stringify equality is a full-field comparison.
    assert.strictEqual(JSON.stringify(b), JSON.stringify(a), `mismatch at prefix=${prefix} label=${label}`);
  }
});

test("buildTokenMetric: exhausted/capped tooltips + weekly reset swap (A7 branches)", () => {
  const base = Date.now();
  const t5 = new Date(base + 2 * 3600e3).toISOString();
  const tW = new Date(base + 40 * 3600e3).toISOString();
  // weekly=0 → exhausted: 0.00%, tooltip explains the lock, reset follows weekly
  const exhausted = shared.buildTokenMetric("5Hours", {
    codexPercentage: 90, codexTokensLeft: 0, codexMax: 0, codexResetTime: t5,
    codexWeeklyPercentage: 0, codexWeeklyTokensLeft: 0, codexWeeklyMax: 0, codexWeeklyResetTime: tW,
  }, "codex", "ChatGPT 5Hours", "codexWeekly");
  assert.strictEqual(exhausted.percentage, 0);
  assert.strictEqual(exhausted.isWeeklyExhausted, true);
  assert.ok(exhausted.tooltip.includes("exhausted"));
  assert.ok(exhausted.refreshFull.includes("40h")); // swapped to weekly reset

  // weekly=20 → capped: 5h=100 capped at 100×? codex K=4 → 80%
  const capped = shared.buildTokenMetric("5Hours", {
    codexPercentage: 100, codexTokensLeft: 0, codexMax: 0, codexResetTime: t5,
    codexWeeklyPercentage: 20, codexWeeklyTokensLeft: 0, codexWeeklyMax: 0, codexWeeklyResetTime: tW,
  }, "codex", "ChatGPT 5Hours", "codexWeekly");
  assert.strictEqual(capped.percentage, 80);
  assert.strictEqual(capped.isWeeklyCapped, true);
  assert.ok(capped.tooltip.includes("Weekly capped"));

  // no absolute data, no percentage → Unavailable
  const none = shared.buildTokenMetric("Weekly", {}, "codex", "x", undefined);
  assert.strictEqual(none.unavailable, true);
  assert.strictEqual(none.mainText, "Unavailable");

  // left/max derived percentage when no explicit percentage
  const derived = shared.buildTokenMetric("Weekly", { opusTokensLeft: 50, opusMax: 200 }, "opus");
  assert.strictEqual(derived.percentage, 25);
});

test("capacitySummaryEntry identical over 300 samples (A5)", () => {
  for (let i = 0; i < 300; i++) {
    const pct = Math.random() < 0.6 ? rand(0, 100) : (Math.random() < 0.2 ? 0 : undefined);
    const max = Math.random() < 0.5 ? rand(0, 1e6) : 0;
    const left = Math.random() < 0.5 ? rand(0, max || 1e6) : 0;
    const a = original.capacitySummaryEntry("F", "M", "S", pct, left, max);
    const b = shared.capacitySummaryEntry("F", "M", "S", pct, left, max);
    assert.strictEqual(JSON.stringify(b), JSON.stringify(a), `mismatch at pct=${pct} left=${left} max=${max}`);
  }
});

test("calculateCapacitySummary picks best/lowest across the six windows (A5)", () => {
  const s = {
    antigravityPercentage: 55, antigravityWeeklyPercentage: 92,
    opusPercentage: 100, opusWeeklyPercentage: 100,
    codexPercentage: 100, codexWeeklyPercentage: 71,
    // no absolute data anywhere → percentages come from the *Percentage fields
  };
  const r = shared.calculateCapacitySummary(s);
  assert.strictEqual(r.entries.length, 6);
  // Three windows tie at 100%; the stable sort keeps source order, so the
  // strongest is the LAST 100 in entry order (ChatGPT 5Hours).
  assert.strictEqual(r.strongest.label, "ChatGPT 5Hours");
  assert.strictEqual(r.lowest.label, "Gemini 5Hours");
  assert.strictEqual(r.lowest.percentage, 55);
  assert.strictEqual(shared.calculateCapacitySummary({}), null);
});

test("absoluteTokenText: left/max, estimated fallback, left-only, none (A4)", () => {
  assert.strictEqual(shared.absoluteTokenText(500, 1000, undefined), "500 tokens / 1.00K tokens");
  assert.strictEqual(shared.absoluteTokenText(1234567, 2000000, undefined), "1.23M tokens / 2.00M tokens");
  assert.strictEqual(shared.absoluteTokenText(0, 0, 1234567), "1.23M tokens");
  assert.strictEqual(shared.absoluteTokenText(42, 0, undefined), "42 tokens");
  assert.strictEqual(shared.absoluteTokenText(0, 0, undefined), undefined);
  assert.strictEqual(shared.absoluteTokenText(null, 0, NaN), undefined);
});

// ---------------------------------------------------------------------------
console.log("quota-core: P4 local-server badge parity (localServerBadge)");

// The IDE webview's uncommitted local-compute badge logic (renderLocalComputeStatus)
// is the reference. We re-derive it inline and check the shared module agrees on
// every branch: loaded model -> Active·{model}; up/idle -> {program} (Idle); else Offline.
function ideWipBadge(endpointHealth, loadedModels, programName) {
  const health = endpointHealth || "offline";
  const models = Array.isArray(loadedModels) ? loadedModels : [];
  const hasLoadedModels = models.length > 0;
  const isServerRunning = health === "ok" || health === "idle";
  let text;
  if (hasLoadedModels) text = `Active · ${models[0]}`;
  else if (isServerRunning) text = `${programName || "Server"} (Idle)`;
  else text = "Offline";
  return { text, hasLoadedModels, isServerRunning };
}

test("localServerBadge matches the IDE webview badge across random inputs", () => {
  const healths = ["ok", "idle", "offline", "error", "busy", undefined];
  const modelLists = [[], ["qwen3.8:27b"], ["gpt-oss-20b", "glm-4.5-air"], undefined, null];
  const programs = ["vLLM", "Offline", "Server", "", "Ollama", undefined];
  for (let i = 0; i < 500; i++) {
    const h = healths[Math.floor(Math.random() * healths.length)];
    const m = modelLists[Math.floor(Math.random() * modelLists.length)];
    const p = programs[Math.floor(Math.random() * programs.length)];
    const a = ideWipBadge(h, m, p);
    const b = shared.localServerBadge(h, m, p);
    assert.strictEqual(b.text, a.text, `text mismatch at h=${JSON.stringify(h)} m=${JSON.stringify(m)} p=${JSON.stringify(p)}`);
    assert.strictEqual(b.hasLoadedModels, a.hasLoadedModels, `hasLoadedModels mismatch at h=${JSON.stringify(h)} m=${JSON.stringify(m)}`);
    assert.strictEqual(b.isServerRunning, a.isServerRunning, `isServerRunning mismatch at h=${JSON.stringify(h)}`);
  }
});

test("localServerBadge branch coverage (A8: Active / Idle / Offline + tone)", () => {
  // Active: a loaded model wins even when the endpoint is offline.
  assert.strictEqual(shared.localServerBadge("offline", ["qwen3.8:27b"], "vLLM").text, "Active · qwen3.8:27b");
  assert.strictEqual(shared.localServerBadge("ok", ["a", "b"], "vLLM").text, "Active · a");
  assert.strictEqual(shared.localServerBadge("ok", ["a", "b"], "vLLM").tone, "active");
  // Idle: server up, no model loaded.
  assert.strictEqual(shared.localServerBadge("idle", [], "vLLM").text, "vLLM (Idle)");
  assert.strictEqual(shared.localServerBadge("ok", [], "vLLM").text, "vLLM (Idle)");
  assert.strictEqual(shared.localServerBadge("idle", undefined, undefined).text, "Server (Idle)");
  assert.strictEqual(shared.localServerBadge("ok", [], "vLLM").tone, "idle");
  // Offline: down endpoint, no model.
  assert.strictEqual(shared.localServerBadge("offline", [], "Offline").text, "Offline");
  assert.strictEqual(shared.localServerBadge(undefined, undefined, undefined).text, "Offline");
  assert.strictEqual(shared.localServerBadge("error", [], "vLLM").text, "Offline");
  assert.strictEqual(shared.localServerBadge("offline", [], "Offline").tone, "offline");
});

test("localLoadedModelLabel: first model or placeholder", () => {
  assert.strictEqual(shared.localLoadedModelLabel(["qwen3.8:27b", "glm"]), "qwen3.8:27b");
  assert.strictEqual(shared.localLoadedModelLabel([]), "—");
  assert.strictEqual(shared.localLoadedModelLabel(undefined), "—");
});

// ---------------------------------------------------------------------------
console.log("quota-core: P7 external-provider parser (parseExternalPayload / validateExternalProvider)");

test("parseExternalPayload: array of window objects", () => {
  const r = shared.parseExternalPayload("MyAPI", [
    { label: "5Hours", remainingPercentage: 80 },
    { label: "Weekly", usedPercentage: 40 },
  ]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.windows.length, 2);
  assert.strictEqual(r.windows[0].label, "5Hours");
  assert.strictEqual(r.windows[0].percentage, 80);
  assert.strictEqual(r.windows[0].tone, "ok");
  assert.strictEqual(r.windows[1].percentage, 60, "usedPercentage is inverted to remaining");
});

test("parseExternalPayload: windows array / single object / per-window keys", () => {
  const w = shared.parseExternalPayload("x", { windows: [{ name: "A", remaining_percentage: "25%" }] });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.windows[0].percentage, 25);
  const single = shared.parseExternalPayload("x", { percentUsed: 10 });
  assert.strictEqual(single.ok, true);
  assert.strictEqual(single.windows[0].percentage, 90);
  const keyed = shared.parseExternalPayload("x", { fiveHour: { remainingPercentage: 10 }, weekly: { remainingPercentage: 20 } });
  assert.strictEqual(keyed.ok, true);
  assert.strictEqual(keyed.windows.length, 2);
});

test("parseExternalPayload: error paths never throw", () => {
  assert.strictEqual(shared.parseExternalPayload("x", null).ok, false);
  assert.strictEqual(shared.parseExternalPayload("x", "text").ok, false);
  assert.strictEqual(shared.parseExternalPayload("x", {}).ok, false);
  assert.strictEqual(shared.parseExternalPayload("x", { foo: "bar" }).ok, false);
  const partial = shared.parseExternalPayload("x", [{ label: "no-data" }, { remainingPercentage: 50 }]);
  assert.strictEqual(partial.ok, true);
  assert.strictEqual(partial.windows[0].unavailable, true);
  assert.strictEqual(partial.windows[1].percentage, 50);
});

test("validateExternalProvider: url protocol + poll clamping", () => {
  assert.ok(shared.validateExternalProvider({ name: "", url: "https://x.io" }).error);
  assert.ok(shared.validateExternalProvider({ name: "x", url: "" }).error);
  assert.ok(shared.validateExternalProvider({ name: "x", url: "ftp://x.io" }).error);
  assert.ok(shared.validateExternalProvider({ name: "x", url: "not a url" }).error);
  const ok = shared.validateExternalProvider({ name: "x", url: "http://127.0.0.1:8080/usage" });
  assert.ok(ok.spec);
  assert.strictEqual(ok.spec.enabled, true);
  assert.strictEqual(ok.spec.pollMs, 60_000, "default 60s");
  assert.strictEqual(shared.validateExternalProvider({ name: "x", url: "https://x.io", pollMs: 1 }).spec.pollMs, shared.EXTERNAL_POLL_MIN_MS);
  assert.strictEqual(shared.validateExternalProvider({ name: "x", url: "https://x.io", pollMs: 1e9 }).spec.pollMs, shared.EXTERNAL_POLL_MAX_MS);
});

test("parseExternalPayload: absolute token pairs derive a percentage", () => {
  // OpenAI usage shape (limit_tokens/remaining_tokens) and generic limit/used.
  const r = shared.parseExternalPayload("T", {
    windows: [
      { name: "5h", limit_tokens: 500_000, remaining_tokens: 125_000 },
      { name: "Weekly", limit: 100, used: 30 },
    ],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.windows.length, 2);
  assert.strictEqual(r.windows[0].unavailable, false);
  assert.ok(Math.abs(r.windows[0].percentage - 25) < 0.01, "500k limit, 125k remaining → 25%");
  assert.ok(Math.abs(r.windows[1].percentage - 70) < 0.01, "limit 100, used 30 → 70% remaining");
  // Explicit percentage still wins over the token-pair fallback.
  const both = shared.parseExternalPayload("B", { windows: [{ label: "x", remainingPercentage: 50, limit_tokens: 100, remaining_tokens: 10 }] });
  assert.strictEqual(both.windows[0].percentage, 50, "explicit remainingPercentage beats token pair");
});

test("parseModelList: OpenAI data[].id and Ollama models[].name", () => {
  // OpenAI-compatible /v1/models (the LM Studio / vLLM probe shape in TokenManager).
  const openai = shared.parseModelList({ data: [{ id: "qwen3.8:27b" }, { id: "glm-4.5-air" }, { id: "qwen3.8:27b" }, { name: "no-id" }] });
  assert.strictEqual(JSON.stringify(openai), JSON.stringify(["qwen3.8:27b", "glm-4.5-air", "no-id"]), "dedup + name fallback");
  // Ollama /api/tags shape.
  const ollama = shared.parseModelList({ models: [{ name: "qwen3.8:27b" }, { name: "deepseek-r1-distill-qwen-7b" }] });
  assert.strictEqual(JSON.stringify(ollama), JSON.stringify(["qwen3.8:27b", "deepseek-r1-distill-qwen-7b"]));
  // Non-model payloads return [] (e.g. a quota payload misfired at /models).
  assert.strictEqual(shared.parseModelList({ windows: [{ remainingPercentage: 50 }] }).length, 0);
  assert.strictEqual(shared.parseModelList("not json").length, 0);
  assert.strictEqual(shared.parseModelList(null).length, 0);
});

test("modelDiscoveryUrls: /v1 base → /models, bare host → both candidates", () => {
  assert.strictEqual(
    JSON.stringify(shared.modelDiscoveryUrls("http://192.168.0.29:18082/v1")),
    JSON.stringify(["http://192.168.0.29:18082/v1/models"]),
  );
  assert.strictEqual(
    JSON.stringify(shared.modelDiscoveryUrls("http://192.168.0.29:11434")),
    JSON.stringify(["http://192.168.0.29:11434/v1/models", "http://192.168.0.29:11434/api/tags"]),
  );
  // Trailing slash must not duplicate.
  assert.strictEqual(
    JSON.stringify(shared.modelDiscoveryUrls("http://192.168.0.29:18010/v1/")),
    JSON.stringify(["http://192.168.0.29:18010/v1/models"]),
  );
  assert.strictEqual(shared.modelDiscoveryUrls("not a url").length, 0);
});

test("validateExternalProvider: Hermes-style form + legacy url backwards compat", () => {
  // Full form: base endpoint + optional quota + key + discover.
  const spec = shared.validateExternalProvider({
    name: "vLLM remote",
    baseUrl: "http://192.168.0.29:18082/v1/",
    apiKey: "sekret",
    defaultModel: "Qwen3.8-27B-AWQ",
    quotaUrl: "https://api.openai.com/v1/organization/usage",
    discoverModels: true,
    pollMs: 60000,
  });
  assert.ok(spec.spec, JSON.stringify(spec));
  assert.strictEqual(spec.spec.baseUrl, "http://192.168.0.29:18082/v1/");
  assert.strictEqual(spec.spec.quotaUrl, "https://api.openai.com/v1/organization/usage");
  assert.strictEqual(spec.spec.apiKey, "sekret");
  assert.strictEqual(spec.spec.defaultModel, "Qwen3.8-27B-AWQ");
  assert.strictEqual(spec.spec.discoverModels, true);
  // Relative quota URL resolves against the base (absolute paths resolve to
  // the origin per URL semantics).
  const rel = shared.validateExternalProvider({ name: "x", baseUrl: "http://h:1/v1", quotaUrl: "/usage" });
  assert.strictEqual(rel.spec.quotaUrl, "http://h:1/usage");
  // Legacy: a bare `url` (no baseUrl) is both base and quota source — so
  // previously registered providers keep polling their quota endpoint.
  const legacy = shared.validateExternalProvider({ name: "Mock", url: "http://127.0.0.1:39321/quota", pollMs: 60000 });
  assert.ok(legacy.spec);
  assert.strictEqual(legacy.spec.baseUrl, "http://127.0.0.1:39321/quota");
  assert.strictEqual(legacy.spec.quotaUrl, "http://127.0.0.1:39321/quota");
  // Blank key → undefined (no Authorization header).
  assert.strictEqual(shared.validateExternalProvider({ name: "x", baseUrl: "http://h/v1", apiKey: "  " }).spec.apiKey, undefined);
  // Model-only provider: base without quota is valid.
  const modelOnly = shared.validateExternalProvider({ name: "LM", baseUrl: "http://127.0.0.1:1234/v1", quotaUrl: "" });
  assert.ok(modelOnly.spec);
  assert.strictEqual(modelOnly.spec.quotaUrl, undefined);
});

// ---------------------------------------------------------------------------
console.log("quota-core: control-center wiring");
test("control-center imports the shared quota source (no duplicated K logic)", () => {
  const cc = fs.readFileSync(ccMain, "utf8");
  assert.ok(cc.includes("@shared/quota"), "control-center/src/main.js must import @shared/quota");
  // P3: the CC must consume the shared metric/summary builders, and must not
  // redefine them or hard-code its own K-sync of the 5h value.
  assert.ok(cc.includes("buildTokenMetric"), "control-center must import buildTokenMetric (A4+A7)");
  assert.ok(cc.includes("calculateCapacitySummary"), "control-center must import calculateCapacitySummary (A5)");
  // The old per-program K table must be gone from the CC (single source of truth).
  assert.ok(!/const K_CAPACITY_RATIOS/.test(cc), "duplicate K_CAPACITY_RATIOS remains in control-center");
  // P4: the local-LLM server badge must come from the shared localServerBadge,
  // not the old (always-false) lcs.status === "online"|"busy" check.
  assert.ok(cc.includes("localServerBadge"), "control-center must import localServerBadge (A8)");
  assert.ok(!/lcs\??\.status === "online"/.test(cc), "control-center still keys its badge off lcs.status (always-false)");
  // P5: the manual "refresh now" must request the broker force endpoint
  // (?force=1), while normal polling must not.
  assert.ok(/force[^;]*\/v1\/tokens\/status\?force=1/.test(cc), "control-center must call /v1/tokens/status?force=1 on manual refresh (B2)");
  assert.ok(cc.includes("refresh({ force: true })"), "control-center token-refresh button must call refresh({ force: true })");
  // B5: the four provider blocks each have a header toggle, persisted under
  // one localStorage key (mirrors the IDE viewConfig.show* semantics), plus a
  // "show all" reset. The toggle must live in the HTML markup, not be created
  // via innerHTML at runtime.
  assert.ok(cc.includes("applyProviderVisibility"), "control-center must apply provider-block visibility (B5)");
  assert.ok(cc.includes("ip_provider_visibility"), "control-center must persist provider visibility in localStorage (B5)");
  const ccHtml = fs.readFileSync(path.resolve(extensionRoot, "..", "control-center", "index.html"), "utf8");
  for (const key of ["antigravity", "openai", "claude", "local"]) {
    assert.ok(
      ccHtml.includes(`data-provider="${key}"`),
      `control-center index.html must have a provider toggle for "${key}" (B5)`
    );
    assert.ok(ccHtml.includes(`id="provider-${key}"`), `control-center index.html must keep the provider-${key} card (B5)`);
  }
  assert.ok(ccHtml.includes('id="provider-visibility-reset"'), "control-center index.html must keep the show-all reset button (B5)");
  // P7 external providers: CC must consume the shared parser, register via the
  // broker server-side fetch endpoint, render DOM-only cards into the host,
  // and the settings form + taskbar toggle must exist in the HTML.
  assert.ok(cc.includes("parseExternalPayload"), "control-center must import parseExternalPayload");
  assert.ok(cc.includes("validateExternalProvider"), "control-center must import validateExternalProvider");
  assert.ok(cc.includes("parseModelList"), "control-center must import parseModelList (Hermes-style model discovery)");
  assert.ok(cc.includes("modelDiscoveryUrls"), "control-center must import modelDiscoveryUrls");
  assert.ok(cc.includes("/v1/providers/external?url="), "control-center must fetch external payloads through the broker");
  assert.ok(cc.includes("ip_external_providers"), "control-center must persist external providers in localStorage");
  assert.ok(cc.includes("createElement"), "external provider cards must be built with the DOM API");
  assert.ok(ccHtml.includes('id="external-providers-host"'), "index.html must host external provider cards");
  assert.ok(ccHtml.includes('id="ext-add"'), "index.html must have the external provider add form");
  assert.ok(ccHtml.includes('id="ext-test"'), "index.html must expose the provider test button");
  assert.ok(ccHtml.includes('id="ext-apikey"'), "index.html must expose the API key field");
  assert.ok(ccHtml.includes('id="ext-discover"'), "index.html must expose the model-discovery checkbox");
  assert.ok(ccHtml.includes('id="setting-taskbar-toggle"'), "index.html must expose the OS taskbar toggle");
  assert.ok(cc.includes("setSkipTaskbar"), "control-center must drive Tauri setSkipTaskbar for the taskbar toggle");
});

if (failures) {
  console.error(`\n${failures} quota-core test(s) failed`);
  process.exit(1);
}
console.log("\nquota-core tests passed");
