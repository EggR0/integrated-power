/**
 * DeadCodeManager.ts
 *
 * A strictly advisory, non-destructive dead-code detection manager for VS Code extensions.
 *
 * Design Principles:
 *   1. REPORT_ONLY — This module NEVER performs, schedules, or suggests destructive
 *      file-system mutations. All output is diagnostic.
 *   2. Fail-Closed — Any symbol whose usage cannot be definitively proven is
 *      classified as `weak` or `advisory`, never `strong`.
 *   3. Provenance — Every generated plan is cryptographically hashed (SHA-256)
 *      over its content, a UTC timestamp, and the current git HEAD.
 *
 * @module DeadCodeManager
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/** Classification severity levels (fail-closed ordering). */
export type Classification = "strong" | "weak" | "advisory";

/** The ONLY permitted plan mode. */
export const PLAN_MODE_REPORT_ONLY = "REPORT_ONLY" as const;
export type PlanMode = typeof PLAN_MODE_REPORT_ONLY;

/** A single symbol flagged as potentially dead. */
export interface DeadCodeCandidate {
  /** Fully-qualified symbol name (e.g. `MyClass.privateHelper`). */
  readonly symbol: string;
  /** Absolute file path where the symbol is declared. */
  readonly filePath: string;
  /** 1-based line number of the declaration. */
  readonly line: number;
  /** 1-based column of the declaration. */
  readonly column: number;
  /** Assigned classification. */
  readonly classification: Classification;
  /** Human-readable justification for the classification. */
  readonly reason: string;
  /** Whether the symbol is exported from its module. */
  readonly isExported: boolean;
  /** Whether the symbol is a VS Code command handler or activation entrypoint. */
  readonly isVsCodeCommand: boolean;
  /** Whether the symbol is an extension activation/deactivation entrypoint. */
  readonly isActivationEntrypoint: boolean;
  /** Number of local (same-file) references found. */
  readonly localReferences: number;
  /** Number of cross-file references found (0 if unknown). */
  readonly crossFileReferences: number;
  /** Whether cross-file usage could not be determined (fail-closed signal). */
  readonly crossFileUsageUnknown: boolean;
}

/** An immutable, hash-verified diagnostic plan. */
export interface DeadCodePlan {
  /** Unique plan identifier (UUID v4). */
  readonly id: string;
  /** Always `"REPORT_ONLY"`. */
  readonly mode: PlanMode;
  /** The list of candidates in this plan. */
  readonly candidates: readonly DeadCodeCandidate[];
  /** ISO-8601 UTC timestamp of plan generation. */
  readonly timestamp: string;
  /** The git HEAD SHA at the time of analysis (or `"unknown"`). */
  readonly gitHead: string;
  /** SHA-256 hex digest over plan content + timestamp + gitHead. */
  readonly hash: string;
  /** Always `true` — user confirmation is mandatory before any downstream action. */
  readonly requiresConfirmation: true;
  /**
   * Intentionally empty. This field exists to make it structurally impossible
   * for a consumer to accidentally invoke a destructive action list.
   */
  readonly actions: readonly never[];
  /** Version of the DeadCodeManager that produced this plan. */
  readonly managerVersion: string;
}

/** Input describing a single symbol to evaluate. */
export interface SymbolInfo {
  readonly symbol: string;
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly isExported: boolean;
  readonly localReferences: number;
  /** If `undefined`, cross-file usage is unknown (fail-closed). */
  readonly crossFileReferences?: number;
  /** Whether the symbol is declared inside a single-file scope (no re-exports). */
  readonly isSingleFileScope: boolean;
  /** Whether the symbol is a private/internal helper (not exported, not in public API). */
  readonly isPrivateHelper: boolean;
}

/** Options for the DeadCodeManager instance. */
export interface DeadCodeManagerOptions {
  /** Root directory of the workspace (used for git HEAD lookup). */
  readonly workspaceRoot?: string;
  /** Additional symbol names to whitelist (never flagged). */
  readonly extraWhitelist?: readonly string[];
  /** Maximum number of candidates per plan (default 500). */
  readonly maxCandidatesPerPlan?: number;
  /** Optional logger; defaults to a no-op. */
  readonly logger?: DeadCodeLogger;
}

