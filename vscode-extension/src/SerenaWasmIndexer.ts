/**
 * Integrated Power v0.9.0 – Serena AST & Visual Graph Engine
 * SerenaWasmIndexer.ts
 *
 * Implements incremental LOD (Level of Detail: L0~L3) symbol indexing,
 * reference graph querying, and bounded Mermaid subgraph generation.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export enum QueryLevel {
  /** L0: File metadata (path, loc, hash, language) */
  L0_FILES = 0,
  /** L1: Symbol table (functions, classes, interfaces, enums) */
  L1_SYMBOLS = 1,
  /** L2: Reference graph (calls, imports, exports, inheritance) */
  L2_REFERENCES = 2,
  /** L3: Semantics & DI bindings (VS Code commands, event emitters) */
  L3_SEMANTICS = 3,
}

export interface FileMetadata {
  relativePath: string;
  absolutePath: string;
  language: string;
  lineCount: number;
  sha256: string;
  mtimeMs: number;
}

export interface SymbolNode {
  id: string; // hash(file + name + line)
  name: string;
  kind: "function" | "class" | "interface" | "enum" | "type" | "variable";
  file: string;
  line: number;
  endLine: number;
  exported: boolean;
}

export interface ReferenceEdge {
  sourceId: string;
  targetName: string;
  kind: "call" | "import" | "implements" | "extends" | "event_emit";
  line: number;
  file: string;
}

export interface GraphResult {
  nodes: SymbolNode[];
  edges: ReferenceEdge[];
  mermaidDiagram: string;
  truncated: boolean;
}

export class SerenaWasmIndexer {
  private fileIndex = new Map<string, FileMetadata>();
  private symbolIndex = new Map<string, SymbolNode[]>();
  private edgeIndex = new Map<string, ReferenceEdge[]>();

  /**
   * Incrementally indexes TypeScript / JavaScript files in a workspace root.
   */
  public async indexWorkspace(
    workspaceRoot: string,
    options: { includePatterns?: string[]; excludePatterns?: string[] } = {},
  ): Promise<{ fileCount: number; symbolCount: number; edgeCount: number }> {
    const excludePatterns = options.excludePatterns ?? ["node_modules", ".git", "out", "dist", ".vscode-test"];
    const files = await this.scanFiles(workspaceRoot, excludePatterns);

    let symbolCount = 0;
    let edgeCount = 0;

    for (const filePath of files) {
      const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
      const stat = await fs.promises.stat(filePath);
      const prevMeta = this.fileIndex.get(relPath);

      // Skip if unchanged based on mtime
      if (prevMeta && prevMeta.mtimeMs === stat.mtimeMs) {
        continue;
      }

      const content = await fs.promises.readFile(filePath, "utf8");
      const sha256 = crypto.createHash("sha256").update(content).digest("hex");

      // Skip if content hash identical
      if (prevMeta && prevMeta.sha256 === sha256) {
        prevMeta.mtimeMs = stat.mtimeMs;
        continue;
      }

      const ext = path.extname(filePath).toLowerCase();
      const language = ext === ".ts" || ext === ".tsx" ? "typescript" : "javascript";
      const lines = content.split("\n");

      const fileMeta: FileMetadata = {
        relativePath: relPath,
        absolutePath: filePath,
        language,
        lineCount: lines.length,
        sha256,
        mtimeMs: stat.mtimeMs,
      };
      this.fileIndex.set(relPath, fileMeta);

      const { symbols, edges } = this.parseSymbolsAndEdges(relPath, content, lines);
      this.symbolIndex.set(relPath, symbols);
      this.edgeIndex.set(relPath, edges);

      symbolCount += symbols.length;
      edgeCount += edges.length;
    }

    return {
      fileCount: this.fileIndex.size,
      symbolCount: Array.from(this.symbolIndex.values()).reduce((sum, s) => sum + s.length, 0),
      edgeCount: Array.from(this.edgeIndex.values()).reduce((sum, e) => sum + e.length, 0),
    };
  }

  /**
   * Queries index at specified Level of Detail (L0~L3).
   */
  public query(level: QueryLevel, filter?: string): any {
    switch (level) {
      case QueryLevel.L0_FILES:
        return Array.from(this.fileIndex.values()).filter((f) => !filter || f.relativePath.includes(filter));

      case QueryLevel.L1_SYMBOLS: {
        const allSymbols: SymbolNode[] = [];
        for (const syms of this.symbolIndex.values()) {
          for (const s of syms) {
            if (!filter || s.name.toLowerCase().includes(filter.toLowerCase())) {
              allSymbols.push(s);
            }
          }
        }
        return allSymbols;
      }

      case QueryLevel.L2_REFERENCES: {
        const allEdges: ReferenceEdge[] = [];
        for (const edges of this.edgeIndex.values()) {
          for (const e of edges) {
            if (!filter || e.targetName.toLowerCase().includes(filter.toLowerCase()) || e.file.includes(filter)) {
              allEdges.push(e);
            }
          }
        }
        return allEdges;
      }

      default:
        return [];
    }
  }

