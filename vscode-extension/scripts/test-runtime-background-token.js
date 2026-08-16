const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Mock vscode module for standalone runtime execution
const originalRequire = Module.prototype.require;
Module.prototype.require = function (modulePath) {
  if (modulePath === "vscode") {
    return {
      window: {
        createOutputChannel: () => ({ appendLine: () => {} }),
        showWarningMessage: () => {},
        showErrorMessage: () => {},
        showInformationMessage: () => {},
      },
      workspace: {
        getConfiguration: () => ({ get: (_k, def) => def ?? true }),
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        fs: {
          readFile: async () => Buffer.from(""),
          stat: async () => ({}),
        },
      },
      Uri: {
        file: (p) => ({ fsPath: p, path: p, scheme: "file" }),
        parse: (p) => ({ fsPath: p, path: p, scheme: "file" }),
      },
      EventEmitter: class {
        event() {}
        fire() {}
      },
      ViewColumn: { One: 1 },
    };
  }
  return originalRequire.apply(this, arguments);
};

const { TokenManager } = require("../out/TokenManager");

function test(name, fn) {
  try {
    fn();
    console.log(`ok - [Runtime TokenManager] ${name}`);
  } catch (error) {
    console.error(`not ok - [Runtime TokenManager] ${name}`);
    throw error;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`ok - [Runtime TokenManager] ${name}`);
  } catch (error) {
    console.error(`not ok - [Runtime TokenManager] ${name}`);
    throw error;
  }
}

// ─── Test 1: Circuit Breaker State Machine ──────────────────────────────────
test("Circuit Breaker transitions: CLOSED -> OPEN after 3 failures -> reset on success", () => {
  const tm = new TokenManager();

  // Initially CLOSED
  assert.strictEqual(tm.isCircuitOpen("codex"), false, "Initially circuit should be closed");

  // 1 failure
  tm.recordProviderFailure("codex");
  assert.strictEqual(tm.isCircuitOpen("codex"), false, "1 failure should not trip breaker");

  // 2 failures
  tm.recordProviderFailure("codex");
  assert.strictEqual(tm.isCircuitOpen("codex"), false, "2 failures should not trip breaker");

  // 3 failures -> Tripped!
  tm.recordProviderFailure("codex");
  assert.strictEqual(tm.isCircuitOpen("codex"), true, "3 failures must trip breaker to OPEN");

  // Success resets breaker to CLOSED
  tm.recordProviderSuccess("codex");
  assert.strictEqual(tm.isCircuitOpen("codex"), false, "Success must reset breaker to CLOSED");
});

// ─── Test 2: withTimeout Fault Isolation ────────────────────────────────────
testAsync("withTimeout isolates slow/hanging tasks within deadline", async () => {
  const tm = new TokenManager();

  const fastPromise = new Promise((resolve) => setTimeout(() => resolve("fast_result"), 20));
  const slowPromise = new Promise((resolve) => setTimeout(() => resolve("slow_result"), 500));

  // Fast task
  const fastResult = await tm.withTimeout(fastPromise, 100, "fallback");
  assert.strictEqual(fastResult, "fast_result", "Fast task should resolve normally");

  // Slow task times out and returns fallback
  const start = Date.now();
  const slowResult = await tm.withTimeout(slowPromise, 60, "fallback");
  const elapsed = Date.now() - start;

  assert.strictEqual(slowResult, "fallback", "Slow task must return fallback on timeout");
  assert.ok(elapsed < 200, `Timeout must resolve promptly (elapsed: ${elapsed}ms)`);
});

// ─── Test 3: TokenManager getStatus returns valid object structure ──────────
testAsync("TokenManager getStatus executes without crashing and returns safe status", async () => {
  const tm = new TokenManager();
  const status = await tm.getStatus(undefined, { refreshQuota: false });

  assert.ok(status, "Status object must exist");
  assert.ok(Array.isArray(status.activity), "Activity list must be array");
  assert.strictEqual(typeof status.antigravityTokensLeft, "number");
  assert.strictEqual(typeof status.codexTokensLeft, "number");
  assert.strictEqual(typeof status.opusTokensLeft, "number");
});

// ─── Test 4: Claude direct file reader handles non-existent or locked files ─
testAsync("Claude log scanning safely handles empty/missing paths", async () => {
  const tm = new TokenManager();
  const usage = await tm.fetchClaudeDirectUsage(undefined);

  assert.ok(usage, "Claude direct usage object must be returned");
  assert.ok(usage.status === "measured" || usage.status === "no-data");
  assert.strictEqual(typeof usage.today.totalTokens, "number");
  assert.strictEqual(typeof usage.sevenDays.totalTokens, "number");
});

console.log("All Runtime TokenManager verification tests passed!");
