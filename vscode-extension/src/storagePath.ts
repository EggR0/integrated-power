import * as crypto from "crypto";
import * as path from "path";

export function normalizeWorkspacePathForStorage(folderPath: string): string {
  const resolved = path.resolve(folderPath);
  return /^[a-z]:/.test(resolved) ? resolved[0].toUpperCase() + resolved.slice(1) : resolved;
}

export function workspaceStoragePathForFolder(globalStorageFsPath: string, folderPath: string): string {
  const hash = crypto.createHash("md5").update(normalizeWorkspacePathForStorage(folderPath)).digest("hex");
  return path.join(globalStorageFsPath, "workspaces", hash);
}
