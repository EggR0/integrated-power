/**
 * SerenaWasmIndexer.ts
 *
 * Production-ready WASM-based code indexer for the Serena VS Code extension.
 * Implements incremental indexing, deleted-file pruning, canonical node identity,
 * LOD (Level-of-Detail) Mermaid rendering, and performance safeguards.
 *
 * @module SerenaWasmIndexer
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import type { Dirent } from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/** LOD levels for Mermaid rendering. */
export type LodLevel = 0 | 1 | 2 | 3;

/** A single indexed symbol (function, class, variable, etc.). */
export interface SymbolInfo {
  /** Canonical ID: `filePath#symbolName:line:col` */
  id: string;
  filePath: string;
  name: string;
  kind: SymbolKind;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  isExported: boolean;
  /** Optional type signature (for L1+ rendering). */
  signature?: string;
  /** Optional doc comment (for L3 rendering). */
  docComment?: string;
  /** Optional generic parameters (for L3 rendering). */
  generics?: string[];
}

export enum SymbolKind {
  Function = 'function',
  Class = 'class',
  Interface = 'interface',
  TypeAlias = 'type',
  Enum = 'enum',
  Variable = 'variable',
  Method = 'method',
  Property = 'property',
  Module = 'module',
  Unknown = 'unknown',
}

/** A directed edge representing a dependency/reference between symbols. */
export interface EdgeInfo {
  /** Source canonical ID. */
  from: string;
  /** Target canonical ID. */
  to: string;
  /** Relationship type. */
  relation: EdgeRelation;
  /** Line in source file where the reference occurs. */
  line: number;
}

export enum EdgeRelation {
  Calls = 'calls',
  Extends = 'extends',
  Implements = 'implements',
  Imports = 'imports',
  References = 'references',
  Instantiates = 'instantiates',
  TypeOf = 'type_of',
}

/** Per-file metadata cached for incremental indexing. */
export interface FileMetadata {
  filePath: string;
  /** SHA-256 hex digest of file content at last index time. */
  contentHash: string;
  /** Timestamp of last successful index. */
  indexedAt: number;
  /** Number of symbols extracted. */
  symbolCount: number;
  /** Number of edges originating from this file. */
  edgeCount: number;
  /** Whether the file was successfully parsed. */
  parseSuccess: boolean;
  /** Parse error message if any. */
  parseError?: string;
}

/** The complete index state (serializable for persistence). */
export interface IndexState {
  version: number;
  rootPath: string;
  lastIndexedAt: number;
  files: Map<string, FileMetadata>;
  symbols: Map<string, SymbolInfo>;
  edges: Map<string, EdgeInfo>;
  /** Reverse index: filePath → symbol IDs. */
  fileToSymbols: Map<string, string[]>;
  /** Reverse index: symbolId → edge IDs. */
  symbolToEdges: Map<string, string[]>;
}

/** Result returned after a full or incremental index pass. */
export interface IndexResult {
  success: boolean;
  filesIndexed: number;
  filesSkipped: number;
  filesDeleted: number;
  totalSymbols: number;
  totalEdges: number;
  totalExported: number;
  durationMs: number;
  errors: string[];
  state: IndexState;
}

/** Configuration options for the indexer. */
export interface IndexerOptions {
  /** Maximum number of nodes in a single Mermaid diagram. Default: 500. */
  maxMermaidNodes: number;
  /** File extensions to index. Default: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']. */
  extensions: string[];
  /** Glob patterns to exclude (relative to root). Default: ['node_modules/**', 'dist/**', 'build/**', '.git/**']. */
  excludePatterns: string[];
  /** Maximum file size in bytes to index. Default: 1 MB. */
  maxFileSizeBytes: number;
  /** Whether to include doc comments in L3. Default: true. */
  includeDocComments: boolean;
  /** Concurrency limit for file reads. Default: 8. */
  concurrency: number;
  /** Whether to persist state to disk. Default: true. */
  persistState: boolean;
  /** Path to the WASM parser binary. */
  wasmParserPath: string;
}

