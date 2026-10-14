const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const Module = require("module");

const extensionRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(extensionRoot, ".token-manager-headless-"));
const originalLoad = Module._load;

async function main() {
  try {
    execFileSync(process.execPath, [
      path.join(extensionRoot, "node_modules", "typescript", "bin", "tsc"),
      "-p", path.join(extensionRoot, "tsconfig.json"), "--outDir", tempRoot, "--sourceMap", "false",
    ], { cwd: extensionRoot, stdio: "pipe" });

    process.env.NODE_PATH = path.join(extensionRoot, "node_modules");
    Module._initPaths();
    Module._load = function (request, parent, isMain) {
      if (request === "vscode") throw new Error("headless collector attempted to load vscode");
      return originalLoad.call(this, request, parent, isMain);
    };

    const { TokenManager, createHeadlessTokenManagerHost } = require(path.join(tempRoot, "TokenManager.js"));
    const providerCalls = { codex: 0, antigravity: 0, localLlm: 0, claude: 0 };
    class FixtureTokenManager extends TokenManager {
      async fetchCodexQuota() {
        providerCalls.codex++;
        return { codexPercentage: 61, codexWeeklyPercentage: 82, codexResetTime: "2030-01-01T00:00:00.000Z" };
      }
      async fetchAntigravityQuota() {
        providerCalls.antigravity++;
        return { antigravityPercentage: 72, antigravityWeeklyPercentage: 88, opusPercentage: 66, opusWeeklyPercentage: 77 };
      }
      async fetchLocalLlmStatus() {
        providerCalls.localLlm++;
        return { localComputeStatus: { endpointHealth: "online", programName: "Fixture", loadedModels: [], gpus: [] } };
      }
      async fetchClaudeDirectUsage() {
        providerCalls.claude++;
        return { status: "no-data", today: {}, sevenDays: {}, sources: [], lastMeasuredAt: "2026-10-13T00:00:00.000Z", errors: [] };
      }
    }
    const host = createHeadlessTokenManagerHost();

    class PreferredOllamaFixture extends TokenManager {
      probedUrls = [];
      async fetchGpuMetrics() { return []; }
      async httpGetJson(url) {
        this.probedUrls.push(url);
        if (url === "http://127.0.0.1:11435/api/ps") return { models: [] };
        throw new Error("synthetic endpoint unavailable");
      }
    }
    const priorEndpoint = process.env.INTEGRATED_POWER_LOCAL_ENDPOINT;
    const priorOllamaHost = process.env.OLLAMA_HOST;
    delete process.env.INTEGRATED_POWER_LOCAL_ENDPOINT;
    delete process.env.OLLAMA_HOST;
    const ollamaFixture = new PreferredOllamaFixture(host);
    const ollamaStatus = await ollamaFixture.fetchLocalLlmStatus();
    assert.deepStrictEqual(ollamaFixture.probedUrls, ["http://127.0.0.1:11435/api/ps"], "the documented D-port endpoint is tried before legacy Ollama ports");
    assert.strictEqual(ollamaStatus.localComputeStatus.endpointHealth, "idle", "responsive Ollama without a loaded model is idle, not offline");
    process.env.INTEGRATED_POWER_LOCAL_ENDPOINT = "http://127.0.0.1:19123";
    try {
      class ConfiguredEndpointFixture extends PreferredOllamaFixture {
        async httpGetJson(url) {
          this.probedUrls.push(url);
          if (url === "http://127.0.0.1:19123/v1/models") return { data: [{ id: "synthetic-local-model" }] };
          throw new Error("synthetic endpoint route not available");
        }
      }
      const configured = new ConfiguredEndpointFixture(host);
      const configuredStatus = await configured.fetchLocalLlmStatus();
      assert.strictEqual(configured.probedUrls[0], "http://127.0.0.1:19123/api/ps", "configured local endpoint takes precedence over defaults");
      assert.ok(configured.probedUrls.includes("http://127.0.0.1:19123/v1/models"), "configured OpenAI-compatible endpoint uses the existing models-list probe shape");
      assert.deepStrictEqual(configuredStatus.localComputeStatus.loadedModels, ["synthetic-local-model"]);
    } finally {
      if (priorEndpoint === undefined) delete process.env.INTEGRATED_POWER_LOCAL_ENDPOINT;
      else process.env.INTEGRATED_POWER_LOCAL_ENDPOINT = priorEndpoint;
      if (priorOllamaHost === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = priorOllamaHost;
    }

    class LocalTimeoutFixture extends FixtureTokenManager {
      async fetchLocalLlmStatus() { return new Promise(() => {}); }
      async withTimeout(promise, timeoutMs, fallbackValue) {
        if (timeoutMs === 10_000) {
          assert.strictEqual(fallbackValue, undefined, "local telemetry timeout cannot use a successful offline fallback");
          throw new Error("Quota source timed out after 10000ms.");
        }
        return super.withTimeout(promise, timeoutMs, fallbackValue);
      }
    }
    const timeoutStatus = await new LocalTimeoutFixture(host).getStatus(undefined, { refreshQuota: true, forceRefresh: true });
    assert.ok(timeoutStatus.errors.some((error) => error.includes("LocalLLM: Quota source timed out")), "a timed-out local source remains an explicit failure");
    assert.strictEqual(timeoutStatus.localComputeStatus, undefined, "timeout cannot masquerade as a fresh offline probe result");
    Object.assign(providerCalls, { codex: 0, antigravity: 0, localLlm: 0, claude: 0 });

    const fixturePath = path.join(tempRoot, "missing-dashboard.json");
    fs.writeFileSync(fixturePath, "synthetic fixture", "utf8");
    assert.strictEqual((await host.readFile({ fsPath: fixturePath })).toString(), "synthetic fixture", "headless host uses Node fs");
    const manager = new FixtureTokenManager(host);
    const nowMs = Date.now();
    const staleWeeklyReset = new Date(nowMs + 6 * 24 * 60 * 60 * 1000).toISOString();
    const staleEvent = {
      type: "event_msg",
      timestamp: new Date(nowMs - 13 * 60 * 60 * 1000).toISOString(),
      payload: {
        type: "token_count",
        rate_limits: {
          primary: { window_minutes: 300, used_percent: 0, resets_at: Math.floor((nowMs + 2 * 60 * 60 * 1000) / 1000) },
          secondary: { window_minutes: 10080, used_percent: 60, resets_at: Math.floor(Date.parse(staleWeeklyReset) / 1000) },
        },
      },
    };
    const staleCodex = manager.codexQuotaFromEvent(staleEvent, nowMs - 13 * 60 * 60 * 1000);
    assert.strictEqual(staleCodex, undefined, "an old session event cannot report current provider quota or a projected future reset");
    const expiredCodex = manager.codexWindowQuota({ used_percent: 70, resets_at: Math.floor((nowMs - 60_000) / 1000) });
    assert.strictEqual(expiredCodex.percentage, undefined, "expired passive session quota is stale, not a current window measurement");
    const windowedCodex = manager.codexQuotaFromEvent({
      type: "event_msg",
      timestamp: new Date(nowMs).toISOString(),
      payload: { type: "token_count", rate_limits: {
        primary: { window_minutes: 300, used_percent: 20, resets_at: Math.floor((nowMs + 2 * 60 * 60_000) / 1000) },
        secondary: { window_minutes: 10080, used_percent: 40, resets_at: Math.floor((nowMs + 6 * 24 * 60 * 60_000) / 1000) },
      } },
    });
    assert.strictEqual(windowedCodex.codexPercentage, 80, "5-hour display is selected by its provider-reported duration, not the primary slot");
    assert.strictEqual(windowedCodex.codexWeeklyPercentage, 60, "weekly display uses the provider-reported 10080-minute window");
    const otherCodexBucket = manager.codexQuotaFromEvent({
      type: "event_msg", timestamp: new Date(nowMs).toISOString(),
      payload: { type: "token_count", rate_limits: { limit_id: "other", primary: { window_minutes: 300, used_percent: 1 }, secondary: { window_minutes: 10080, used_percent: 2 } } },
    });
    assert.strictEqual(otherCodexBucket, undefined, "passive session limits explicitly belonging to another bucket are not Codex quota");
    const unsupportedCodex = manager.codexQuotaFromEvent({
      type: "event_msg", timestamp: new Date(nowMs).toISOString(),
      payload: { type: "token_count", rate_limits: {
        primary: { window_minutes: 60, used_percent: 1 },
        secondary: { window_minutes: 30, used_percent: 2 },
      } },
    });
    assert.strictEqual(unsupportedCodex.codexPercentage, undefined, "unrecognized duration is not mislabeled as a 5-hour quota");
    assert.strictEqual(unsupportedCodex.codexWeeklyPercentage, undefined, "unrecognized duration is not mislabeled as weekly quota");
    assert.strictEqual(manager.timestampFromUsageEvent({}), undefined, "missing event timestamps must remain unknown instead of counting as current usage");
    const keepAlive = setInterval(() => undefined, 25);
    try {
      await assert.rejects(manager.withTimeout(new Promise(() => {}), 1), /timed out/i, "a quota source timeout must not become a successful empty result");
    } finally {
      clearInterval(keepAlive);
    }

    const [result, concurrentResult] = await Promise.all([
      manager.getStatus(undefined, { refreshQuota: true }),
      manager.getStatus(undefined, { refreshQuota: true }),
    ]);
    assert.strictEqual(result.codexPercentage, 61, "fresh collector value reaches TokenStatus");
    assert.strictEqual(concurrentResult.codexPercentage, 61, "concurrent caller receives same fresh result");
    assert.strictEqual(result.antigravityPercentage, 72, "existing Antigravity collector is reused");
    assert.strictEqual(result.opusWeeklyPercentage, 77, "existing Opus collector is reused");
    assert.strictEqual(result.localComputeStatus?.endpointHealth, "online", "local metric source is reused");
    assert.deepStrictEqual(providerCalls, { codex: 1, antigravity: 1, localLlm: 1, claude: 1 }, "concurrent refreshes share the existing in-flight collection");
    console.log("headless TokenManager collector passed: no VS Code import, Node fs host, fresh values, in-flight collection coalesced");

    const usageRoot = path.join(tempRoot, "claude-fixtures");
    const telemetryDir = path.join(usageRoot, "telemetry");
    const reportsDir = path.join(usageRoot, "reports");
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });
    const eventTimestamp = new Date(Date.now() - 60_000).toISOString();
    const native = (id, messageId, timestamp, usage) => JSON.stringify({
      type: "assistant_usage", id, timestamp, producer: { provider: "anthropic", model: "claude-fixture" },
      message: { id: messageId, model: "claude-fixture", usage },
    });
    const telemetryPath = path.join(telemetryDir, "events.jsonl");
    const nativeEvents = [
      native("native-1", "message-native", eventTimestamp, {
        input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 30,
        output_tokens: 10, reasoning_tokens: 5,
      }),
      native("duplicate-old", "message-update", eventTimestamp, { input_tokens: 100, output_tokens: 1 }),
      native("duplicate-new", "message-update", new Date(Date.now()).toISOString(), { input_tokens: 140, output_tokens: 10 }),
      JSON.stringify({ type: "assistant_usage", producer: { provider: "anthropic" }, usage: { input_tokens: 999, output_tokens: 1 } }),
      native("future", "message-future", new Date(Date.now() + 24 * 60 * 60_000).toISOString(), { input_tokens: 999, output_tokens: 1 }),
    ].join("\n");
    fs.writeFileSync(telemetryPath, nativeEvents, "utf8");
    fs.writeFileSync(path.join(reportsDir, "token_usage.csv"), [
      "Provider,Timestamp,InputTokens,CachedInputTokens,OutputTokens,ReasoningOutputTokens",
      `Anthropic,${eventTimestamp},100,20,10,5`,
    ].join("\n"), "utf8");
    const partialPath = path.join(usageRoot, "partial.jsonl");
    fs.writeFileSync(partialPath, [...Array(2000).fill("not-json"), native("partial-event", "message-partial", eventTimestamp, { input_tokens: 1, output_tokens: 1 })].join("\n"), "utf8");
    const claudeManager = new TokenManager(host);
    const nativeParsed = claudeManager.claudeUsageEventFromObject(JSON.parse(native("native-proof", "message-proof", eventTimestamp, {
      input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 30,
      output_tokens: 10, reasoning_tokens: 5,
    })), "Claude native fixture", true);
    assert.strictEqual(nativeParsed.totalTokens, 160, "native Anthropic input and both cache counters are counted once; reasoning is a subset");
    assert.strictEqual(nativeParsed.billableTokens, undefined, "missing provider billing fields stay unknown instead of becoming zero");
    const explicitZeroBillable = claudeManager.claudeUsageEventFromObject({
      timestamp: eventTimestamp, provider: "anthropic", usage: { input_tokens: 1, output_tokens: 1, billable_tokens: 0 },
    }, "explicit zero-billable fixture", false);
    assert.strictEqual(explicitZeroBillable.billableTokens, 0, "an explicit provider-reported zero billable count remains zero");
    assert.strictEqual(claudeManager.summarizeClaudeUsage([explicitZeroBillable]).billableTokens, 0, "a fully measured zero billable summary stays zero");
    assert.strictEqual(claudeManager.summarizeClaudeUsage([nativeParsed, explicitZeroBillable]).billableTokens, undefined, "one record without billing evidence makes the aggregate billing count unknown");
    const normalizedParsed = claudeManager.claudeUsageEventFromObject({
      provider: "anthropic", timestamp: eventTimestamp,
      usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 5 },
    }, "normalized provider fixture", false);
    assert.strictEqual(normalizedParsed.totalTokens, 110, "normalized JSONL input already contains cached tokens and is not double-counted");
    const canonicalAlias = path.join(telemetryDir, "..", "telemetry", "events.jsonl");
    claudeManager.findClaudeUsageFiles = async () => [
      { fullPath: canonicalAlias, mtimeMs: Date.now() },
      { fullPath: partialPath, mtimeMs: Date.now() },
    ];
    claudeManager.claudeSourceLabel = () => "Claude synthetic fixture";
    const claudeUsage = await claudeManager.fetchClaudeDirectUsage(usageRoot);
    assert.strictEqual(claudeUsage.status, "partial", "truncated local log coverage must be labeled partial");
    assert.ok(claudeUsage.errors.some((error) => /line limit/i.test(error)), "partial status explains the scan limit");
    assert.strictEqual(claudeUsage.today.totalTokens, 422, "native Anthropic cache counts, latest duplicate, and distinct local CSV follow explicit totals");
    assert.strictEqual(claudeUsage.today.eventCount, 4, "missing/future events are excluded and a canonical file overlap is counted once");
    assert.strictEqual(claudeUsage.today.cachedInputTokens, 70, "Anthropic cache-read/cache-creation and CSV cache counts are each included once");
    assert.strictEqual(claudeUsage.today.reasoningOutputTokens, 10, "reasoning remains a separately reported subcount");
    assert.strictEqual(claudeUsage.sevenDays.totalTokens, 422, "seven-day view uses the same observed event set");
    console.log("Claude collector fixtures passed: Anthropic cache accounting, CSV normalization, event/path dedupe, missing/future exclusion, and partial scan marking");

    const prompts = [];
    const terminalCommands = [];
    const fakeVscode = {
      window: {
        showErrorMessage: async (...args) => { prompts.push(args); return "Install Agy CLI"; },
        createTerminal: (name) => ({ show() {}, sendText: (command) => terminalCommands.push({ name, command }) }),
      },
      workspace: { fs: { readFile: async () => Buffer.from("") }, },
      Uri: { file: (fsPath) => ({ fsPath }) },
    };
    Module._load = function (request, parent, isMain) {
      if (request === "vscode") return fakeVscode;
      return originalLoad.call(this, request, parent, isMain);
    };
    const { AgyNotInstalledError } = require(path.join(tempRoot, "AgyQuotaClient.js"));
    class IdeAdapterFixture extends TokenManager {
      async fetchCodexQuota() { return { codexPercentage: 100, codexWeeklyPercentage: 100 }; }
      async fetchAntigravityQuota() { throw new AgyNotInstalledError("synthetic absent CLI"); }
      async fetchLocalLlmStatus() { return { localComputeStatus: { endpointHealth: "offline", programName: "Fixture", loadedModels: [], gpus: [] } }; }
      async fetchClaudeDirectUsage() { return { status: "no-data", today: {}, sevenDays: {}, sources: [], lastMeasuredAt: "2026-10-13T00:00:00.000Z", errors: [] }; }
    }
    const ideStatus = await new IdeAdapterFixture().getStatus(undefined, { refreshQuota: true, forceRefresh: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(ideStatus.antigravityPercentage, undefined, "missing CLI does not invent quota");
    assert.strictEqual(prompts[0]?.[1], "Install Agy CLI", "default IDE adapter retains explicit install consent UI");
    assert.strictEqual(terminalCommands[0]?.name, "Install Antigravity CLI");
    assert.ok(terminalCommands[0]?.command.includes("install.ps1"));
    console.log("IDE adapter passed: local endpoints honor configured/11435 precedence, idle means responsive, and local timeout remains an error");
    console.log("IDE adapter passed: lazy VS Code load preserves explicit Agy install consent flow");

    const { DashboardController } = require(path.join(tempRoot, "DashboardController.js"));
    const dashboard = Object.create(DashboardController.prototype);
    const merged = dashboard.mergeTokenStatus({
      antigravityPercentage: 20, opusWeeklyPercentage: 40, opusWeeklyTokensLeft: 400, opusWeeklyMax: 1000,
      codexPercentage: 30, codexWeeklyPercentage: 50, errors: [],
    }, { antigravityPercentage: 100, errors: [] });
    assert.strictEqual(merged.antigravityPercentage, 100, "a newly measured zero-use quota remains valid");
    assert.strictEqual(merged.opusWeeklyPercentage, undefined, "partial refresh cannot carry a stale provider window forward");
    assert.strictEqual(merged.opusWeeklyTokensLeft, undefined, "stale absolute counts are cleared with the missing window");
    assert.strictEqual(merged.codexPercentage, undefined, "omitted provider windows remain unknown after a successful partial snapshot");
    console.log("Dashboard merge fixture passed: fresh partial windows cannot resurrect stale percentages or token counts");
  } finally {
    Module._load = originalLoad;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

let mainSettled = false;
process.on("beforeExit", () => {
  if (!mainSettled) {
    console.error("headless main exited before assertions completed");
    process.exitCode = 1;
  }
});
main().then(() => {
  mainSettled = true;
}).catch((error) => {
  mainSettled = true;
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
