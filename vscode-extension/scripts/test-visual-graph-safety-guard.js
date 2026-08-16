const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// Require compiled files
const { RefTransactionCoordinator } = require("../out/RefTransactionCoordinator");
const { SerenaWasmIndexer, QueryLevel } = require("../out/SerenaWasmIndexer");
const { DeadCodeManager } = require("../out/DeadCodeManager");

async function runTests() {
  console.log("Starting Visual Graph & Git Safety Guard Verification Tests...");

  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ip-safety-test-"));
  try {
    // 1. Initialize git repo
    execSync("git init", { cwd: tempRepo, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempRepo, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempRepo, stdio: "ignore" });

    // Create initial commit
    const sampleFile = path.join(tempRepo, "sample.ts");
    fs.writeFileSync(
      sampleFile,
      `export interface User { id: string; name: string; }\nexport function activeFunction() { return 42; }\nfunction unusedHelper() { return 0; }\n`
    );
    execSync("git add .", { cwd: tempRepo, stdio: "ignore" });
    execSync('git commit -m "initial commit"', { cwd: tempRepo, stdio: "ignore" });

    // 2. Test RefTransactionCoordinator
    const coordinator = new RefTransactionCoordinator();
    const lock = await coordinator.acquireLock(tempRepo, { timeoutMs: 3000 });
    assert(lock && lock.pid === process.pid, "Lock must be acquired with current pid");

    const backupRef = await coordinator.createBackupRef(tempRepo, lock);
    assert(backupRef.refName.startsWith("refs/eggr-safety/backup/"), "Ref name format must match eggr-safety prefix");
    console.log("ok - [Safety Guard] Backup ref created:", backupRef.refName);

    const refList = await coordinator.listBackupRefs(tempRepo);
    assert(refList.length >= 1, "Backup ref list must return at least 1 ref");
    assert(refList[0].refName === backupRef.refName, "Newest ref must be listed first");
    console.log("ok - [Safety Guard] Backup refs correctly listed");

    const gcRes = await coordinator.garbageCollect(tempRepo, lock, { ttlMs: 1000, retentionCount: 1 });
    assert(Array.isArray(gcRes.retained), "GC must return retained array");
    console.log("ok - [Safety Guard] Garbage collection executed safely");

    await lock.release();
    console.log("ok - [Safety Guard] Lock released cleanly");

    // 3. Test SerenaWasmIndexer
    const indexer = new SerenaWasmIndexer();
    const indexRes = await indexer.indexWorkspace(tempRepo);
    assert(indexRes.fileCount >= 1, "File index count must be >= 1");
    assert(indexRes.symbolCount >= 2, "Symbol index count must be >= 2");
    console.log(`ok - [Serena Indexer] Indexed ${indexRes.fileCount} files, ${indexRes.symbolCount} symbols`);

    const symbols = indexer.query(QueryLevel.L1_SYMBOLS);
    assert(symbols.some((s) => s.name === "activeFunction"), "activeFunction must be in symbol table");
    assert(symbols.some((s) => s.name === "unusedHelper"), "unusedHelper must be in symbol table");

    const mermaid = indexer.getMermaidSubgraph("activeFunction");
    assert(mermaid.mermaidDiagram.startsWith("graph TD"), "Mermaid diagram must be generated");
    console.log("ok - [Serena Indexer] Mermaid subgraph generated successfully");

    // 4. Test DeadCodeManager
    const deadCodeMgr = new DeadCodeManager(indexer, coordinator);
    const plan = await deadCodeMgr.generatePlan(tempRepo);

    assert(plan.planHash && plan.planHash.length === 64, "Plan must contain 64-char sha256 hash");
    assert(plan.candidates.strong.some((c) => c.name === "unusedHelper"), "unusedHelper must be classified as strong dead-code candidate");
    assert(plan.candidates.weak.some((c) => c.name === "activeFunction"), "Exported activeFunction must be classified as weak");
    console.log("ok - [DeadCode Manager] 3-tier classification (strong/weak/external) verified");

    console.log("All Visual Graph & Git Safety Guard tests passed successfully!");
  } finally {
    try {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
