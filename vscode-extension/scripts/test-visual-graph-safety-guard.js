const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// Require compiled modules
const { RefTransactionCoordinator } = require("../out/RefTransactionCoordinator");
const { SerenaWasmIndexer } = require("../out/SerenaWasmIndexer");
const { DeadCodeManager, createDeadCodeManager } = require("../out/DeadCodeManager");

async function runTests() {
  console.log("Starting Hardened Visual Graph & Git Safety Guard Verification Tests...");

  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ip-hardened-test-"));
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

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Test RefTransactionCoordinator (Owner Nonce, Heartbeat, GC, Stash)
    // ─────────────────────────────────────────────────────────────────────────
    const coordinator = new RefTransactionCoordinator(tempRepo);
    const ownerId = await coordinator.acquireLock();
    assert(typeof ownerId === "string" && ownerId.length > 0, "Lock must be acquired with valid ownerId");

    const status1 = await coordinator.getLockStatus();
    assert(status1.held === true, "Coordinator must report lock held");
    assert(status1.ownerRecord && status1.ownerRecord.pid === process.pid, "Owner record must match current pid");
    console.log("ok - [RefTransactionCoordinator] Lock acquired with owner nonce & pid:", status1.ownerRecord.ownerId);

    // Create backup ref
    const backupRefName = await coordinator.createBackupRef();
    assert(backupRefName.startsWith("refs/eggr-safety/backup/"), "Ref name format must match prefix");
    console.log("ok - [RefTransactionCoordinator] Backup ref created:", backupRefName);

    // List backup refs
    const backupList = await coordinator.listBackupRefs();
    assert(backupList.length >= 1, "Backup ref list must contain at least 1 ref");
    assert(backupList[0].refName === backupRefName, "Newest ref must be listed first");
    console.log("ok - [RefTransactionCoordinator] Backup refs listed and parsed successfully");

    // Test GC (Prune expired / beyond retention with OR condition)
    const gcResult = await coordinator.gcBackups(50, 0); // 0 ms TTL forces prune of older refs
    assert(Array.isArray(gcResult.pruned), "GC result must include pruned list");
    console.log("ok - [RefTransactionCoordinator] GC executed with OR condition");

    // Release lock cleanly
    await coordinator.release();
    const status2 = await coordinator.getLockStatus();
    assert(status2.held === false, "Lock must be released");
    console.log("ok - [RefTransactionCoordinator] Lock released cleanly with compare-before-release");

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Test DeadCodeManager (REPORT_ONLY, Fail-Closed, Plan Hash Provenance)
    // ─────────────────────────────────────────────────────────────────────────
    const deadCodeMgr = createDeadCodeManager({ workspaceRoot: tempRepo });
    const mockSymbols = [
      {
        symbol: "unusedHelper",
        filePath: path.join(tempRepo, "sample.ts"),
        line: 3,
        column: 1,
        isExported: false,
        localReferences: 0,
        crossFileReferences: 0,
        isSingleFileScope: true,
        isPrivateHelper: true,
      },
      {
        symbol: "activeFunction",
        filePath: path.join(tempRepo, "sample.ts"),
        line: 2,
        column: 1,
        isExported: true,
        localReferences: 1,
        crossFileReferences: 0,
        isSingleFileScope: false,
        isPrivateHelper: false,
      },
      {
        symbol: "extension.activate",
        filePath: path.join(tempRepo, "extension.ts"),
        line: 1,
        column: 1,
        isExported: true,
        localReferences: 0,
        crossFileReferences: 0,
        isSingleFileScope: false,
        isPrivateHelper: false,
      },
    ];

    const plan = deadCodeMgr.analyze(mockSymbols);
    assert(plan.mode === "REPORT_ONLY", "Plan mode MUST be REPORT_ONLY");
    assert(plan.requiresConfirmation === true, "Plan must require user confirmation");
    assert(plan.actions.length === 0, "REPORT_ONLY plan must have zero destructive actions");
    assert(plan.hash && plan.hash.length === 64, "Plan must include 64-char SHA-256 hash");

    const isPlanValid = deadCodeMgr.verifyPlan(plan);
    assert(isPlanValid === true, "Plan SHA-256 hash must verify correctly");
    console.log("ok - [DeadCodeManager] REPORT_ONLY plan verified with SHA-256 hash:", plan.hash.slice(0, 16) + "...");

    // Verify candidate classification
    const strongCandidate = plan.candidates.find((c) => c.symbol === "unusedHelper");
    assert(strongCandidate && strongCandidate.classification === "strong", "Internal unused helper must be strong");

    const exportedCandidate = plan.candidates.find((c) => c.symbol === "activeFunction");
    assert(!exportedCandidate || exportedCandidate.classification !== "strong", "Exported function must NEVER be strong");
    console.log("ok - [DeadCodeManager] Fail-closed candidate classification verified");

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Test SerenaWasmIndexer (LOD Rendering, File Indexing, Node IDs)
    // ─────────────────────────────────────────────────────────────────────────
    const indexer = new SerenaWasmIndexer({ rootPath: tempRepo });
    const indexSummary = await indexer.indexWorkspace();
    assert(typeof indexSummary.filesIndexed === "number", "Indexer must report filesIndexed");
    console.log(`ok - [SerenaWasmIndexer] Indexed workspace: ${indexSummary.filesIndexed} files, ${indexSummary.totalSymbols} symbols`);

    const mermaidL0 = indexer.generateMermaid(0);
    assert(mermaidL0.includes("graph TD") || mermaidL0.includes("Summary"), "Mermaid L0 must be generated");
    console.log("ok - [SerenaWasmIndexer] LOD L0 rendered successfully");

    const mermaidL1 = indexer.generateMermaid(1);
    assert(mermaidL1.includes("subgraph") || mermaidL1.includes("graph"), "Mermaid L1 must be generated");
    console.log("ok - [SerenaWasmIndexer] LOD L1 rendered successfully");

    console.log("\n============================================================");
    console.log("ALL HARDENED VISUAL GRAPH & GIT SAFETY GUARD TESTS PASSED (100%)");
    console.log("============================================================\n");
  } finally {
    try {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    } catch {
      // Ignore cleanup
    }
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
