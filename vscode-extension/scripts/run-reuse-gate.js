const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const failures = [];
const requireText = (relative, text) => { if (!read(relative).includes(text)) failures.push(`${relative} is missing required reuse marker: ${text}`); };
const forbidText = (relative, text) => { if (read(relative).includes(text)) failures.push(`${relative} contains forbidden duplicate/unsafe implementation: ${text}`); };

for (const file of ["..\\AGENTS.md", "..\\docs\\reuse-map.md", "..\\docs\\adr\\0001-reuse-boundaries.md"]) if (!fs.existsSync(path.join(root, file))) failures.push(`missing ${file}`);
requireText("src\\broker\\adapters.ts", "runLegacyLocalLlm");
forbidText("src\\broker\\adapters.ts", "/api/generate");
requireText("assets\\ip-orchestrator-plugin\\skills\\ip-orchestrator\\scripts\\Select-LocalLLMModel.ps1", "GpuUuid");
requireText("assets\\ip-orchestrator-plugin\\skills\\ip-orchestrator\\scripts\\Select-LocalLLMModel.ps1", "UtilizationPercent");
const ccRoot = fs.existsSync(path.join(root, "..", "control-center"))
  ? path.join(root, "..", "control-center")
  : path.resolve(root, "..", "..", "integrated-power-control-center");
if (fs.existsSync(ccRoot)) {
  const ccMain = path.join(ccRoot, "src", "main.js");
  const ccBroker = path.join(ccRoot, "broker-server.js");
  const ccMcp = path.join(ccRoot, "mcp-server.js");
  if (fs.existsSync(ccMain) && fs.readFileSync(ccMain, "utf8").includes("innerHTML")) failures.push("control-center main.js contains forbidden innerHTML");
  if (fs.existsSync(ccBroker) && fs.readFileSync(ccBroker, "utf8").includes("IntegratedPower\\control-center")) failures.push("control-center broker-server contains forbidden path pattern");
  if (fs.existsSync(ccMcp) && fs.readFileSync(ccMcp, "utf8").includes("IntegratedPower\\control-center")) failures.push("control-center mcp-server contains forbidden path pattern");
}
if (!read("package.json").includes("@modelcontextprotocol/sdk")) failures.push("official MCP SDK is not declared");
if (!read("package.json").includes("@ag-ui/core")) failures.push("official AG-UI core is not declared");
// Quota calculation/formatting must live once in shared/quota. The webview
// loads the IIFE bundle and delegates; the control-center imports the same
// TypeScript source (checked in the quota-core test, which also proves parity).
if (!fs.existsSync(path.join(root, "..", "shared", "quota", "index.ts"))) failures.push("missing shared/quota/index.ts (single source of quota calculation)");
requireText("webview\\main.js", "window.IPQuota");
forbidText("webview\\main.js", "const K_CAPACITY_RATIOS = Object.freeze");
if (!read("src\\DashboardProvider.ts").includes("quota-core.js")) failures.push("webview HTML does not load quota-core.js");
if (!read("scripts\\build-extension.js").includes("index.ts")) failures.push("build does not regenerate webview/quota-core.js from shared/quota");
// P2: broker force-refresh must be wired to the live IDE (extension.ts) and
// the endpoint must read the ?force=1 query param. The schema passthrough is
// proven by run-broker-tests.js; these markers pin the force wiring.
requireText("src\\broker\\server.ts", "force");
requireText("src\\broker\\tokenScanner.ts", "setForceRefreshHandler");
requireText("src\\extension.ts", "setForceRefreshHandler");
// P3: A4 absolute tokens + A7 tooltip + A5 Best/Lowest selection live once in
// shared/quota. The webview delegates buildTokenMetric/calculateCapacitySummary
// to window.IPQuota (no local re-derivation), and the control-center imports
// the same source instead of hard-coding its own K-sync / metric builder.
requireText("webview\\main.js", "IPQuota.buildTokenMetric");
requireText("webview\\main.js", "IPQuota.calculateCapacitySummary");
if (fs.existsSync(ccRoot)) {
  const ccMainFile = path.join(ccRoot, "src", "main.js");
  if (fs.existsSync(ccMainFile)) {
    const cc = fs.readFileSync(ccMainFile, "utf8");
    if (!cc.includes("buildTokenMetric")) failures.push("control-center main.js must import buildTokenMetric (A4+A7) from @shared/quota");
    if (!cc.includes("calculateCapacitySummary")) failures.push("control-center main.js must import calculateCapacitySummary (A5) from @shared/quota");
    if (/const K_CAPACITY_RATIOS/.test(cc)) failures.push("control-center main.js redefines K_CAPACITY_RATIOS (single source must stay in shared/quota)");
    // P4: the local-LLM server badge must come from the shared localServerBadge,
    // not the old always-false `status === "online"|"busy"` check.
    if (!cc.includes("localServerBadge")) failures.push("control-center main.js must import localServerBadge (A8) from @shared/quota");
    if (/\.status === "online"/.test(cc)) failures.push("control-center main.js still keys its badge off a `status` field the P2 state never carries");
  }
}

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("reuse gate passed");
