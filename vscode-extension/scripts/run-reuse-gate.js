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

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("reuse gate passed");
