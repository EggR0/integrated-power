import * as crypto from "crypto";
import * as path from "path";

export function normalizeWorkspacePathForStorage(folderPath: string): string {
  const resolved = path.resolve(folderPath);
  return /^[A-Z]:/.test(resolved) ? resolved[0].toLowerCase() + resolved.slice(1) : resolved;
}

export function workspaceStoragePathForFolder(globalStorageFsPath: string, folderPath: string): string {
  const hash = crypto.createHash("md5").update(normalizeWorkspacePathForStorage(folderPath)).digest("hex");
  return path.join(globalStorageFsPath, "workspaces", hash);
}