/** Minimal logger interface to avoid coupling to a specific logging library. */
export interface DeadCodeLogger {
  debug(msg: string, ...meta: unknown[]): void;
  info(msg: string, ...meta: unknown[]): void;
  warn(msg: string, ...meta: unknown[]): void;
  error(msg: string, ...meta: unknown[]): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MANAGER_VERSION = "1.0.0";
const DEFAULT_MAX_CANDIDATES = 500;

/**
 * Whitelist of symbol names that are NEVER classified as dead code.
 * These are VS Code extension API entrypoints and common lifecycle hooks.
 */
const VSCODE_COMMAND_WHITELIST: ReadonlySet<string> = new Set([
  // Extension lifecycle
  "activate",
  "deactivate",
  // Common VS Code command registration patterns
  "registerCommand",
  "registerTextEditorCommand",
  "registerWebviewPanelSerializer",
  "registerWindowMessageHandler",
  // Extension API surface
  "extension",
  "extensionExports",
  // Common entrypoint names
  "main",
  "start",
  "init",
  "setup",
  "bootstrap",
  // VS Code-specific
  "onDidOpenTextDocument",
  "onDidCloseTextDocument",
  "onDidChangeActiveTextEditor",
  "onDidChangeConfiguration",
  "onDidSaveTextDocument",
  "onWillSaveTextDocument",
  "onDidOpenNotebookDocument",
  "onDidCloseNotebookDocument",
  "onDidChangeNotebookDocument",
  "onDidOpenTerminal",
  "onDidCloseTerminal",
  "onDidStartTerminalShellExecution",
  "onDidEndTerminalShellExecution",
  "onDidReceiveTerminalShellExecutionRequest",
  "onDidOpenOutputChannel",
  "onDidCloseOutputChannel",
  "onDidOpenTerminalProfile",
  "onDidCloseTerminalProfile",
  "onDidOpenTask",
  "onDidCloseTask",
  "onDidOpenDebugSession",
  "onDidCloseDebugSession",
  "onDidOpenTaskPanel",
  "onDidCloseTaskPanel",
  "onDidOpenTerminalShell",
  "onDidCloseTerminalShell",
  "onDidOpenTerminalShellExecution",
  "onDidCloseTerminalShellExecution",
  "onDidOpenTerminalShellRequest",
  "onDidCloseTerminalShellRequest",
]);

/**
 * Patterns that indicate a symbol is a VS Code command handler
 * (e.g., `myExtension.doSomething`, `editor.action.foo`).
 */
const VSCODE_COMMAND_PATTERN =
  /^(editor\.|workbench\.|terminal\.|debug\.|search\.|scm\.|testing\.|tasks\.|notebook\.|problems\.|output\.|extensions\.|vscode\.|window\.|workspace\.|commands\.|languages\.|authentication\.|telemetry\.|lsp\.|markdown\.|notebook\.|terminal\.shellExecution\.|terminal\.profile\.|terminal\.task\.|terminal\.shell\.|terminal\.request\.|terminal\.execution\.|terminal\.close\.|terminal\.open\.|terminal\.start\.|terminal\.end\.|terminal\.receive\.|terminal\.send\.|terminal\.write\.|terminal\.append\.|terminal\.clear\.|terminal\.dispose\.|terminal\.hide\.|terminal\.show\.|terminal\.create\.|terminal\.register\.|terminal\.unregister\.|terminal\.onDid|terminal\.onWill|terminal\.onDidEnd|terminal\.onDidStart|terminal\.onDidReceive|terminal\.onDidSend|terminal\.onDidWrite|terminal\.onDidAppend|terminal\.onDidClear|terminal\.onDidDispose|terminal\.onDidHide|terminal\.onDidShow|terminal\.onDidCreate|terminal\.onDidRegister|terminal\.onDidUnregister|terminal\.onDidOpen|terminal\.onDidClose|terminal\.onDidStart|terminal\.onDidEnd|terminal\.onDidReceive|terminal\.onDidSend|terminal\.onDidWrite|terminal\.onDidAppend|terminal\.onDidClear|terminal\.onDidDispose|terminal\.onDidHide|terminal\.onDidShow|terminal\.onDidCreate|terminal\.onDidRegister|terminal\.onDidUnregister)\S+$/;

// ─────────────────────────────────────────────────────────────────────────────
// Default No-Op Logger
// ─────────────────────────────────────────────────────────────────────────────

const noopLogger: DeadCodeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─────────────────────────────────────────────────────────────────────────────
// DeadCodeManager
// ─────────────────────────────────────────────────────────────────────────────

export class DeadCodeManager {
  private readonly _workspaceRoot: string;
  private readonly _extraWhitelist: ReadonlySet<string>;
  private readonly _maxCandidates: number;
  private readonly _logger: DeadCodeLogger;

