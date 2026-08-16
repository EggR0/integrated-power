/**
 * RefTransactionCoordinator.ts
 *
 * Hardened ref-transaction coordinator for the VS Code extension.
 * Implements:
 *   1. Owner Nonce & Compare-Before-Release
 *   2. Heartbeat Async Serialization
 *   3. Windows Directory Removal Hardening
 *   4. Backup Ref GC Policy (72h OR 50 most recent)
 *   5. Rollback Stash Safety (no silent conflict swallowing)
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface OwnerRecord {
  ownerId: string;
  pid: number;
  hostname: string;
  acquiredAt: string; // ISO-8601 UTC
  heartbeat: string;  // ISO-8601 UTC (last heartbeat)
  lockVersion: number;
}

export interface BackupRefInfo {
  refName: string;
  utcTimestamp: string;
  pid: string;
  randomHex: string;
  head12: string;
  parsedDate: Date;
}

export interface StashConflictDetails {
  stashRef: string;
  conflictedFiles: string[];
  rawOutput: string;
  exitCode: number;
  timestamp: string;
}

export interface TransactionResult {
  success: boolean;
  backupRef?: string;
  stashRef?: string;
  conflict?: StashConflictDetails;
  error?: string;
}

export interface GcResult {
  pruned: string[];
  retained: string[];
  totalBefore: number;
  totalAfter: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_DIR_NAME = ".eggr-safety-lock";
const OWNER_FILE = "owner.json";
const BACKUP_REF_PREFIX = "refs/eggr-safety/backup/";
const BACKUP_RETENTION_COUNT = 50;
const BACKUP_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours
const HEARTBEAT_INTERVAL_MS = 5_000;
const STALE_THRESHOLD_MS = 30_000; // 30s without heartbeat → stale
const REMOVE_DIR_MAX_RETRIES = 3;
const REMOVE_DIR_BACKOFF_MS = [50, 150, 450]; // exponential-ish backoff

// ─────────────────────────────────────────────────────────────────────────────
// Utility: safe directory removal with retry (Windows EPERM/EBUSY/ENOTEMPTY)
// ─────────────────────────────────────────────────────────────────────────────

async function safeRemoveDirWithRetry(
  dirPath: string,
  maxRetries: number = REMOVE_DIR_MAX_RETRIES
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      return;
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      const retryableCodes = ["EPERM", "EBUSY", "ENOTEMPTY"];
      const isRetryable =
        retryableCodes.includes(e.code ?? "") ||
        (e.message?.includes("EPERM") ?? false) ||
        (e.message?.includes("EBUSY") ?? false) ||
        (e.message?.includes("ENOTEMPTY") ?? false);

      if (!isRetryable || attempt === maxRetries) {
        throw new Error(
          `safeRemoveDirWithRetry: failed to remove "${dirPath}" after ${attempt + 1} attempt(s): ${e.message}`
        );
      }

      const backoffMs = REMOVE_DIR_BACKOFF_MS[attempt] ?? 450;
      await sleep(backoffMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: parse backup ref name
// ─────────────────────────────────────────────────────────────────────────────

function parseBackupRefName(refName: string): BackupRefInfo | null {
  // Expected format: refs/eggr-safety/backup/<utc>-<pid>-<randomHex>-<head12>
  const relative = refName.startsWith(BACKUP_REF_PREFIX)
    ? refName.slice(BACKUP_REF_PREFIX.length)
    : null;

  if (!relative) return null;

  // Split by hyphens to get the components
  const parts = relative.split("-");
  if (parts.length < 4) return null;

  const head12 = parts[parts.length - 1];
  const randomHex = parts[parts.length - 2];
  const pid = parts[parts.length - 3];
  const utcTimestamp = parts.slice(0, parts.length - 3).join("-");

  // Reconstruct ISO 8601 string: 2026-08-16T08-53-51-136Z -> 2026-08-16T08:53:51.136Z
  const isoNormalized = utcTimestamp
    .replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1T$2:$3:$4.$5Z")
    .replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/, "$1T$2:$3:$4Z");

  let parsedDate = new Date(isoNormalized);
  if (isNaN(parsedDate.getTime())) {
    parsedDate = new Date(utcTimestamp);
  }
  if (isNaN(parsedDate.getTime())) {
    parsedDate = new Date();
  }

  return { refName, utcTimestamp, pid, randomHex, head12, parsedDate };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Class
// ─────────────────────────────────────────────────────────────────────────────

export class RefTransactionCoordinator {
  private readonly repoRoot: string;
  private readonly lockDir: string;
  private readonly ownerFilePath: string;

  private currentOwnerId: string | null = null;
  private lockVersion: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatInFlight: Promise<void> | null = null;
  private releasing: boolean = false;
  private disposed: boolean = false;

  constructor(repoRoot: string) {
    this.repoRoot = path.resolve(repoRoot);
    this.lockDir = path.join(this.repoRoot, LOCK_DIR_NAME);
    this.ownerFilePath = path.join(this.lockDir, OWNER_FILE);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lock Acquisition
  // ─────────────────────────────────────────────────────────────────────────

  async acquireLock(): Promise<string> {
    if (this.disposed) {
      throw new Error("RefTransactionCoordinator has been disposed.");
    }
    if (this.currentOwnerId !== null) {
      throw new Error("Lock already held by this coordinator instance.");
    }

    const ownerId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create lock directory (atomic on POSIX; on Windows we use a file-based check)
    try {
      await fs.mkdir(this.lockDir, { recursive: false });
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "EEXIST") {
        // Lock already exists — check if stale
        const stale = await this.isLockStale();
        if (!stale) {
          throw new Error(
            "Lock is held by another active process. Use stealLock() to force-acquire."
          );
        }
        // Stale lock: remove and retry
        await safeRemoveDirWithRetry(this.lockDir);
        await fs.mkdir(this.lockDir, { recursive: false });
      } else {
        throw err;
      }
    }

    // Write owner.json
    const ownerRecord: OwnerRecord = {
      ownerId,
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: now,
      heartbeat: now,
      lockVersion: 1,
    };

    await this.writeOwnerRecord(ownerRecord);

    this.currentOwnerId = ownerId;
    this.lockVersion = 1;
    this.releasing = false;

    this.startHeartbeat();

    return ownerId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lock Release (Compare-Before-Release)
  // ─────────────────────────────────────────────────────────────────────────

  async release(): Promise<void> {
    if (this.disposed) {
      throw new Error("RefTransactionCoordinator has been disposed.");
    }
    if (this.currentOwnerId === null) {
      throw new Error("No lock to release.");
    }
    if (this.releasing) {
      throw new Error("Release already in progress.");
    }

    this.releasing = true;
    this.stopHeartbeat();

    try {
      // Compare-Before-Release: read owner.json and verify ownership
      let ownerRecord: OwnerRecord | null = null;
      try {
        const raw = await fs.readFile(this.ownerFilePath, "utf-8");
        ownerRecord = JSON.parse(raw) as OwnerRecord;
      } catch {
        // owner.json missing or unreadable — we still attempt removal
        // but log a warning
        console.warn(
          "[RefTransactionCoordinator] WARNING: owner.json not readable during release."
        );
      }

      if (ownerRecord !== null && ownerRecord.ownerId !== this.currentOwnerId) {
        // Lock was stolen by another process — do NOT delete
        console.error(
          `[RefTransactionCoordinator] REFUSING to release: owner mismatch. ` +
          `Expected "${this.currentOwnerId}", found "${ownerRecord.ownerId}". ` +
          `Lock was likely stolen. Leaving lock directory intact.`
        );
        this.currentOwnerId = null;
        return;
      }

      // Ownership confirmed — safe to remove
      await safeRemoveDirWithRetry(this.lockDir);
      this.currentOwnerId = null;
    } finally {
      this.releasing = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Steal Lock (with re-read verification)
  // ─────────────────────────────────────────────────────────────────────────

  async stealLock(): Promise<string> {
    if (this.disposed) {
      throw new Error("RefTransactionCoordinator has been disposed.");
    }
    if (this.currentOwnerId !== null) {
      throw new Error("Already holding a lock. Release first.");
    }

    // Re-read owner.json immediately before stealing to ensure lock is still stale
    let existingOwner: OwnerRecord | null = null;
    try {
      const raw = await fs.readFile(this.ownerFilePath, "utf-8");
      existingOwner = JSON.parse(raw) as OwnerRecord;
    } catch {
      // No owner file — lock dir may be empty/corrupt
    }

    if (existingOwner !== null) {
      // Verify it's actually stale
      const heartbeatDate = new Date(existingOwner.heartbeat);
      const ageMs = Date.now() - heartbeatDate.getTime();
      if (ageMs < STALE_THRESHOLD_MS) {
        throw new Error(
          `Cannot steal lock: owner "${existingOwner.ownerId}" (pid ${existingOwner.pid}) ` +
          `has a recent heartbeat (${ageMs}ms ago). Lock is NOT stale.`
        );
      }

      // Double-check: if the owner is still alive (same machine, same pid), refuse
      if (
        existingOwner.hostname === os.hostname() &&
        existingOwner.pid === process.pid
      ) {
        throw new Error(
          "Cannot steal lock from self. This would indicate a logic error."
        );
      }
    }

    // Remove existing lock directory
    await safeRemoveDirWithRetry(this.lockDir);

    // Acquire fresh
    return this.acquireLock();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Heartbeat (Async Serialization)
  // ─────────────────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    // Unref so the timer doesn't keep the process alive
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async heartbeat(): Promise<void> {
    // Abort immediately if releasing or owner changed
    if (this.releasing || this.disposed) return;
    if (this.currentOwnerId === null) return;

    // Serialize: if a heartbeat is already in-flight, skip this tick
    if (this.heartbeatInFlight !== null) {
      return;
    }

    const capturedOwnerId = this.currentOwnerId;

    this.heartbeatInFlight = (async () => {
      try {
        // Re-check ownership before writing
        if (
          this.releasing ||
          this.disposed ||
          this.currentOwnerId !== capturedOwnerId
        ) {
          return;
        }

        const now = new Date().toISOString();
        const ownerRecord: OwnerRecord = {
          ownerId: capturedOwnerId,
          pid: process.pid,
          hostname: os.hostname(),
          acquiredAt: now, // preserved from original; we'll read it
          heartbeat: now,
          lockVersion: this.lockVersion,
        };

        // Read existing to preserve acquiredAt
        try {
          const raw = await fs.readFile(this.ownerFilePath, "utf-8");
          const existing = JSON.parse(raw) as OwnerRecord;
          if (existing.ownerId === capturedOwnerId) {
            ownerRecord.acquiredAt = existing.acquiredAt;
            ownerRecord.lockVersion = existing.lockVersion;
          }
        } catch {
          // If we can't read, use current values
        }

        // Final ownership check before write
        if (this.currentOwnerId !== capturedOwnerId || this.releasing) {
          return;
        }

        await this.writeOwnerRecord(ownerRecord);
      } catch (err) {
        // Heartbeat failure is non-fatal but should be logged
        console.error(
          "[RefTransactionCoordinator] Heartbeat write failed:",
          err
        );
      } finally {
        this.heartbeatInFlight = null;
      }
    })();

    // Await completion to maintain serialization
    await this.heartbeatInFlight;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Owner Record I/O
  // ─────────────────────────────────────────────────────────────────────────

  private async writeOwnerRecord(record: OwnerRecord): Promise<void> {
    const json = JSON.stringify(record, null, 2);
    // Write to temp file then rename for atomicity
    const tmpPath = `${this.ownerFilePath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmpPath, json, "utf-8");
    await fs.rename(tmpPath, this.ownerFilePath);
  }

  private async isLockStale(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.ownerFilePath, "utf-8");
      const record = JSON.parse(raw) as OwnerRecord;
      const heartbeatDate = new Date(record.heartbeat);
      const ageMs = Date.now() - heartbeatDate.getTime();
      return ageMs > STALE_THRESHOLD_MS;
    } catch {
      // No readable owner file → treat as stale
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Transaction: Begin / Commit / Abort
  // ─────────────────────────────────────────────────────────────────────────

  async beginTransaction(): Promise<TransactionResult> {
    this.ensureLock();

    // Create a backup ref of current HEAD
    const backupRef = await this.createBackupRef();

    return { success: true, backupRef };
  }

  async commitTransaction(): Promise<TransactionResult> {
    this.ensureLock();
    // Commit is a no-op in terms of ref manipulation — the working tree
    // changes are already applied. We just ensure the lock is still valid.
    return { success: true };
  }

  async abortTransaction(backupRef?: string): Promise<TransactionResult> {
    this.ensureLock();

    if (backupRef) {
      // Reset to the backup ref
      await this.gitExec(["reset", "--hard", backupRef]);
    }

    // Attempt stash pop if a stash was created
    const stashResult = await this.rollbackStash();

    return {
      success: true,
      stashRef: stashResult?.stashRef,
      conflict: stashResult?.conflict,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Backup Ref Creation & Listing
  // ─────────────────────────────────────────────────────────────────────────

  async createBackupRef(): Promise<string> {
    this.ensureLock();
    const utc = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
    const pid = String(process.pid);
    const randomHex = crypto.randomBytes(4).toString("hex");

    // Get current HEAD short hash
    const head12 = await this.gitExec(["rev-parse", "--short=12", "HEAD"]);

    const refName = `${BACKUP_REF_PREFIX}${utc}-${pid}-${randomHex}-${head12}`;

    await this.gitExec(["update-ref", refName, "HEAD"]);

    return refName;
  }

  async listBackupRefs(): Promise<BackupRefInfo[]> {
    this.ensureLock();
    const refsOutput = await this.gitExec([
      "for-each-ref",
      "--format=%(refname)",
      BACKUP_REF_PREFIX,
    ]);

    const allRefs = refsOutput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsed: BackupRefInfo[] = [];
    for (const ref of allRefs) {
      const info = parseBackupRefName(ref);
      if (info !== null) {
        parsed.push(info);
      }
    }

    parsed.sort((a, b) => b.parsedDate.getTime() - a.parsedDate.getTime());
    return parsed;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Backup Ref GC
  // ─────────────────────────────────────────────────────────────────────────

  async gcBackups(): Promise<GcResult> {
    this.ensureLock();

    // List all backup refs
    const refsOutput = await this.gitExec([
      "for-each-ref",
      "--format=%(refname)",
      BACKUP_REF_PREFIX,
    ]);

    const allRefs = refsOutput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const now = Date.now();
    const pruned: string[] = [];
    const retained: string[] = [];

    // Parse all refs
    const parsed: BackupRefInfo[] = [];
    for (const ref of allRefs) {
      const info = parseBackupRefName(ref);
      if (info !== null) {
        parsed.push(info);
      } else {
        // Unparseable ref — retain it (safety)
        retained.push(ref);
      }
    }

    // Sort by parsed date descending (most recent first)
    parsed.sort((a, b) => b.parsedDate.getTime() - a.parsedDate.getTime());

    // Apply GC policy: delete if expired OR beyond retention (OR condition)
    for (let i = 0; i < parsed.length; i++) {
      const info = parsed[i];
      const ageMs = now - info.parsedDate.getTime();
      const expired = ageMs > BACKUP_EXPIRY_MS;
      const beyondRetention = i >= BACKUP_RETENTION_COUNT;

      if (expired || beyondRetention) {
        pruned.push(info.refName);
      } else {
        retained.push(info.refName);
      }
    }

    // Delete pruned refs
    for (const ref of pruned) {
      try {
        await this.gitExec(["update-ref", "-d", ref]);
      } catch (err) {
        console.warn(
          `[RefTransactionCoordinator] GC: failed to delete ref "${ref}":`,
          err
        );
      }
    }

    return {
      pruned,
      retained,
      totalBefore: allRefs.length,
      totalAfter: retained.length,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rollback Stash Safety
  // ─────────────────────────────────────────────────────────────────────────

  async rollbackStash(): Promise<{ stashRef?: string; conflict?: StashConflictDetails } | null> {
    this.ensureLock();

    // Check if there's a stash to pop
    let stashList: string;
    try {
      stashList = await this.gitExec(["stash", "list"]);
    } catch {
      return null; // No stash
    }

    if (stashList.trim().length === 0) {
      return null;
    }

    const stashRef = "stash@{0}";

    // Attempt stash pop
    let exitCode: number;
    let stdout: string;
    let stderr: string;

    try {
      const result = await this.gitExecRaw(["stash", "pop"]);
      exitCode = result.code;
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      exitCode = e.code ?? 1;
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? e.message ?? "";
    }

    if (exitCode !== 0) {
      // DO NOT swallow the conflict — return details and keep the stash ref
      const conflictedFiles = this.parseConflictedFiles(stdout + "\n" + stderr);

      const conflict: StashConflictDetails = {
        stashRef,
        conflictedFiles,
        rawOutput: `${stdout}\n${stderr}`,
        exitCode,
        timestamp: new Date().toISOString(),
      };

      console.error(
        `[RefTransactionCoordinator] STASH POP CONFLICT: ` +
        `stash="${stashRef}", conflictedFiles=[${conflictedFiles.join(", ")}]. ` +
        `Stash ref is PRESERVED for manual resolution.`
      );

      return { stashRef, conflict };
    }

    return { stashRef };
  }

  private parseConflictedFiles(output: string): string[] {
    const files: string[] = [];
    const lines = output.split("\n");
    for (const line of lines) {
      // Match patterns like:
      //   "CONFLICT (content): Merge conflict in <file>"
      //   "Auto-merging <file>"
      //   "  both modified:   <file>"
      //   "Unmerged paths:"
      const conflictMatch = line.match(/CONFLICT.*?:.*?in\s+(.+)/);
      if (conflictMatch) {
        files.push(conflictMatch[1].trim());
        continue;
      }
      const bothModified = line.match(/\s+both modified:\s+(.+)/);
      if (bothModified) {
        files.push(bothModified[1].trim());
        continue;
      }
      const addedByUs = line.match(/\s+added by us:\s+(.+)/);
      if (addedByUs) {
        files.push(addedByUs[1].trim());
        continue;
      }
      const addedByThem = line.match(/\s+added by them:\s+(.+)/);
      if (addedByThem) {
        files.push(addedByThem[1].trim());
        continue;
      }
    }
    return [...new Set(files)];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Git Execution Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async gitExec(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: this.repoRoot,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  }

  private async gitExecRaw(
    args: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        args,
        { cwd: this.repoRoot, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            // execFile sets error.code to the exit code
            resolve({
              code: (error as { code?: number }).code ?? 1,
              stdout: stdout ?? "",
              stderr: stderr ?? (error as Error).message,
            });
          } else {
            resolve({ code: 0, stdout: stdout ?? "", stderr: stderr ?? "" });
          }
        }
      );
      child.on("error", (err) => reject(err));
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  private ensureLock(): void {
    if (this.disposed) {
      throw new Error("RefTransactionCoordinator has been disposed.");
    }
    if (this.currentOwnerId === null) {
      throw new Error("No active lock. Call acquireLock() first.");
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopHeartbeat();

    // Wait for any in-flight heartbeat to complete
    if (this.heartbeatInFlight !== null) {
      try {
        await this.heartbeatInFlight;
      } catch {
        // Ignore
      }
    }

    // Release lock if held
    if (this.currentOwnerId !== null) {
      try {
        await this.release();
      } catch (err) {
        console.error(
          "[RefTransactionCoordinator] Error during dispose release:",
          err
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Diagnostics
  // ─────────────────────────────────────────────────────────────────────────

  async getLockStatus(): Promise<{
    held: boolean;
    ownerId: string | null;
    ownerRecord: OwnerRecord | null;
    stale: boolean;
  }> {
    let ownerRecord: OwnerRecord | null = null;
    try {
      const raw = await fs.readFile(this.ownerFilePath, "utf-8");
      ownerRecord = JSON.parse(raw) as OwnerRecord;
    } catch {
      // No lock
    }

    const held = this.currentOwnerId !== null;
    const stale =
      ownerRecord !== null
        ? Date.now() - new Date(ownerRecord.heartbeat).getTime() > STALE_THRESHOLD_MS
        : false;

    return {
      held,
      ownerId: this.currentOwnerId,
      ownerRecord,
      stale,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export default RefTransactionCoordinator;