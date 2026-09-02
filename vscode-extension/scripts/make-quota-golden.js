// One-time extractor: snapshots the ORIGINAL webview quota functions into
// quota-golden.js so the parity tests in test-quota-core.js keep proving
// "shared module === original webview behavior" even after main.js stops
// defining them. DO NOT edit the fixture by hand.
const fs = require("fs");
const path = require("path");

const mainPath = path.join(__dirname, "..", "webview", "main.js");
const src = fs.readFileSync(mainPath, "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`not found: ${name}`);
  let depth = 0, end = -1, inStr = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === inStr && src[i - 1] !== "\\") inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error(`unterminated: ${name}`);
  return src.slice(start, end);
}

const names = [
  "toFiniteNumber", "clamp", "capacityTone", "calculateEffective5HourQuota",
  "formatRefreshCountdown", "formatNumber", "formatTokenCount", "formatResetTime",
];

let out = `// GOLDEN SNAPSHOT of the pre-refactor webview quota functions.\n// Generated once from webview/main.js before those functions were moved to\n// shared/quota. test-quota-core.js compares the shared bundle against these.\n// DO NOT edit by hand.\n\n`;
const kMatch = src.match(/const K_CAPACITY_RATIOS = (Object\.freeze\(\{[\s\S]*?\}\));/);
if (!kMatch) throw new Error("K_CAPACITY_RATIOS not found");
out += `const K_CAPACITY_RATIOS = ${kMatch[1]};\n`;
const kDefault = src.match(/const K_DEFAULT_RATIO = ([\d.]+);/)[1];
out += `const K_DEFAULT_RATIO = ${kDefault};\n\n`;
for (const name of names) out += extractFunction(name) + "\n\n";
out += `module.exports = { K_CAPACITY_RATIOS, K_DEFAULT_RATIO, ${names.join(", ")} };\n`;

const fixturePath = path.join(__dirname, "quota-golden.js");
fs.writeFileSync(fixturePath, out, "utf8");
console.log(`wrote ${fixturePath} (${out.length} bytes, ${names.length} functions)`);
