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
console.log("quota-core: control-center wiring");
test("control-center imports the shared quota source (no duplicated K logic)", () => {
  const cc = fs.readFileSync(ccMain, "utf8");
  assert.ok(cc.includes("@shared/quota"), "control-center/src/main.js must import @shared/quota");
  // The old per-program K table must be gone from the CC (single source of truth).
  assert.ok(!/const K_CAPACITY_RATIOS/.test(cc), "duplicate K_CAPACITY_RATIOS remains in control-center");
});

if (failures) {
  console.error(`\n${failures} quota-core test(s) failed`);
  process.exit(1);
}
console.log("\nquota-core tests passed");
