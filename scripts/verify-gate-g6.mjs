import { execSync } from "child_process";
import path from "path";

console.log("Verifying G6: Comprehensive Regression & Build Gates...");

const gates = [
  "scripts/verify-gate-g1.mjs",
  "scripts/verify-gate-g2.mjs",
  "scripts/verify-gate-g3.mjs",
  "scripts/verify-gate-g4.mjs",
  "scripts/verify-gate-g5.mjs",
];

for (const g of gates) {
  console.log(`Running ${g}...`);
  execSync(`node "${path.resolve(g)}"`, { stdio: "inherit" });
}

console.log("Compiling TypeScript extension...");
execSync("npm run compile", {
  cwd: path.resolve("vscode-extension"),
  stdio: "inherit",
});

console.log("Running compact UI verification...");
execSync("node ./scripts/test-compact-ui.js", {
  cwd: path.resolve("vscode-extension"),
  stdio: "inherit",
});

console.log("G6_ALL_VERIFICATIONS_PASSED");
process.exit(0);
