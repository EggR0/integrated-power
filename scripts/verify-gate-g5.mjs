import fs from "fs";
import path from "path";

console.log("Verifying G5: AntigravityHistorySync Silent Guard & UserTriggered Logic...");

const file = path.resolve("vscode-extension/src/AntigravityHistorySync.ts");
const content = fs.readFileSync(file, "utf-8");

const okIndex = content.indexOf('if (parsed.status === "ok")');
assert(okIndex !== -1, "Expected 'if (parsed.status === \"ok\")' in runSync");

// 1. Verify userTriggered guard wraps showInformationMessage inside parsed.status === "ok"
const userTriggeredGuardIndex = content.indexOf("if (options.userTriggered) {", okIndex);
assert(userTriggeredGuardIndex !== -1, "Expected 'if (options.userTriggered) {' block after ok status");

// Find closing brace of this if block
let depth = 0;
let blockEnd = -1;
for (let i = userTriggeredGuardIndex; i < content.length; i++) {
  if (content[i] === '{') depth++;
  else if (content[i] === '}') {
    depth--;
    if (depth === 0) {
      blockEnd = i;
      break;
    }
  }
}
assert(blockEnd !== -1, "Could not find end of userTriggered block");

// 2. Ensure ALL showInformationMessage calls are strictly inside this userTriggered block
const occurrences = [...content.matchAll(/showInformationMessage/g)];
assert(occurrences.length > 0, "Expected at least one showInformationMessage call");
for (const match of occurrences) {
  assert(
    match.index >= userTriggeredGuardIndex && match.index <= blockEnd,
    `Found showInformationMessage call at index ${match.index} outside of userTriggered block [${userTriggeredGuardIndex}, ${blockEnd}]`
  );
}

// 3. Ensure debounce timer is increased to at least 10000ms
assert(content.includes("10000"), "Expected 10000ms debounce timer for fs.watch");

// 4. Ensure target-workspace argument forwarding
assert(content.includes('args.push("--target-workspace"'), "Expected target-workspace argument forwarding");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

console.log("G5_SILENT_MODE_GUARD_VERIFIED");
process.exit(0);
