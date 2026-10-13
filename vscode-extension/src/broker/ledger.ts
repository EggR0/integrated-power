import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { TaskEvent } from "./protocol";
import { loadOrCreateLedgerKey } from "./keyStore";

export interface EventLedger {
  append(event: TaskEvent): Promise<void>;
  list(taskId?: string): Promise<TaskEvent[]>;
}

interface EncryptedRecord {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

type SqlCipherDatabase = {
  pragma(statement: string): unknown;
  key(key: Buffer): void;
  exec(statement: string): void;
  prepare(statement: string): { run(...params: unknown[]): unknown; all(...params: unknown[]): Array<{ event_json: string }> };
  close(): void;
};

/** SQLCipher-backed append-only ledger. The native dependency is optional so
 * the extension still starts on hosts where native modules are unavailable. */
export class SqlCipherEventLedger implements EventLedger {
  private readonly db: SqlCipherDatabase;
  private readonly key: Buffer;

  public constructor(private readonly filePath: string, key?: Buffer) {
    let Database: ((file: string) => SqlCipherDatabase) | undefined;
    try { Database = require("better-sqlite3-multiple-ciphers"); } catch (error) {
      throw new Error(`SQLCipher backend is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.key = key ?? loadOrCreateLedgerKey(`${filePath}.key`);
    if (this.key.length !== 32) throw new Error("SQLCipher ledger key must be 32 bytes.");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = Database!(filePath);
    this.db.pragma("cipher='sqlcipher'");
    this.db.key(this.key);
    const cipherVersion = this.db.pragma("cipher_version");
    if (!cipherVersion) throw new Error("SQLCipher is not active for the Integrated Power ledger.");
    this.db.exec("CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL, event_json TEXT NOT NULL, created_at TEXT NOT NULL)");
  }

  public async append(event: TaskEvent): Promise<void> {
    this.db.prepare("INSERT OR IGNORE INTO events (event_id, task_id, event_json, created_at) VALUES (?, ?, ?, ?)").run(event.id, event.taskId, JSON.stringify(event), event.createdAt);
  }

  public async list(taskId?: string): Promise<TaskEvent[]> {
    const rows = taskId
      ? this.db.prepare("SELECT event_json FROM events WHERE task_id = ? ORDER BY sequence").all(taskId)
      : this.db.prepare("SELECT event_json FROM events ORDER BY sequence").all();
    return rows.map((row) => JSON.parse(row.event_json) as TaskEvent);
  }

  public close(): void { this.db.close(); }
}

export function createPreferredEventLedger(filePath: string, key?: Buffer): EventLedger {
  const fallbackPath = filePath.endsWith(".enc.jsonl") ? `${filePath}.jsonl` : `${filePath}.jsonl`;
  if (fs.existsSync(filePath) && fs.existsSync(fallbackPath)) {
    throw new Error(`Multiple broker ledger formats exist beside ${filePath}. Preserve both files and resolve the conflict before startup.`);
  }
  if (fs.existsSync(filePath)) {
    const format = detectLedgerFormat(filePath);
    if (format === "jsonl") return new EncryptedEventLedger(filePath, key);
    return new SqlCipherEventLedger(filePath, key);
  }
  if (fs.existsSync(fallbackPath)) return new EncryptedEventLedger(fallbackPath, key);
  try { return new SqlCipherEventLedger(filePath, key); } catch (error) {
    return new EncryptedEventLedger(fallbackPath, key);
  }
}

/** Re-encrypt an existing encrypted JSONL ledger into a canonical location.
 * The source is never modified or deleted. Existing destination history must
 * be an exact prefix of the source (or contain the full source as a prefix). */
export async function migrateEncryptedLedger(
  sourcePath: string,
  destinationPath: string,
  sourceKey: Buffer,
  destinationKey: Buffer,
): Promise<"migrated" | "destination-current" | "unchanged"> {
  return migrateBrokerLedgers(
    [{ path: sourcePath, key: sourceKey }],
    destinationPath,
    () => destinationKey,
  );
}

export interface BrokerLedgerSource {
  path: string;
  key: Buffer;
}

/** Preflight every legacy/canonical history before writing; source files are never modified. */
export async function migrateBrokerLedgers(
  sources: BrokerLedgerSource[],
  destinationPath: string,
  destinationKeyProvider: (path: string, existing: boolean) => Buffer,
): Promise<"migrated" | "destination-current" | "unchanged"> {
  const existingSources = sources.filter((source) => fs.existsSync(source.path) && path.resolve(source.path) !== path.resolve(destinationPath));
  if (!existingSources.length) return "unchanged";
  const sourceHistories = await Promise.all(existingSources.map((source) => readLedgerEvents(source.path, source.key)));
  for (let left = 0; left < sourceHistories.length; left++) {
    for (let right = left + 1; right < sourceHistories.length; right++) {
      if (!historiesComparable(sourceHistories[left], sourceHistories[right])) {
        throw new Error("Broker ledger migration conflict: legacy histories diverge; neither ledger was changed.");
      }
    }
  }
  const latestSource = sourceHistories.reduce((latest, history) => history.length > latest.length ? history : latest, [] as TaskEvent[]);
  const destinationExists = fs.existsSync(destinationPath);
  const destinationKey = destinationKeyProvider(destinationPath, destinationExists);
  if (destinationKey.length !== 32) throw new Error("Broker ledger migration destination key must be 32 bytes.");
  const destination = destinationExists ? await readLedgerEvents(destinationPath, destinationKey) : [];
  if (!historiesComparable(destination, latestSource)) {
    throw new Error("Broker ledger migration conflict: source and canonical histories diverge; neither ledger was changed.");
  }
  const expected = destination.length > latestSource.length ? destination : latestSource;
  if (destination.length >= latestSource.length) return "destination-current";

  const target = destinationExists && detectLedgerFormat(destinationPath) === "sqlite"
    ? new SqlCipherEventLedger(destinationPath, destinationKey)
    : new EncryptedEventLedger(destinationPath, destinationKey);
  for (const event of latestSource.slice(destination.length)) await target.append(event);
  const readBack = await target.list();
  if (readBack.length !== expected.length || !isEventPrefix(expected, readBack)) {
    throw new Error(`Broker ledger migration verification failed: expected ${expected.length} events, read ${readBack.length}.`);
  }
  return "migrated";
}

async function readLedgerEvents(filePath: string, key: Buffer): Promise<TaskEvent[]> {
  const format = detectLedgerFormat(filePath);
  if (format === "jsonl") return new EncryptedEventLedger(filePath, key).list();
  let Database: ((file: string, options?: { readonly?: boolean; fileMustExist?: boolean }) => SqlCipherDatabase) | undefined;
  try { Database = require("better-sqlite3-multiple-ciphers"); }
  catch (error) { throw new Error(`Cannot inspect legacy SQLCipher ledger without its native backend: ${error instanceof Error ? error.message : String(error)}`); }
  let database: SqlCipherDatabase | undefined;
  try {
    database = Database!(filePath, { readonly: true, fileMustExist: true });
    database.pragma("cipher='sqlcipher'");
    database.key(key);
    if (!database.pragma("cipher_version")) throw new Error("SQLCipher is not active.");
    return database.prepare("SELECT event_json FROM events ORDER BY sequence").all().map((row) => JSON.parse(row.event_json) as TaskEvent);
  } catch (error) {
    throw new Error(`Unable to read legacy SQLCipher ledger at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    database?.close();
  }
}

function detectLedgerFormat(filePath: string): "jsonl" | "sqlite" {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const count = fs.readSync(descriptor, header, 0, header.length, 0);
    const prefix = header.subarray(0, count);
    if (prefix.toString("utf8").trimStart().startsWith("{")) return "jsonl";
    // SQLCipher encrypts the SQLite page header, so encrypted databases do not
    // carry the ordinary SQLite magic bytes. The caller opens this candidate
    // read-only and fails explicitly if it is not a valid SQLCipher ledger.
    return "sqlite";
  } finally {
    fs.closeSync(descriptor);
  }
}

function historiesComparable(left: TaskEvent[], right: TaskEvent[]): boolean {
  return isEventPrefix(left, right) || isEventPrefix(right, left);
}

function isEventPrefix(prefix: TaskEvent[], history: TaskEvent[]): boolean {
  return prefix.every((event, index) => JSON.stringify(event) === JSON.stringify(history[index]));
}

/**
 * Machine-local encrypted append-only event ledger. Keys are obtained from the
 * platform credential store (Windows Credential Manager, macOS Keychain, or
 * Linux Secret Service) with a Windows user-scoped DPAPI fallback.
 *
 * The broker talks to this interface rather than a file format, so a
 * SQLCipher backend can be supplied without changing protocol or broker code.
 */
export class EncryptedEventLedger implements EventLedger {
  private readonly key: Buffer;

  public constructor(
    private readonly filePath: string,
    key?: Buffer,
  ) {
    this.key = key ?? loadOrCreateLedgerKey(`${filePath}.key`);
    if (this.key.length !== 32) throw new Error("Event ledger key must be 32 bytes.");
  }

  public async append(event: TaskEvent): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(event), "utf8"),
      cipher.final(),
    ]);
    const record: EncryptedRecord = {
      version: 1,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
    await fs.promises.appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  public async list(taskId?: string): Promise<TaskEvent[]> {
    let text: string;
    try {
      text = await fs.promises.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const events: TaskEvent[] = [];
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as EncryptedRecord;
        if (record.version !== 1 || !record.iv || !record.tag || !record.ciphertext) {
          throw new Error("unsupported or incomplete encrypted record");
        }
        const decipher = crypto.createDecipheriv(
          "aes-256-gcm",
          this.key,
          Buffer.from(record.iv, "base64url"),
        );
        decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(record.ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
        const event = JSON.parse(plaintext) as TaskEvent;
        if (!taskId || event.taskId === taskId) events.push(event);
      } catch (error) {
        throw new Error(`Unable to read encrypted ledger record at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return events;
  }
}
