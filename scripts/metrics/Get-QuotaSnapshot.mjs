import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";

// Paths
const CODEX_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

// Antigravity RPC configuration
const PROBE_PATH = "/exa.language_server_pb.LanguageServerService/GetUnleashData";
const STATUS_PATH = "/exa.language_server_pb.LanguageServerService/GetUserStatus";

/**
 * 1. Read Codex Quota from JSONL sessions
 */
async function getCodexQuota() {
  try {
    const files = await fs.readdir(CODEX_SESSIONS_DIR, { recursive: true });
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    if (jsonlFiles.length === 0) {
      return { error: "No Codex session files found" };
    }

    // Get full paths and stats to sort by modification time
    const fileStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const fullPath = path.join(CODEX_SESSIONS_DIR, file);
        const stats = await fs.stat(fullPath);
        return { fullPath, mtime: stats.mtimeMs };
      })
    );

    fileStats.sort((a, b) => b.mtime - a.mtime);

    // Look for the latest token_count event
    for (const { fullPath } of fileStats) {
      const content = await fs.readFile(fullPath, "utf-8");
      const lines = content.split("\n").reverse(); // Read from bottom up

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (
            event.type === "event_msg" &&
            event.payload?.type === "token_count" &&
            event.payload?.rate_limits
          ) {
            const primary = event.payload.rate_limits.primary;
            const secondary = event.payload.rate_limits.secondary;

            return {
              codexRemaining: primary?.used_percent != null ? 100 - primary.used_percent : null,
              codexWeeklyRemaining: secondary?.used_percent != null ? 100 - secondary.used_percent : null,
              resetTimes: {
                codexPrimary: primary?.resets_at ? new Date(primary.resets_at * 1000).toISOString() : null,
                codexWeekly: secondary?.resets_at ? new Date(secondary.resets_at * 1000).toISOString() : null,
              },
            };
          }
        } catch (e) {
          // Ignore parse errors for individual lines
        }
      }
    }

    return { error: "No token_count event found in recent sessions" };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * 2. Read Antigravity Quota via CLI
 */
async function getAntigravityQuota() {
  try {
    const { execSync } = await import("node:child_process");
    const result = execSync("npx -y antigravity-usage quota --method local --json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const status = JSON.parse(result);
    const models = status.models || [];
    
    // Find Gemini 3.1 Pro model specifically
    const g31pModel = models.find((m) => m.label && m.label.includes("3.1 Pro"));
    const targetModel = g31pModel || models[0];
    
    const fraction = targetModel?.remainingPercentage;

    const resetTimes = {};
    for (const m of models) {
      const name = m.label || "unknown";
      if (m.resetTime) {
        resetTimes[name] = m.resetTime;
      }
    }

    return {
      antigravityRemaining: typeof fraction === "number" ? Math.floor(fraction * 100) : null,
      resetTimes,
    };
  } catch (err) {
    return { error: `CLI error: ${err.message}` };
  }
}

/**
 * Main execution
 */
async function main() {
  const [codexResult, antigravityResult] = await Promise.all([
    getCodexQuota(),
    getAntigravityQuota(),
  ]);

  const output = {
    timestamp: new Date().toISOString(),
    codexRemaining: codexResult.codexRemaining ?? null,
    codexWeeklyRemaining: codexResult.codexWeeklyRemaining ?? null,
    antigravityRemaining: antigravityResult.antigravityRemaining ?? null,
    resetTimes: {
      ...(codexResult.resetTimes || {}),
      antigravity: antigravityResult.resetTimes || {},
    },
    sources: {
      codex: "session-jsonl",
      antigravity: "loopback",
    },
    errors: [],
  };

  if (codexResult.error) output.errors.push(`Codex: ${codexResult.error}`);
  if (antigravityResult.error) output.errors.push(`Antigravity: ${antigravityResult.error}`);

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
