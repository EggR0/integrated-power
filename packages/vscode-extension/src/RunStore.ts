import * as vscode from "vscode";
import { ArtifactRef, RunSummary } from "./types";

export interface RunStoreReadOptions {
  normalizeArtifactPath?: (value: string) => string | undefined;
}

export interface RunStoreData {
  runs: RunSummary[];
  activeRuns: RunSummary[];
  artifacts: ArtifactRef[];
  parseErrors: string[];
}

interface SharedRunStateParser {
  parseRunJsonl(text: string, options?: RunStoreReadOptions): RunStoreData;
}

// Both the IDE and Control Center use this parser. VS Code URI/file-system
// access stays here as an adapter; parsing and normalization have no host I/O.
const sharedRunState = require("../../shared/telemetry/runState") as SharedRunStateParser;

export class RunStore {
  public async readRuns(
    fileUri: vscode.Uri | undefined,
    options: RunStoreReadOptions = {},
  ): Promise<RunStoreData> {
    if (!fileUri) return emptyData();
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      return sharedRunState.parseRunJsonl(Buffer.from(bytes).toString("utf8"), options);
    } catch (error) {
      if (isFileNotFound(error)) return emptyData();
      throw error;
    }
  }
}

function isFileNotFound(error: unknown): boolean {
  return /file.*not.*found|enoent/i.test(error instanceof Error ? error.message : String(error));
}

function emptyData(): RunStoreData {
  return { runs: [], activeRuns: [], artifacts: [], parseErrors: [] };
}
