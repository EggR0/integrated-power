import * as fs from "fs";

export function parseUtf8Json<T>(text: string): T {
  return JSON.parse(text.replace(/^\uFEFF/, "")) as T;
}

export function readUtf8JsonFile<T>(filePath: string): T {
  return parseUtf8Json<T>(fs.readFileSync(filePath, "utf8"));
}
