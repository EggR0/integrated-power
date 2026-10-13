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
    const fixturePath = path.join(tempRoot, "missing-dashboard.json");
    fs.writeFileSync(fixturePath, "synthetic fixture", "utf8");
    assert.strictEqual((await host.readFile({ fsPath: fixturePath })).toString(), "synthetic fixture", "headless host uses Node fs");
    const manager = new FixtureTokenManager(host);
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
    console.log("IDE adapter passed: lazy VS Code load preserves explicit Agy install consent flow");
  } finally {
    Module._load = originalLoad;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