/** Interface for the WASM-based parser (e.g., tree-sitter WASM). */
export interface IWasmParser {
  /** Initialize the WASM module. */
  init(wasmPath: string): Promise<void>;
  /** Parse a source file and return raw symbol/edge data. */
  parse(source: string, filePath: string): Promise<ParseResult>;
  /** Dispose of WASM resources. */
  dispose(): void;
}

/** Raw parse output from the WASM module. */
export interface ParseResult {
  symbols: Array<{
    name: string;
    kind: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    isExported: boolean;
    signature?: string;
    docComment?: string;
    generics?: string[];
  }>;
  edges: Array<{
    fromName: string;
    fromLine: number;
    fromCol: number;
    toName: string;
    toLine: number;
    toCol: number;
    relation: string;
    line: number;
  }>;
}

export class DefaultSourceParser implements IWasmParser {
  async init(_wasmPath: string): Promise<void> {}
  async parse(source: string, _filePath: string): Promise<ParseResult> {
    const symbols: ParseResult['symbols'] = [];
    const edges: ParseResult['edges'] = [];

    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const lineNum = i + 1;

      // Function / async function
      const fnMatch = lineText.match(/(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/);
      if (fnMatch) {
        symbols.push({
          name: fnMatch[1],
          kind: 'function',
          line: lineNum,
          column: lineText.indexOf(fnMatch[1]) + 1,
          endLine: lineNum,
          endColumn: lineText.length,
          isExported: lineText.includes('export '),
          signature: lineText.trim(),
        });
      }

      // Class / Interface / Type / Enum
      const typeMatch = lineText.match(/(?:export\s+)?(class|interface|type|enum)\s+([a-zA-Z0-9_$]+)/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[2],
          kind: typeMatch[1],
          line: lineNum,
          column: lineText.indexOf(typeMatch[2]) + 1,
          endLine: lineNum,
          endColumn: lineText.length,
          isExported: lineText.includes('export '),
          signature: lineText.trim(),
        });
      }

      // Variable / const
      const varMatch = lineText.match(/(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*[:=]/);
      if (varMatch && !fnMatch && !typeMatch) {
        symbols.push({
          name: varMatch[1],
          kind: 'variable',
          line: lineNum,
          column: lineText.indexOf(varMatch[1]) + 1,
          endLine: lineNum,
          endColumn: lineText.length,
          isExported: lineText.includes('export '),
          signature: lineText.trim(),
        });
      }
    }

    return { symbols, edges };
  }
  dispose(): void {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const INDEX_STATE_VERSION = 3;
const DEFAULT_OPTIONS: IndexerOptions = {
  maxMermaidNodes: 500,
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  excludePatterns: ['node_modules/**', 'dist/**', 'build/**', '.git/**', 'coverage/**'],
  maxFileSizeBytes: 1024 * 1024, // 1 MB
  includeDocComments: true,
  concurrency: 8,
  persistState: true,
  wasmParserPath: '',
};

const STATE_FILE_NAME = '.serena-index-state.json';

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Fast content hashing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a SHA-256 hex digest of a file's contents.
 * Uses streaming to avoid loading entire large files into memory.
 */
async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fsSync.createReadStream(filePath);
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('end', () => resolve());
    stream.on('error', (err: Error) => reject(err));
  });
  return hash.digest('hex');
}

/**
 * Generates a canonical, collision-resistant node ID.
 * Format: `filePath#symbolName:line:col`
 *
 * The filePath is normalized to use forward slashes and is relative to the
 * workspace root to ensure stability across platforms.
 */
function canonicalId(
  filePath: string,
  symbolName: string,
  line: number,
  col: number,
): string {
  const normalized = filePath.replace(/\\/g, '/');
  return `${normalized}#${symbolName}:${line}:${col}`;
}

/**
 * Sanitizes a string for safe use as a Mermaid node ID.
 * Replaces characters that are invalid in Mermaid identifiers.
 */
function sanitizeMermaidId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9_#.:]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 128);
}

/**
 * Creates a simple glob matcher for exclude patterns.
 * Supports `**` and `*` wildcards.
 */