  /**
   * Generates a bounded Mermaid diagram subgraph centered on a specific symbol or file.
   */
  public getMermaidSubgraph(centerName: string, maxRadius = 2, maxNodes = 30): GraphResult {
    const matchedNodes = new Map<string, SymbolNode>();
    const matchedEdges: ReferenceEdge[] = [];

    // Find center node
    let centerSymbol: SymbolNode | undefined;
    for (const syms of this.symbolIndex.values()) {
      centerSymbol = syms.find((s) => s.name === centerName || s.file.includes(centerName));
      if (centerSymbol) {
        break;
      }
    }

    if (!centerSymbol) {
      return {
        nodes: [],
        edges: [],
        mermaidDiagram: `graph TD\n    empty["No matching symbol found: ${centerName}"]`,
        truncated: false,
      };
    }

    matchedNodes.set(centerSymbol.id, centerSymbol);
    const visited = new Set<string>([centerSymbol.name]);
    let currentLevel = [centerSymbol.name];

    for (let r = 0; r < maxRadius; r++) {
      const nextLevel: string[] = [];

      for (const current of currentLevel) {
        for (const edges of this.edgeIndex.values()) {
          for (const edge of edges) {
            if (matchedNodes.size >= maxNodes) {
              break;
            }

            if (edge.sourceId === current || edge.targetName === current) {
              matchedEdges.push(edge);
              const neighborName = edge.sourceId === current ? edge.targetName : edge.sourceId;

              if (!visited.has(neighborName)) {
                visited.add(neighborName);
                nextLevel.push(neighborName);

                // Try to find symbol metadata for neighbor
                for (const syms of this.symbolIndex.values()) {
                  const n = syms.find((s) => s.name === neighborName);
                  if (n) {
                    matchedNodes.set(n.id, n);
                    break;
                  }
                }
              }
            }
          }
        }
      }

      currentLevel = nextLevel;
      if (matchedNodes.size >= maxNodes) {
        break;
      }
    }

    // Build Mermaid.js syntax
    const lines = ["graph TD"];
    lines.push(`    classDef center fill:#1e3a8a,stroke:#3b82f6,stroke-width:2px,color:#fff;`);
    lines.push(`    classDef regular fill:#1e293b,stroke:#475569,stroke-width:1px,color:#cbd5e1;`);

    const nodeIdMap = new Map<string, string>();
    let idCounter = 1;

    for (const node of matchedNodes.values()) {
      const safeId = `N${idCounter++}`;
      nodeIdMap.set(node.name, safeId);
      const isCenter = node.name === centerSymbol.name;
      const cssClass = isCenter ? "center" : "regular";
      lines.push(`    ${safeId}["${node.kind}: ${node.name} (${path.basename(node.file)})"]:::${cssClass}`);
    }

    for (const edge of matchedEdges) {
      const srcId = nodeIdMap.get(edge.sourceId);
      const tgtId = nodeIdMap.get(edge.targetName);

      if (srcId && tgtId) {
        lines.push(`    ${srcId} -->|${edge.kind}| ${tgtId}`);
      }
    }

    return {
      nodes: Array.from(matchedNodes.values()),
      edges: matchedEdges,
      mermaidDiagram: lines.join("\n"),
      truncated: matchedNodes.size >= maxNodes,
    };
  }

  private async scanFiles(dir: string, excludes: string[]): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (excludes.some((ex) => entry.name === ex || entry.name.startsWith("."))) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await this.scanFiles(fullPath, excludes);
          results.push(...subFiles);
        } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/i.test(entry.name) && !entry.name.endsWith(".d.ts")) {
          results.push(fullPath);
        }
      }
    } catch {
      // Ignore unreadable dirs
    }
    return results;
  }

  private parseSymbolsAndEdges(
    relPath: string,
    content: string,
    lines: string[],
  ): { symbols: SymbolNode[]; edges: ReferenceEdge[] } {
    const symbols: SymbolNode[] = [];
    const edges: ReferenceEdge[] = [];

    const fnRegex = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g;
    const classRegex = /(?:export\s+)?class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$]+))?(?:\s+implements\s+([A-Za-z0-9_$,\s]+))?/g;
    const ifaceRegex = /(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/g;
    const importRegex = /import\s+(?:\{([^}]+)\}|([A-Za-z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/g;
    const callRegex = /([A-Za-z0-9_$]+)\s*\(/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Function definitions
      let match: RegExpExecArray | null;
      while ((match = fnRegex.exec(line)) !== null) {
        symbols.push({
          id: `${relPath}#${match[1]}:${i + 1}`,
          name: match[1],
          kind: "function",
          file: relPath,
          line: i + 1,
          endLine: i + 1,
          exported: line.includes("export "),
        });
      }

      // Class definitions
      while ((match = classRegex.exec(line)) !== null) {
        const className = match[1];
        symbols.push({
          id: `${relPath}#${className}:${i + 1}`,
          name: className,
          kind: "class",
          file: relPath,
          line: i + 1,
          endLine: i + 1,
          exported: line.includes("export "),
        });

        if (match[2]) {
          edges.push({
            sourceId: className,
            targetName: match[2],
            kind: "extends",
            line: i + 1,
            file: relPath,
          });
        }
      }

      // Interface definitions
      while ((match = ifaceRegex.exec(line)) !== null) {
        symbols.push({
          id: `${relPath}#${match[1]}:${i + 1}`,
          name: match[1],
          kind: "interface",
          file: relPath,
          line: i + 1,
          endLine: i + 1,
          exported: line.includes("export "),
        });
      }

      // Imports
      while ((match = importRegex.exec(line)) !== null) {
        const importedSymbols = match[1]
          ? match[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0])
          : [match[2]];

        for (const sym of importedSymbols) {
          if (sym) {
            edges.push({
              sourceId: relPath,
              targetName: sym,
              kind: "import",
              line: i + 1,
              file: relPath,
            });
          }
        }
      }
    }

    return { symbols, edges };
  }
}
