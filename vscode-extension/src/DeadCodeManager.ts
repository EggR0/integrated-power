/**
 * Integrated Power v0.9.0 – Safe Dead Code Pruning Engine
 * DeadCodeManager.ts
 *
 * Implements 3-tier classification (strong / weak / external),
 * whitelist entrypoint preservation, and hash-bound plan execution.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { SerenaWasmIndexer, QueryLevel, SymbolNode } from "./SerenaWasmIndexer";
import { RefTransactionCoordinator } from "./RefTransactionCoordinator";

export interface DeadCodeCandidate {
  id: string;
  name: string;
  kind: "file" | "function" | "class" | "interface";
  file: string;
  line: number;
  confidence: "strong" | "weak" | "external";
  rationale: string;
}

export interface DeadCodePlan {
  planId: string;
  planHash: string;
  headOid: string;
  createdAt: string;
  whitelistRoots: string[];
  candidates: {
    strong: DeadCodeCandidate[]; // Eligible for automated pruning
    weak: DeadCodeCandidate[]; // Requires manual review (dynamic edges)
    external: DeadCodeCandidate[]; // Protected entrypoints
  };
}

export class DeadCodeManager {
  constructor(
    private readonly indexer: SerenaWasmIndexer,
    private readonly coordinator: RefTransactionCoordinator,
  ) {}

  /**
   * Generates a non-mutating dead-code analysis plan for a workspace.
   */
  public async generatePlan(workspaceRoot: string): Promise<DeadCodePlan> {
    await this.indexer.indexWorkspace(workspaceRoot);
    const headOid = await this.coordinator.getHeadOid(workspaceRoot);
    const whitelistRoots = await this.extractWhitelistRoots(workspaceRoot);

    const allSymbols: SymbolNode[] = this.indexer.query(QueryLevel.L1_SYMBOLS);
    const allEdges = this.indexer.query(QueryLevel.L2_REFERENCES);

    const referencedNames = new Set<string>();
    for (const edge of allEdges) {
      referencedNames.add(edge.targetName);
    }

    const strong: DeadCodeCandidate[] = [];
    const weak: DeadCodeCandidate[] = [];
    const external: DeadCodeCandidate[] = [];

    for (const sym of allSymbols) {
      const isExternalRoot = whitelistRoots.some(
        (root) => sym.name === root || sym.file.includes(root) || sym.name.startsWith("activate") || sym.name.startsWith("deactivate"),
      );

      if (isExternalRoot) {
        external.push({
          id: sym.id,
          name: sym.name,
          kind: sym.kind as any,
          file: sym.file,
          line: sym.line,
          confidence: "external",
          rationale: "Protected by package.json contribution or extension lifecycle entrypoint",
        });
        continue;
      }

      const isReferenced = referencedNames.has(sym.name);
      if (!isReferenced) {
        if (sym.exported) {
          // Exported symbols might be dynamically used
          weak.push({
            id: sym.id,
            name: sym.name,
            kind: sym.kind as any,
            file: sym.file,
            line: sym.line,
            confidence: "weak",
            rationale: "Exported symbol without static call references; may be used externally or dynamically",
          });
        } else {
          // Unexported, unreferenced symbol
          strong.push({
            id: sym.id,
            name: sym.name,
            kind: sym.kind as any,
            file: sym.file,
            line: sym.line,
            confidence: "strong",
            rationale: "Zero static call/import references across workspace",
          });
        }
      }
    }

    const planId = `plan-${Date.now()}`;
    const planPayload = JSON.stringify({ headOid, strong, weak, external, whitelistRoots });
    const planHash = crypto.createHash("sha256").update(planPayload).digest("hex");

    return {
      planId,
      planHash,
      headOid,
      createdAt: new Date().toISOString(),
      whitelistRoots,
      candidates: {
        strong,
        weak,
        external,
      },
    };
  }

  /**
   * Extracts entrypoint whitelist roots from package.json and configuration files.
   */
  private async extractWhitelistRoots(workspaceRoot: string): Promise<string[]> {
    const roots = new Set<string>(["extension.ts", "index.ts", "main.ts", "extension.js"]);
    const pkgPath = path.join(workspaceRoot, "package.json");

    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf8"));
        if (pkg.main) {
          roots.add(pkg.main);
        }
        if (pkg.contributes?.commands) {
          for (const cmd of pkg.contributes.commands) {
            if (cmd.command) {
              roots.add(cmd.command);
            }
          }
        }
        if (pkg.activationEvents) {
          for (const evt of pkg.activationEvents) {
            roots.add(evt);
          }
        }
      }
    } catch {
      // Ignore package parse failure
    }

    return Array.from(roots);
  }
}
