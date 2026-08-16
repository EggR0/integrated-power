/**
 * Integrated Power v0.9.0 – Git Safety Guard
 * RefTransactionCoordinator.ts
 *
 * Implements repo-scoped directory locking, collision-resistant backup-ref creation,
 * dual-policy garbage collection (72h TTL + 50 LRU), and transactional rollback.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface LockOwnerInfo {
  pid: number;
  acquiredAtMs: number;
  hostname: string;
  heartbeatMs: number;
  version: string;
}

export interface LockHandle {
  pid: number;
  acquiredAtMs: number;
  lockPath: string;
  heartbeatTimer?: NodeJS.Timeout;
  release(): Promise<void>;
}

export interface BackupRefDescriptor {
  refName: string;
  headOid: string;
  utc: string;
  pid: number;
  randomHex: string;
  head12: string;
  createdAtMs: number;
}

export interface GcResult {
  collected: BackupRefDescriptor[];
  retained: BackupRefDescriptor[];
}

export class RefTransactionCoordinator {
  public static readonly BACKUP_PREFIX = "refs/eggr-safety/backup/";
  public static readonly STALE_TIMEOUT_MS = 30_000;
  public static readonly DEFAULT_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
  public static readonly DEFAULT_RETENTION_COUNT = 50;

  /**
   * Resolves the git-common-dir for a workspace (handles submodules, worktrees).
   */
  public async resolveGitCommonDir(workspaceRoot: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--git-common-dir"], {
        cwd: workspaceRoot,
        encoding: "utf8",
      });
      const gitDir = stdout.trim();
      return path.isAbsolute(gitDir) ? gitDir : path.resolve(workspaceRoot, gitDir);
    } catch {
      const fallback = path.join(workspaceRoot, ".git");
      return fallback;
    }
  }

  /**
   * Resolves current HEAD commit OID.
   */
  public async getHeadOid(workspaceRoot: string): Promise<string> {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceRoot,
      encoding: "utf8",
    });
    return stdout.trim();
  }

  /**
   * Acquires the repo-scoped directory lock (<git-common-dir>/eggr/locks/ref-txn.lock).
   */
  public async acquireLock(
    workspaceRoot: string,
    options: { timeoutMs?: number; staleThresholdMs?: number } = {},
  ): Promise<LockHandle> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const staleThresholdMs = options.staleThresholdMs ?? RefTransactionCoordinator.STALE_TIMEOUT_MS;
    const gitCommonDir = await this.resolveGitCommonDir(workspaceRoot);
    const lockParentDir = path.join(gitCommonDir, "eggr", "locks");
    const lockPath = path.join(lockParentDir, "ref-txn.lock");
    const ownerFilePath = path.join(lockPath, "owner.json");

    await fs.promises.mkdir(lockParentDir, { recursive: true });

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        await fs.promises.mkdir(lockPath);
        // Lock acquired successfully
        const now = Date.now();
        const ownerInfo: LockOwnerInfo = {
          pid: process.pid,
          acquiredAtMs: now,
          hostname: os.hostname(),
          heartbeatMs: now,
          version: "0.9.0",
        };
        await fs.promises.writeFile(ownerFilePath, JSON.stringify(ownerInfo, null, 2), "utf8");

        const heartbeatTimer = setInterval(async () => {
          try {
            ownerInfo.heartbeatMs = Date.now();
            await fs.promises.writeFile(ownerFilePath, JSON.stringify(ownerInfo, null, 2), "utf8");
          } catch {
            // Heartbeat update failed, lock may have been released
          }
        }, 5_000);

        if (typeof heartbeatTimer.unref === "function") {
          heartbeatTimer.unref();
        }

        const handle: LockHandle = {
          pid: process.pid,
          acquiredAtMs: now,
          lockPath,
          heartbeatTimer,
          release: async () => {
            if (handle.heartbeatTimer) {
              clearInterval(handle.heartbeatTimer);
            }
            try {
              await fs.promises.rm(lockPath, { recursive: true, force: true });
            } catch {
              // Ignore release errors
            }
          },
        };

        return handle;
      } catch (err: any) {
        if (err.code === "EEXIST") {
          // Check if lock is stale
          try {
            const rawOwner = await fs.promises.readFile(ownerFilePath, "utf8");
            const owner: LockOwnerInfo = JSON.parse(rawOwner);
            const isStale = Date.now() - owner.heartbeatMs > staleThresholdMs;

            if (isStale) {
              // Break stale lock
              await fs.promises.rm(lockPath, { recursive: true, force: true });
              continue;
            }
          } catch {
            // Owner file missing or unreadable, check lock dir age
            try {
              const stat = await fs.promises.stat(lockPath);
              if (Date.now() - stat.mtimeMs > staleThresholdMs) {
                await fs.promises.rm(lockPath, { recursive: true, force: true });
                continue;
              }
            } catch {
              // Path gone, retry
              continue;
            }
          }

          // Wait with jitter before retrying
          await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 100)));
        } else {
          throw err;
        }
      }
    }

    throw new Error(`[RefTransactionCoordinator] Failed to acquire lock within ${timeoutMs}ms: ${lockPath}`);
  }

  /**
   * Creates an immutable backup ref under refs/eggr-safety/backup/
   * Format: refs/eggr-safety/backup/<utc>-<pid>-<randomHex>-<head12>
   */
  public async createBackupRef(
    workspaceRoot: string,
    handle: LockHandle,
    customHeadOid?: string,
  ): Promise<BackupRefDescriptor> {
    if (handle.pid !== process.pid) {
      throw new Error(`[RefTransactionCoordinator] Lock owner mismatch: ${handle.pid} !== ${process.pid}`);
    }

    const headOid = customHeadOid || (await this.getHeadOid(workspaceRoot));
    const now = new Date();
    const utc = now.toISOString().replace(/[-:.]/g, "");
    const randomHex = crypto.randomBytes(8).toString("hex");
    const head12 = headOid.slice(0, 12);
    const refName = `${RefTransactionCoordinator.BACKUP_PREFIX}${utc}-${process.pid}-${randomHex}-${head12}`;
    const zeroOid = "0000000000000000000000000000000000000000";

    await execFileAsync("git", ["update-ref", "--create-reflog", refName, headOid, zeroOid], {
      cwd: workspaceRoot,
    });

    return {
      refName,
      headOid,
      utc,
      pid: process.pid,
      randomHex,
      head12,
      createdAtMs: now.getTime(),
    };
  }

  /**
   * Lists all existing backup refs sorted newest first.
   */
  public async listBackupRefs(workspaceRoot: string): Promise<BackupRefDescriptor[]> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        [
          "for-each-ref",
          "--format=%(refname)|%(objectname)|%(creatordate:iso8601)",
          RefTransactionCoordinator.BACKUP_PREFIX,
        ],
        { cwd: workspaceRoot, encoding: "utf8" },
      );

      const descriptors: BackupRefDescriptor[] = [];
      const lines = stdout.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        const [refName, headOid, dateStr] = line.split("|");
        if (!refName || !headOid) {
          continue;
        }

        const suffix = refName.replace(RefTransactionCoordinator.BACKUP_PREFIX, "");
        const parts = suffix.split("-");
        const utc = parts[0] || "";
        const pid = parseInt(parts[1] || "0", 10);
        const randomHex = parts[2] || "";
        const head12 = parts[3] || headOid.slice(0, 12);
        const createdAtMs = dateStr ? new Date(dateStr).getTime() : Date.now();

        descriptors.push({
          refName,
          headOid,
          utc,
          pid,
          randomHex,
          head12,
          createdAtMs,
        });
      }

      return descriptors.sort((a, b) => b.createdAtMs - a.createdAtMs);
    } catch {
      return [];
    }
  }

  /**
   * Garbage-collects stale backup refs based on TTL and LRU retention count.
   */
  public async garbageCollect(
    workspaceRoot: string,
    handle: LockHandle,
    options: { ttlMs?: number; retentionCount?: number } = {},
  ): Promise<GcResult> {
    if (handle.pid !== process.pid) {
      throw new Error(`[RefTransactionCoordinator] Lock owner mismatch: ${handle.pid} !== ${process.pid}`);
    }

    const ttlMs = options.ttlMs ?? RefTransactionCoordinator.DEFAULT_TTL_MS;
    const retentionCount = options.retentionCount ?? RefTransactionCoordinator.DEFAULT_RETENTION_COUNT;
    const allRefs = await this.listBackupRefs(workspaceRoot);
    const now = Date.now();

    const collected: BackupRefDescriptor[] = [];
    const retained: BackupRefDescriptor[] = [];

    for (let i = 0; i < allRefs.length; i++) {
      const ref = allRefs[i];
      const isExpired = now - ref.createdAtMs > ttlMs;
      const isBeyondRetention = i >= retentionCount;

      if (isExpired && isBeyondRetention) {
        try {
          await execFileAsync("git", ["update-ref", "-d", ref.refName, ref.headOid], {
            cwd: workspaceRoot,
          });
          collected.push(ref);
        } catch {
          retained.push(ref);
        }
      } else {
        retained.push(ref);
      }
    }

    return { collected, retained };
  }

  /**
   * Rolls back workspace to a safety ref with uncommitted changes protection.
   */
  public async rollbackSafetyRef(
    workspaceRoot: string,
    refName: string,
    mode: "soft" | "mixed" | "hard" = "mixed",
  ): Promise<{ success: boolean; refName: string; mode: string }> {
    if (!refName.startsWith(RefTransactionCoordinator.BACKUP_PREFIX)) {
      throw new Error(`Invalid safety ref format: ${refName}`);
    }

    if (mode === "hard") {
      // Protect uncommitted working tree changes via stash before hard reset
      let stashed = false;
      try {
        const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
          cwd: workspaceRoot,
          encoding: "utf8",
        });
        if (stdout.trim().length > 0) {
          await execFileAsync("git", ["stash", "push", "-u", "-m", `eggr-auto-stash-before-rollback-${Date.now()}`], {
            cwd: workspaceRoot,
          });
          stashed = true;
        }

        await execFileAsync("git", ["reset", "--hard", refName], {
          cwd: workspaceRoot,
        });

        if (stashed) {
          try {
            await execFileAsync("git", ["stash", "pop"], { cwd: workspaceRoot });
          } catch {
            // Stash pop conflict preserved in stash list
          }
        }
      } catch (err: any) {
        throw new Error(`Hard rollback failed: ${err.message}`);
      }
    } else {
      await execFileAsync("git", ["reset", `--${mode}`, refName], {
        cwd: workspaceRoot,
      });
    }

    return { success: true, refName, mode };
  }
}
