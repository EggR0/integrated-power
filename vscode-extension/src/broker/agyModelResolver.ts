import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface AgyModelResolution {
  model: string;
  effort: string;
  family: "gemini" | "claude";
  displayName: string;
  cliModel: string;
}

let cachedDiscoveredModels: Array<{ id: string; name: string }> | undefined;
let cacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function findAgyBinary(): string | undefined {
  if (process.env.AGY_PATH && fs.existsSync(process.env.AGY_PATH)) return process.env.AGY_PATH;
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe");
    if (local && fs.existsSync(local)) return local;
  }
  const envPath = process.env.PATH || "";
  const exes = process.platform === "win32" ? ["agy.exe", "agy.cmd", "agy.bat"] : ["agy"];
  for (const p of envPath.split(path.delimiter)) {
    for (const exe of exes) {
      const full = path.join(p, exe);
      if (fs.existsSync(full)) return full;
    }
  }
  return undefined;
}

function discoverAgyModels(): Array<{ id: string; name: string }> {
  if (cachedDiscoveredModels && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedDiscoveredModels;
  }
  const agyBin = findAgyBinary();
  if (!agyBin) return [];
  try {
    const res = cp.spawnSync(agyBin, ["models"], {
      timeout: 3000,
      encoding: "utf8",
      windowsHide: true,
    });
    if (res.status === 0 && res.stdout) {
      const list: Array<{ id: string; name: string }> = [];
      for (const line of res.stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("Fetching")) continue;
        const [id, ...rest] = trimmed.split("\t");
        if (id) {
          list.push({ id: id.trim(), name: (rest.join("\t") || id).trim() });
        }
      }
      if (list.length > 0) {
        cachedDiscoveredModels = list;
        cacheTime = Date.now();
        return list;
      }
    }
  } catch {
    // Graceful fallback
  }
  return cachedDiscoveredModels || [];
}

/**
 * Pure model resolver: given an arbitrary list of discovered models, resolves the lowest
 * resource/cost model matching the given family keyword ("gemini" or "claude").
 * Automatically adapts regardless of version numbers, prefixes, or naming convention changes.
 */
export function resolveLowestModelFromList(
  models: Array<{ id: string; name: string }>,
  family: "gemini" | "claude"
): AgyModelResolution | undefined {
  const keyword = family.toLowerCase();
  const matches = models.filter((m) =>
    m.id.toLowerCase().includes(keyword) || m.name.toLowerCase().includes(keyword)
  );

  if (matches.length === 0) return undefined;

  // 1. Prefer lowest effort with flash (gemini) or sonnet/haiku (claude)
  let picked = matches.find((m) => {
    const lower = `${m.id} ${m.name}`.toLowerCase();
    return lower.includes("low") && (family === "gemini" ? lower.includes("flash") : (lower.includes("sonnet") || lower.includes("haiku")));
  });
  // 2. Prefer low effort
  if (!picked) {
    picked = matches.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("low"));
  }
  // 3. Prefer flash (gemini) or sonnet/haiku (claude)
  if (!picked) {
    picked = matches.find((m) => {
      const lower = `${m.id} ${m.name}`.toLowerCase();
      return family === "gemini" ? lower.includes("flash") : (lower.includes("sonnet") || lower.includes("haiku"));
    });
  }
  // 4. Fallback to any model containing the family keyword
  if (!picked) {
    picked = matches[0];
  }
  return {
    model: picked.id,
    effort: "low",
    family,
    displayName: picked.name,
    cliModel: picked.id,
  };
}

/**
 * Resolves the lowest resource/cost model for Antigravity (AGY) 5-hour quota pre-warming.
 * Discovers live models from AGY CLI, matching by family keyword ("gemini" or "claude"),
 * selecting the lowest-tier / flash model, or falling back to any matching model in the family.
 */
export function getLowestAgyModel(
  family: "gemini" | "claude",
  modelsOverride?: Array<{ id: string; name: string }>
): AgyModelResolution {
  const models = modelsOverride || discoverAgyModels();
  const resolved = resolveLowestModelFromList(models, family);
  if (resolved) return resolved;

  // Static fallback if CLI models query is unavailable
  if (family === "gemini") {
    return {
      model: "gemini-3.8-flash-low",
      effort: "low",
      family: "gemini",
      displayName: "Gemini 3.8 Flash (Low)",
      cliModel: "gemini-3.8-flash-low",
    };
  }

  return {
    model: "claude-sonnet-5-5-low",
    effort: "low",
    family: "claude",
    displayName: "Claude Sonnet 5.5 (Low)",
    cliModel: "claude-sonnet-5-5-low",
  };
}