function createExcludeMatcher(patterns: string[]): (filePath: string) => boolean {
  const regexes = patterns.map((p) => {
    // Convert glob to regex
    let regex = p
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '(?:.*/)?')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${regex}$`);
  });

  return (filePath: string): boolean => {
    const normalized = filePath.replace(/\\/g, '/');
    return regexes.some((re) => re.test(normalized));
  };
}

/**
 * Simple concurrency limiter (no external deps).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Indexer Class
// ─────────────────────────────────────────────────────────────────────────────

export class SerenaWasmIndexer {
  private options: IndexerOptions;
  private parser: IWasmParser | null = null;
  private state: IndexState;
  private excludeMatcher: (filePath: string) => boolean;
  private disposed = false;

  constructor(options?: Partial<IndexerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.excludeMatcher = createExcludeMatcher(this.options.excludePatterns);
    this.state = this.createEmptyState('');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Indexes the workspace at `rootPath`.
   *
   * - Tracks seen files and prunes stale symbols/edges/metadata for deleted files.
   * - Skips files whose SHA-256 hash matches the cached value.
   * - Re-parses only changed/new files via the WASM parser.
   *
   * @param rootPath - Absolute path to the workspace root.
   * @returns A detailed IndexResult.
   */
  async indexWorkspace(targetRootPath?: string): Promise<IndexResult> {
    const startTime = performance.now();
    const errors: string[] = [];

    if (this.disposed) {
      throw new Error('SerenaWasmIndexer has been disposed.');
    }

    // Ensure parser is initialized
    await this.ensureParser();

    // Resolve absolute root
    const root = targetRootPath || (this.options as any).rootPath || process.cwd();
    const resolvedRoot = path.resolve(root);

    // 1. Walk the filesystem to collect current files
    const currentFiles = await this.collectFiles(resolvedRoot, errors);

    // 2. Prune deleted files (files in state but NOT in currentFiles)
    const deletedCount = this.pruneDeletedFiles(currentFiles);

    // 3. Determine which files need re-indexing (new or changed)
    const filesToIndex: string[] = [];
    let filesSkipped = 0;

    for (const filePath of currentFiles) {
      const relPath = this.toRelativePath(filePath, resolvedRoot);
      const cached = this.state.files.get(relPath);

      if (cached) {
        // Check if content changed
        try {
          const currentHash = await hashFile(filePath);
          if (currentHash === cached.contentHash) {
            filesSkipped++;
            continue;
          }
        } catch {
          // If we can't hash, re-index to be safe
        }
      }
      filesToIndex.push(filePath);
    }

    // 4. Index changed/new files (with concurrency limit)
    let filesIndexed = 0;
    const indexResults = await mapWithConcurrency(
      filesToIndex,
      this.options.concurrency,
      async (filePath) => {
        try {
          await this.indexSingleFile(filePath, resolvedRoot);
          filesIndexed++;
          return true;
        } catch (err) {
          const msg = `Failed to index ${filePath}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          return false;
        }
      },
    );

    // 5. Rebuild reverse indices
    this.rebuildReverseIndices();

    // 6. Update state metadata
    this.state.rootPath = resolvedRoot;
    this.state.lastIndexedAt = Date.now();

    // 7. Persist if configured
    if (this.options.persistState) {
      await this.persistState(resolvedRoot);
    }

    const durationMs = performance.now() - startTime;

    return {
      success: errors.length === 0,
      filesIndexed,
      filesSkipped,
      filesDeleted: deletedCount,
      totalSymbols: this.state.symbols.size,
      totalEdges: this.state.edges.size,
      totalExported: [...this.state.symbols.values()].filter((s) => s.isExported).length,
      durationMs,
      errors,
      state: this.state,
    };
  }

  /**
   * Generates a Mermaid diagram at the specified LOD level.
   *
   * - L0: Summary counts only (no diagram, just text).
   * - L1: Module/file boundaries + exported signatures.
   * - L2: Full internal symbol topology + dependencies.
   * - L3: Full AST detail with all edge relationships.
   *
   * @param lod - Level of detail (0–3).
   * @param maxNodes - Override max node count (defaults to options.maxMermaidNodes).
   * @returns Mermaid diagram source string.
   */
  generateMermaid(lod: LodLevel, maxNodes?: number): string {
    const nodeLimit = maxNodes ?? this.options.maxMermaidNodes;

    switch (lod) {
      case 0:
        return this.renderL0();
      case 1:
        return this.renderL1(nodeLimit);
      case 2:
        return this.renderL2(nodeLimit);
      case 3:
        return this.renderL3(nodeLimit);
      default:
        throw new Error(`Invalid LOD level: ${lod}`);
    }
  }

  /**
   * Loads a previously persisted index state.
   */
  async loadState(rootPath: string): Promise<boolean> {
    const stateFile = path.join(path.resolve(rootPath), STATE_FILE_NAME);
    try {
      const raw = await fs.readFile(stateFile, 'utf-8');
      const parsed = JSON.parse(raw) as SerializedState;

      if (parsed.version !== INDEX_STATE_VERSION) {
        // Version mismatch – discard
        return false;
      }

      this.state = {
        version: parsed.version,
        rootPath: parsed.rootPath,
        lastIndexedAt: parsed.lastIndexedAt,
        files: new Map(parsed.files),
        symbols: new Map(parsed.symbols),
        edges: new Map(parsed.edges),
        fileToSymbols: new Map(parsed.fileToSymbols),
        symbolToEdges: new Map(parsed.symbolToEdges),
      };

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Disposes WASM resources and cleans up.
   */
  dispose(): void {
    if (this.parser) {
      this.parser.dispose();
      this.parser = null;
    }
    this.disposed = true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // LOD Renderers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * L0: Summary counts.
   */
  private renderL0(): string {
    const totalFiles = this.state.files.size;
    const totalSymbols = this.state.symbols.size;
    const totalExported = [...this.state.symbols.values()].filter((s) => s.isExported).length;
    const totalEdges = this.state.edges.size;

    return [
      '%% Serena Index – L0 Summary',
      `%% Files: ${totalFiles}`,
      `%% Total Symbols: ${totalSymbols}`,
      `%% Exported Symbols: ${totalExported}`,
      `%% Edges: ${totalEdges}`,
      `%% Last Indexed: ${new Date(this.state.lastIndexedAt).toISOString()}`,
      '',
      'graph TD',
      '    summary["📊 Serena Index Summary"]',
      `    files["Files: ${totalFiles}"]`,
      `    symbols["Symbols: ${totalSymbols}"]`,
      `    exported["Exported: ${totalExported}"]`,
      `    edges["Edges: ${totalEdges}"]`,
      '    summary --> files',
      '    summary --> symbols',
      '    summary --> exported',
      '    summary --> edges',
    ].join('\n');
  }

  /**
   * L1: Module/File boundaries and exported signatures.
   */
  private renderL1(nodeLimit: number): string {
    const lines: string[] = ['graph TD'];
    let nodeCount = 0;

    // Group symbols by file
    const filesWithExports = new Map<string, SymbolInfo[]>();
    for (const sym of this.state.symbols.values()) {
      if (sym.isExported) {
        const arr = filesWithExports.get(sym.filePath) ?? [];
        arr.push(sym);
        filesWithExports.set(sym.filePath, arr);
      }
    }

    // Also include files with no exports (as module boundaries)
    const allFiles = new Set<string>([
      ...filesWithExports.keys(),
      ...this.state.files.keys(),
    ]);

    for (const filePath of allFiles) {
      if (nodeCount >= nodeLimit) {
        lines.push(`    %% ... truncated at ${nodeLimit} nodes`);
        break;
      }

      const fileNodeId = sanitizeMermaidId(`file_${filePath}`);
      const fileLabel = path.basename(filePath);
      lines.push(`    ${fileNodeId}["📁 ${fileLabel}"]`);
      nodeCount++;

      const exports = filesWithExports.get(filePath) ?? [];
      for (const sym of exports) {
        if (nodeCount >= nodeLimit) {
          lines.push(`    %% ... truncated at ${nodeLimit} nodes`);
          break;
        }

        const symNodeId = sanitizeMermaidId(sym.id);
        const sig = sym.signature ? `\\n${this.escapeMermaidText(sym.signature)}` : '';
        lines.push(`    ${symNodeId}["${this.escapeMermaidText(sym.name)}${sig}"]`);
        lines.push(`    ${fileNodeId} --> ${symNodeId}`);
        nodeCount++;
      }
    }

    return lines.join('\n');
  }

  /**
   * L2: Full internal symbol topology and dependencies.
   */
  private renderL2(nodeLimit: number): string {
    const lines: string[] = ['graph TD'];
    let nodeCount = 0;

    // Render all symbols
    for (const sym of this.state.symbols.values()) {
      if (nodeCount >= nodeLimit) {
        lines.push(`    %% ... truncated at ${nodeLimit} nodes`);
        break;
      }

      const nodeId = sanitizeMermaidId(sym.id);
      const shape = this.symbolShape(sym.kind);
      const label = this.escapeMermaidText(sym.name);
      lines.push(`    ${nodeId}${shape}("${label}")`);
      nodeCount++;
    }

    // Render edges (calls, extends, implements, imports)
    const l2Relations = new Set([
      EdgeRelation.Calls,
      EdgeRelation.Extends,
      EdgeRelation.Implements,
      EdgeRelation.Imports,
      EdgeRelation.Instantiates,
    ]);

    for (const edge of this.state.edges.values()) {
      if (nodeCount >= nodeLimit * 2) {
        lines.push(`    %% ... edges truncated`);
        break;
      }
      if (!l2Relations.has(edge.relation)) continue;

      const fromId = sanitizeMermaidId(edge.from);
      const toId = sanitizeMermaidId(edge.to);
      const arrow = this.edgeArrow(edge.relation);
      lines.push(`    ${fromId} ${arrow} ${toId}`);
    }

    return lines.join('\n');
  }

  /**
   * L3: Full AST detail with all edge relationships.
   */
  private renderL3(nodeLimit: number): string {
    const lines: string[] = ['graph TD'];
    let nodeCount = 0;

    // Render all symbols with full detail
    for (const sym of this.state.symbols.values()) {
      if (nodeCount >= nodeLimit) {
        lines.push(`    %% ... truncated at ${nodeLimit} nodes`);
        break;
      }

      const nodeId = sanitizeMermaidId(sym.id);
      const shape = this.symbolShape(sym.kind);
      let label = this.escapeMermaidText(sym.name);

      if (sym.signature) {
        label += `\\n${this.escapeMermaidText(sym.signature)}`;
      }
      if (this.options.includeDocComments && sym.docComment) {
        const truncatedDoc = sym.docComment.length > 80
          ? sym.docComment.slice(0, 77) + '...'
          : sym.docComment;
        label += `\\n<i>${this.escapeMermaidText(truncatedDoc)}</i>`;
      }
      if (sym.generics && sym.generics.length > 0) {
        label += `\\n<${sym.generics.join(', ')}>`;
      }

      lines.push(`    ${nodeId}${shape}("${label}")`);
      nodeCount++;
    }

    // Render ALL edges
    for (const edge of this.state.edges.values()) {
      const fromId = sanitizeMermaidId(edge.from);
      const toId = sanitizeMermaidId(edge.to);
      const arrow = this.edgeArrow(edge.relation);
      const label = this.escapeMermaidText(edge.relation.replace(/_/g, ' '));
      lines.push(`    ${fromId} ${arrow}|"${label}"| ${toId}`);
    }

    return lines.join('\n');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal: File Collection
  // ───────────────────────────────────────────────────────────────────────────

  private async collectFiles(rootPath: string, errors: string[]): Promise<Set<string>> {
    const files = new Set<string>();
    const extSet = new Set(this.options.extensions);

    const walk = async (dir: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        errors.push(`Cannot read directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip excluded directories early
          const relDir = this.toRelativePath(fullPath, rootPath);
          if (this.excludeMatcher(relDir + '/')) continue;
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!extSet.has(ext)) continue;

          const relPath = this.toRelativePath(fullPath, rootPath);
          if (this.excludeMatcher(relPath)) continue;

          // Check file size
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > this.options.maxFileSizeBytes) continue;
          } catch {
            continue;
          }

          files.add(fullPath);
        }
      }
    };

    await walk(rootPath);
    return files;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal: Deleted File Pruning
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Prunes all state (symbols, edges, metadata) for files that are no longer
   * present in the workspace. Returns the number of deleted files pruned.
   */
  private pruneDeletedFiles(currentFiles: Set<string>): number {
    const resolvedRoot = this.state.rootPath || '';
    let deletedCount = 0;

    const staleFiles: string[] = [];
    for (const [relPath] of this.state.files) {
      const absPath = resolvedRoot ? path.join(resolvedRoot, relPath) : relPath;
      if (!currentFiles.has(absPath)) {
        staleFiles.push(relPath);
      }
    }

    for (const relPath of staleFiles) {
      // Remove file metadata
      this.state.files.delete(relPath);

      // Remove all symbols belonging to this file
      const symbolIds = this.state.fileToSymbols.get(relPath) ?? [];
      for (const symId of symbolIds) {
        this.state.symbols.delete(symId);
        // Remove edges involving this symbol
        const edgeIds = this.state.symbolToEdges.get(symId) ?? [];
        for (const edgeId of edgeIds) {
          this.state.edges.delete(edgeId);
        }
        this.state.symbolToEdges.delete(symId);
      }
      this.state.fileToSymbols.delete(relPath);

      // Remove any remaining edges that reference this file's symbols
      // (safety sweep – should be mostly covered above)
      for (const [edgeId, edge] of this.state.edges) {
        if (edge.from.startsWith(relPath + '#') || edge.to.startsWith(relPath + '#')) {
          this.state.edges.delete(edgeId);
        }
      }

      deletedCount++;
    }

    return deletedCount;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal: Single File Indexing
  // ───────────────────────────────────────────────────────────────────────────

  private async indexSingleFile(filePath: string, rootPath: string): Promise<void> {
    const relPath = this.toRelativePath(filePath, rootPath);

    // Read file content
    const source = await fs.readFile(filePath, 'utf-8');

    // Compute hash
    const contentHash = crypto.createHash('sha256').update(source, 'utf-8').digest('hex');

    // Parse via WASM
    if (!this.parser) {
      throw new Error('WASM parser not initialized.');
    }

    const parseResult = await this.parser.parse(source, relPath);

    // Remove old symbols for this file (in case file was modified)
    const oldSymbolIds = this.state.fileToSymbols.get(relPath) ?? [];
    for (const symId of oldSymbolIds) {
      this.state.symbols.delete(symId);
      const edgeIds = this.state.symbolToEdges.get(symId) ?? [];
      for (const edgeId of edgeIds) {
        this.state.edges.delete(edgeId);
      }
      this.state.symbolToEdges.delete(symId);
    }
    this.state.fileToSymbols.delete(relPath);

    // Also remove old edges that reference this file
    for (const [edgeId, edge] of this.state.edges) {
      if (edge.from.startsWith(relPath + '#') || edge.to.startsWith(relPath + '#')) {
        this.state.edges.delete(edgeId);
      }
    }

    // Insert new symbols
    const newSymbolIds: string[] = [];
    const nameToId = new Map<string, string>(); // for edge resolution

    for (const raw of parseResult.symbols) {
      const symId = canonicalId(relPath, raw.name, raw.line, raw.column);
      const sym: SymbolInfo = {
        id: symId,
        filePath: relPath,
        name: raw.name,
        kind: this.mapSymbolKind(raw.kind),
        line: raw.line,
        column: raw.column,
        endLine: raw.endLine,
        endColumn: raw.endColumn,
        isExported: raw.isExported,
        signature: raw.signature,
        docComment: this.options.includeDocComments ? raw.docComment : undefined,
        generics: raw.generics,
      };

      this.state.symbols.set(symId, sym);
      newSymbolIds.push(symId);
      nameToId.set(`${raw.name}:${raw.line}:${raw.column}`, symId);
    }

    this.state.fileToSymbols.set(relPath, newSymbolIds);

    // Insert edges (resolve names to canonical IDs)
    let edgeCount = 0;
    for (const rawEdge of parseResult.edges) {
      const fromKey = `${rawEdge.fromName}:${rawEdge.fromLine}:${rawEdge.fromCol}`;
      const toKey = `${rawEdge.toName}:${rawEdge.toLine}:${rawEdge.toCol}`;

      const fromId = nameToId.get(fromKey) ?? canonicalId(relPath, rawEdge.fromName, rawEdge.fromLine, rawEdge.fromCol);
      const toId = nameToId.get(toKey) ?? canonicalId(relPath, rawEdge.toName, rawEdge.toLine, rawEdge.toCol);

      const edgeId = `${fromId}→${toId}:${rawEdge.relation}:${rawEdge.line}`;
      const edge: EdgeInfo = {
        from: fromId,
        to: toId,
        relation: this.mapEdgeRelation(rawEdge.relation),
        line: rawEdge.line,
      };

      this.state.edges.set(edgeId, edge);
      edgeCount++;

      // Track reverse index
      const fromEdges = this.state.symbolToEdges.get(fromId) ?? [];
      fromEdges.push(edgeId);
      this.state.symbolToEdges.set(fromId, fromEdges);

      const toEdges = this.state.symbolToEdges.get(toId) ?? [];
      toEdges.push(edgeId);
      this.state.symbolToEdges.set(toId, toEdges);
    }

    // Update file metadata
    const metadata: FileMetadata = {
      filePath: relPath,
      contentHash,
      indexedAt: Date.now(),
      symbolCount: newSymbolIds.length,
      edgeCount,
      parseSuccess: true,
    };
    this.state.files.set(relPath, metadata);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal: Reverse Index Rebuild
  // ───────────────────────────────────────────────────────────────────────────

  private rebuildReverseIndices(): void {
    // Rebuild fileToSymbols
    const fileToSymbols = new Map<string, string[]>();
    for (const [symId, sym] of this.state.symbols) {
      const arr = fileToSymbols.get(sym.filePath) ?? [];
      arr.push(symId);
      fileToSymbols.set(sym.filePath, arr);
    }
    this.state.fileToSymbols = fileToSymbols;

    // Rebuild symbolToEdges
    const symbolToEdges = new Map<string, string[]>();
    for (const [edgeId, edge] of this.state.edges) {
      const fromArr = symbolToEdges.get(edge.from) ?? [];
      fromArr.push(edgeId);
      symbolToEdges.set(edge.from, fromArr);

      const toArr = symbolToEdges.get(edge.to) ?? [];
      toArr.push(edgeId);
      symbolToEdges.set(edge.to, toArr);
    }
    this.state.symbolToEdges = symbolToEdges;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal: Persistence
  // ───────────────────────────────────────────────────────────────────────────

  private async persistState(rootPath: string): Promise<void> {
    const stateFile = path.join(rootPath, STATE_FILE_NAME);
    const serialized: SerializedState = {
      version: this.state.version,
      rootPath: this.state.rootPath,
      lastIndexedAt: this.state.lastIndexedAt,
      files: Array.from(this.state.files.entries()),
      symbols: Array.from(this.state.symbols.entries()),
      edges: Array.from(this.state.edges.entries()),
      fileToSymbols: Array.from(this.state.fileToSymbols.entries()),
      symbolToEdges: Array.from(this.state.symbolToEdges.entries()),
    };

    const json = JSON.stringify(serialized);
    // Write atomically: write to temp file, then rename
    const tmpFile = stateFile + '.tmp';
    await fs.writeFile(tmpFile, json, 'utf-8');
    await fs.rename(tmpFile, stateFile);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal: Parser Management
  // ───────────────────────────────────────────────────────────────────────────

  private async ensureParser(): Promise<void> {
    if (this.parser) return;

    if (this.options.wasmParserPath && fsSync.existsSync(this.options.wasmParserPath)) {
      try {
        // Dynamic load when WASM binary exists
        const { TreeSitterWasmParser } = require('./TreeSitterWasmParser');
        const p = new TreeSitterWasmParser();
        await p.init(this.options.wasmParserPath);
        this.parser = p;
        return;
      } catch {
        // Fallback to default source parser
      }
    }

    // Default built-in source parser
    this.parser = new DefaultSourceParser();
  }

  /**
   * Allows external injection of a parser implementation (useful for testing
   * or for loading a specific WASM build).
   */
  setParser(parser: IWasmParser): void {
    this.parser = parser;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal: Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private createEmptyState(rootPath: string): IndexState {
    return {
      version: INDEX_STATE_VERSION,
      rootPath,
      lastIndexedAt: 0,
      files: new Map(),
      symbols: new Map(),
      edges: new Map(),
      fileToSymbols: new Map(),
      symbolToEdges: new Map(),
    };
  }

  private toRelativePath(filePath: string, rootPath: string): string {
    const rel = path.relative(rootPath, filePath);
    return rel.replace(/\\/g, '/');
  }

  private mapSymbolKind(raw: string): SymbolKind {
    const map: Record<string, SymbolKind> = {
      function: SymbolKind.Function,
      class: SymbolKind.Class,
      interface: SymbolKind.Interface,
      type: SymbolKind.TypeAlias,
      enum: SymbolKind.Enum,
      variable: SymbolKind.Variable,
      method: SymbolKind.Method,
      property: SymbolKind.Property,
      module: SymbolKind.Module,
    };
    return map[raw.toLowerCase()] ?? SymbolKind.Unknown;
  }

  private mapEdgeRelation(raw: string): EdgeRelation {
    const map: Record<string, EdgeRelation> = {
      calls: EdgeRelation.Calls,
      extends: EdgeRelation.Extends,
      implements: EdgeRelation.Implements,
      imports: EdgeRelation.Imports,
      references: EdgeRelation.References,
      instantiates: EdgeRelation.Instantiates,
      type_of: EdgeRelation.TypeOf,
    };
    return map[raw.toLowerCase()] ?? EdgeRelation.References;
  }

  private symbolShape(kind: SymbolKind): string {
    switch (kind) {
      case SymbolKind.Function:
      case SymbolKind.Method:
        return '(())'; // stadium shape
      case SymbolKind.Class:
        return '[['; // subroutine shape
      case SymbolKind.Interface:
      case SymbolKind.TypeAlias:
        return '>'; // flag shape
      case SymbolKind.Enum:
        return '[#'; // subroutine with #
      case SymbolKind.Variable:
        return '[]'; // rectangle
      case SymbolKind.Module:
        return '[['; // subroutine
      default:
        return '[]';
    }
  }

  private edgeArrow(relation: EdgeRelation): string {
    switch (relation) {
      case EdgeRelation.Calls:
        return '-->';
      case EdgeRelation.Extends:
        return '--|>';
      case EdgeRelation.Implements:
        return '-->>';
      case EdgeRelation.Imports:
        return '-.->';
      case EdgeRelation.Instantiates:
        return '--*>';
      case EdgeRelation.TypeOf:
        return '--o>';
      default:
        return '-->';
    }
  }

  private escapeMermaidText(text: string): string {
    return text
      .replace(/"/g, '#quot;')
      .replace(/</g, '#lt;')
      .replace(/>/g, '#gt;')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization helper types
// ─────────────────────────────────────────────────────────────────────────────

interface SerializedState {
  version: number;
  rootPath: string;
  lastIndexedAt: number;
  files: [string, FileMetadata][];
  symbols: [string, SymbolInfo][];
  edges: [string, EdgeInfo][];
  fileToSymbols: [string, string[]][];
  symbolToEdges: [string, string[]][];
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default SerenaWasmIndexer;