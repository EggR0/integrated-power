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
});

if (failures) {
  console.error(`\n${failures} quota-core test(s) failed`);
  process.exit(1);
}
console.log("\nquota-core tests passed");
