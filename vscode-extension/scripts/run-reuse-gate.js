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
forbidText("..\\control-center\\src\\main.js", "innerHTML");
forbidText("..\\control-center\\broker-server.js", "IntegratedPower\\control-center");
forbidText("..\\control-center\\mcp-server.js", "IntegratedPower\\control-center");
if (!read("package.json").includes("@modelcontextprotocol/sdk")) failures.push("official MCP SDK is not declared");
if (!read("package.json").includes("@ag-ui/core")) failures.push("official AG-UI core is not declared");

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("reuse gate passed");