  constructor(options: DeadCodeManagerOptions = {}) {
    this._workspaceRoot = options.workspaceRoot ?? process.cwd();
    this._extraWhitelist = new Set(options.extraWhitelist ?? []);
    this._maxCandidates = options.maxCandidatesPerPlan ?? DEFAULT_MAX_CANDIDATES;
    this._logger = options.logger ?? noopLogger;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Analyze a set of symbols and produce a REPORT_ONLY diagnostic plan.
   *
   * This method is **purely advisory**. It will never:
   *   - Delete, rename, or modify any file.
   *   - Generate executable deletion scripts.
   *   - Schedule any background mutation.
   *
   * @param symbols - The symbols to evaluate.
   * @returns A hash-verified, confirmation-required diagnostic plan.
   * @throws {Error} If the plan cannot be generated (e.g., hashing failure).
   */
  public analyze(symbols: readonly SymbolInfo[]): DeadCodePlan {
    this._logger.debug("DeadCodeManager.analyze: starting", {
      symbolCount: symbols.length,
    });

    const candidates: DeadCodeCandidate[] = [];

    for (const sym of symbols) {
      const candidate = this._classifySymbol(sym);
      if (candidate !== null) {
        candidates.push(candidate);
      }
    }

    // Enforce max candidates (sort by severity: strong > weak > advisory)
    const sorted = candidates.sort((a, b) => {
      const order: Record<Classification, number> = {
        strong: 0,
        weak: 1,
        advisory: 2,
      };
      return order[a.classification] - order[b.classification];
    });

    const truncated = sorted.slice(0, this._maxCandidates);

    if (truncated.length < candidates.length) {
      this._logger.warn(
        `DeadCodeManager: truncated plan from ${candidates.length} to ${this._maxCandidates} candidates`
      );
    }

    const timestamp = new Date().toISOString();
    const gitHead = this._resolveGitHead();
    const id = crypto.randomUUID();

    // Compute the plan hash BEFORE embedding it (hash covers content + timestamp + gitHead)
    const hashPayload = this._buildHashPayload(id, truncated, timestamp, gitHead);
    const hash = this._computeSha256(hashPayload);

    const plan: DeadCodePlan = Object.freeze({
      id,
      mode: PLAN_MODE_REPORT_ONLY,
      candidates: Object.freeze(truncated),
      timestamp,
      gitHead,
      hash,
      requiresConfirmation: true,
      actions: Object.freeze([] as never[]),
      managerVersion: MANAGER_VERSION,
    });

    this._logger.info("DeadCodeManager.analyze: plan generated", {
      planId: id,
      candidateCount: truncated.length,
      hash,
    });

    return plan;
  }

  /**
   * Verify the integrity of a previously generated plan by recomputing its hash.
   *
   * @param plan - The plan to verify.
   * @returns `true` if the hash matches, `false` otherwise.
   */
  public verifyPlan(plan: DeadCodePlan): boolean {
    try {
      const hashPayload = this._buildHashPayload(
        plan.id,
        plan.candidates,
        plan.timestamp,
        plan.gitHead
      );
      const recomputed = this._computeSha256(hashPayload);
      return recomputed === plan.hash;
    } catch (err) {
      this._logger.error("DeadCodeManager.verifyPlan: verification failed", err);
      return false;
    }
  }

  /**
   * Check whether a given symbol name is whitelisted (never flagged as dead).
   */
  public isWhitelisted(symbolName: string): boolean {
    if (VSCODE_COMMAND_WHITELIST.has(symbolName)) return true;
    if (this._extraWhitelist.has(symbolName)) return true;
    if (VSCODE_COMMAND_PATTERN.test(symbolName)) return true;
    return false;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: Classification Logic (Fail-Closed)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Classify a single symbol. Returns `null` if the symbol is whitelisted
   * or should not be flagged at all.
   *
   * Fail-Closed Rules:
   *   - If cross-file usage is unknown → NEVER `strong`.
   *   - If the symbol is exported → NEVER `strong`.
   *   - If the symbol is a VS Code command / activation entrypoint → NEVER flagged.
   *   - `strong` requires: private helper + single-file scope + zero local refs +
   *     zero cross-file refs (definitively known, not unknown).
   */
  private _classifySymbol(sym: SymbolInfo): DeadCodeCandidate | null {
    // ── Whitelist check: never flag these ──
    if (this.isWhitelisted(sym.symbol)) {
      this._logger.debug(`DeadCodeManager: skipping whitelisted symbol "${sym.symbol}"`);
      return null;
    }

    // ── Activation entrypoint check ──
    const isActivationEntrypoint =
      sym.symbol === "activate" || sym.symbol === "deactivate";

    if (isActivationEntrypoint) {
      this._logger.debug(
        `DeadCodeManager: skipping activation entrypoint "${sym.symbol}"`
      );
      return null;
    }

    // ── VS Code command check ──
    const isVsCodeCommand = VSCODE_COMMAND_PATTERN.test(sym.symbol);

    if (isVsCodeCommand) {
      this._logger.debug(
        `DeadCodeManager: skipping VS Code command "${sym.symbol}"`
      );
      return null;
    }

    // ── Determine cross-file usage ──
    const crossFileUsageUnknown = sym.crossFileReferences === undefined;
    const crossFileRefs = sym.crossFileReferences ?? 0;

    // ── Classification decision (fail-closed) ──
    let classification: Classification;
    let reason: string;

    const qualifiesForStrong =
      sym.isPrivateHelper &&
      sym.isSingleFileScope &&
      !sym.isExported &&
      sym.localReferences === 0 &&
      !crossFileUsageUnknown &&
      crossFileRefs === 0;

    if (qualifiesForStrong) {
      classification = "strong";
      reason =
        "Private helper in single-file scope with zero local and zero cross-file references. " +
        "Definitively unused.";
    } else if (sym.isExported) {
      // Exported symbols may be consumed by external packages — always advisory.
      classification = "advisory";
      reason =
        "Symbol is exported and may be consumed by external packages or downstream " +
        "extensions. Cannot be definitively classified as dead.";
    } else if (crossFileUsageUnknown) {
      // Fail-closed: unknown cross-file usage → weak.
      classification = "weak";
      reason =
        "Cross-file usage could not be determined. Fail-closed: classified as weak. " +
        "Manual review recommended.";
    } else if (sym.localReferences === 0 && crossFileRefs === 0) {
      // Zero refs but not a private helper in single-file scope → weak.
      classification = "weak";
      reason =
        "Zero local and cross-file references detected, but symbol does not meet " +
        "all criteria for strong classification (not a private single-file helper). " +
        "May be referenced via dynamic patterns.";
    } else if (sym.localReferences === 0) {
      classification = "weak";
      reason =
        "Zero local references but cross-file references exist. " +
        "May be used externally. Manual review recommended.";
    } else {
      // Has some references — advisory at most.
      classification = "advisory";
      reason =
        "Symbol has some references. Flagged for review only. " +
        "Likely in active use.";
    }

    // ── Additional fail-closed guard: if we somehow ended up with `strong`
    //    but the symbol is exported, downgrade. ──
    if (classification === "strong" && sym.isExported) {
      this._logger.warn(
        `DeadCodeManager: downgrading "${sym.symbol}" from strong to weak (exported symbol)`
      );
      classification = "weak";
      reason =
        "Downgraded from strong: symbol is exported and may have external consumers.";
    }

    this._logger.debug(`DeadCodeManager: classified "${sym.symbol}" as ${classification}`, {
      reason,
    });

    return Object.freeze({
      symbol: sym.symbol,
      filePath: sym.filePath,
      line: sym.line,
      column: sym.column,
      classification,
      reason,
      isExported: sym.isExported,
      isVsCodeCommand,
      isActivationEntrypoint,
      localReferences: sym.localReferences,
      crossFileReferences: crossFileRefs,
      crossFileUsageUnknown,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: Git & Hashing
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the current git HEAD SHA. Returns `"unknown"` if git is unavailable
   * or the directory is not a git repository.
   */
  private _resolveGitHead(): string {
    try {
      const head = execSync("git rev-parse HEAD", {
        cwd: this._workspaceRoot,
        encoding: "utf-8",
        timeout: 5_000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (/^[0-9a-f]{40}$/.test(head)) {
        return head;
      }
      this._logger.warn("DeadCodeManager: git HEAD did not match expected format");
      return "unknown";
    } catch {
      this._logger.debug("DeadCodeManager: git HEAD unavailable, using 'unknown'");
      return "unknown";
    }
  }

  /**
   * Build a deterministic string payload for hashing.
   * The payload includes: plan ID, serialized candidates, timestamp, and git HEAD.
   */
  private _buildHashPayload(
    id: string,
    candidates: readonly DeadCodeCandidate[],
    timestamp: string,
    gitHead: string
  ): string {
    // Deterministic serialization: sort candidates by (filePath, line, column, symbol)
    const sorted = [...candidates].sort((a, b) => {
      const cmp =
        a.filePath.localeCompare(b.filePath) ||
        a.line - b.line ||
        a.column - b.column ||
        a.symbol.localeCompare(b.symbol);
      return cmp;
    });

    const serialized = JSON.stringify({
      id,
      candidates: sorted.map((c) => ({
        symbol: c.symbol,
        filePath: c.filePath,
        line: c.line,
        column: c.column,
        classification: c.classification,
        reason: c.reason,
        isExported: c.isExported,
        isVsCodeCommand: c.isVsCodeCommand,
        isActivationEntrypoint: c.isActivationEntrypoint,
        localReferences: c.localReferences,
        crossFileReferences: c.crossFileReferences,
        crossFileUsageUnknown: c.crossFileUsageUnknown,
      })),
      timestamp,
      gitHead,
    });

    return serialized;
  }

  /**
   * Compute SHA-256 hex digest of the given payload string.
   */
  private _computeSha256(payload: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(payload, "utf-8");
    return hash.digest("hex");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Convenience factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new DeadCodeManager instance with sensible defaults.
 */
export function createDeadCodeManager(
  options?: DeadCodeManagerOptions
): DeadCodeManager {
  return new DeadCodeManager(options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-test / smoke test (run via: npx ts-node DeadCodeManager.ts)
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const consoleLogger: DeadCodeLogger = {
    debug: (msg, ...m) => console.debug(`[DEBUG] ${msg}`, ...m),
    info: (msg, ...m) => console.info(`[INFO]  ${msg}`, ...m),
    warn: (msg, ...m) => console.warn(`[WARN]  ${msg}`, ...m),
    error: (msg, ...m) => console.error(`[ERROR] ${msg}`, ...m),
  };

  const manager = createDeadCodeManager({
    workspaceRoot: process.cwd(),
    extraWhitelist: ["myCustomEntryPoint"],
    logger: consoleLogger,
  });

  const testSymbols: SymbolInfo[] = [
    {
      symbol: "privateHelper",
      filePath: "/workspace/src/utils.ts",
      line: 42,
      column: 1,
      isExported: false,
      localReferences: 0,
      crossFileReferences: 0,
      isSingleFileScope: true,
      isPrivateHelper: true,
    },
    {
      symbol: "exportedApi",
      filePath: "/workspace/src/api.ts",
      line: 10,
      column: 1,
      isExported: true,
      localReferences: 0,
      crossFileReferences: 0,
      isSingleFileScope: false,
      isPrivateHelper: false,
    },
    {
      symbol: "activate",
      filePath: "/workspace/src/extension.ts",
      line: 1,
      column: 1,
      isExported: true,
      localReferences: 0,
      crossFileReferences: 0,
      isSingleFileScope: false,
      isPrivateHelper: false,
    },
    {
      symbol: "editor.action.myCommand",
      filePath: "/workspace/src/commands.ts",
      line: 5,
      column: 1,
      isExported: false,
      localReferences: 0,
      crossFileReferences: 0,
      isSingleFileScope: true,
      isPrivateHelper: true,
    },
    {
      symbol: "mysteryFunc",
      filePath: "/workspace/src/mystery.ts",
      line: 99,
      column: 1,
      isExported: false,
      localReferences: 0,
      crossFileReferences: undefined, // unknown → fail-closed
      isSingleFileScope: true,
      isPrivateHelper: true,
    },
  ];

  const plan = manager.analyze(testSymbols);

  console.log("\n═══ DEAD CODE PLAN (REPORT_ONLY) ═══");
  console.log(`  ID:          ${plan.id}`);
  console.log(`  Mode:        ${plan.mode}`);
  console.log(`  Timestamp:   ${plan.timestamp}`);
  console.log(`  Git HEAD:    ${plan.gitHead}`);
  console.log(`  SHA-256:     ${plan.hash}`);
  console.log(`  Candidates:  ${plan.candidates.length}`);
  console.log(`  Confirmed:   ${plan.requiresConfirmation}`);
  console.log(`  Actions:     [${plan.actions.length}] (intentionally empty)`);
  console.log("");

  for (const c of plan.candidates) {
    console.log(
      `  [${c.classification.toUpperCase().padEnd(8)}] ${c.symbol} ` +
        `(${path.basename(c.filePath)}:${c.line}) — ${c.reason}`
    );
  }

  console.log("");
  console.log(`  Plan verified: ${manager.verifyPlan(plan)}`);
  console.log("═══════════════════════════════════════════\n");
}