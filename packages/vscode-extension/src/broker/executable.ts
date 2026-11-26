import * as fs from "fs";
import * as path from "path";

/** Shared broker-side executable discovery. It is intentionally read-only and
 * does not scan arbitrary user directories. */
export function findExecutableOnPath(names: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  const entries = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const entry of entries) for (const name of names) {
    const candidate = path.join(entry, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}
