import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface QuotaSettings {
  pollIntervalMs: number;
  notifyOnFull: boolean;
  prewarmMode: "click" | "once" | "always";
  prewarmModes: { antigravity: "click" | "once" | "always"; opus: "click" | "once" | "always"; codex: "click" | "once" | "always" };
  notifications: Record<string, boolean>;
}

const sharedQuotaSettings = require(path.join(__dirname, "shared-quota.js")) as {
  mergeQuotaSettings(value: unknown): QuotaSettings;
};

export interface QuotaSettingsSnapshot {
  ok: boolean;
  revision: number;
  initialized: boolean;
  settings: QuotaSettings;
  source: string;
  errors: string[];
  conflict?: boolean;
  idempotencyKey?: string;
}

export interface QuotaSettingsWrite {
  expectedRevision: number;
  settings: Partial<QuotaSettings>;
  initializeFrom?: "ide" | "desktop";
  idempotencyKey?: string;
}

interface StoredSettings {
  schemaVersion: 1;
  revision: number;
  initialized: boolean;
  settings: QuotaSettings;
  source: string;
  idempotency: Record<string, { fingerprint: string; result: QuotaSettingsSnapshot }>;
}

export class QuotaSettingsStore {
  private readonly filePath: string;

  constructor(stateRoot: string) {
    this.filePath = path.join(path.resolve(stateRoot), "broker", "quota-settings.json");
  }

  public get(): QuotaSettingsSnapshot {
    const stored = this.read();
    return snapshot(stored);
  }

  public put(input: QuotaSettingsWrite): { status: number; result: QuotaSettingsSnapshot } {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      return { status: 400, result: { ...this.get(), ok: false, errors: ["expectedRevision must be a non-negative integer."] } };
    }
    if (!input.settings || typeof input.settings !== "object") {
      return { status: 400, result: { ...this.get(), ok: false, errors: ["settings must be an object."] } };
    }
    const stored = this.read();
    const incoming = input.settings;
    const legacyMode = incoming.prewarmModes ? undefined : incoming.prewarmMode;
    const normalized = sharedQuotaSettings.mergeQuotaSettings({
      ...stored.settings,
      ...incoming,
      prewarmModes: incoming.prewarmModes
        ? { ...stored.settings.prewarmModes, ...incoming.prewarmModes }
        : legacyMode
          ? { antigravity: legacyMode, opus: legacyMode, codex: legacyMode }
          : stored.settings.prewarmModes,
      notifications: { ...stored.settings.notifications, ...incoming.notifications },
    });
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ expectedRevision: input.expectedRevision, settings: normalized, initializeFrom: input.initializeFrom ?? null })).digest("hex");
    const id = normalizeIdempotencyKey(input.idempotencyKey);
    if (id) {
      const previous = stored.idempotency[id];
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          return { status: 409, result: { ...snapshot(stored), ok: false, conflict: true, idempotencyKey: id, errors: ["Idempotency key was already used for a different settings write."] } };
        }
        return { status: 200, result: { ...previous.result, idempotencyKey: id } };
      }
    }
    if (input.expectedRevision !== stored.revision) {
      return { status: 409, result: { ...snapshot(stored), ok: false, conflict: true, idempotencyKey: id, errors: ["Quota settings revision conflict; current settings are included."] } };
    }
    if (!stored.initialized && input.initializeFrom !== "ide" && input.initializeFrom !== "desktop") {
      return { status: 400, result: { ...snapshot(stored), ok: false, idempotencyKey: id, errors: ["First quota settings write must specify initializeFrom as ide or desktop."] } };
    }
    const next: StoredSettings = {
      schemaVersion: 1,
      revision: stored.revision + 1,
      initialized: true,
      settings: normalized,
      source: input.initializeFrom ?? "broker",
      idempotency: { ...stored.idempotency },
    };
    const result = snapshot(next);
    if (id) {
      next.idempotency[id] = { fingerprint, result: { ...result, idempotencyKey: id } };
      const ids = Object.keys(next.idempotency);
      for (const oldest of ids.slice(0, Math.max(0, ids.length - 128))) delete next.idempotency[oldest];
    }
    this.write(next);
    return { status: 200, result: { ...result, idempotencyKey: id } };
  }

  private read(): StoredSettings {
    let raw: string;
    try { raw = fs.readFileSync(this.filePath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { schemaVersion: 1, revision: 0, initialized: false, settings: sharedQuotaSettings.mergeQuotaSettings(null), source: "defaults", idempotency: {} };
    }
    try {
      const value = JSON.parse(raw) as Partial<StoredSettings>;
      if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || (value.revision ?? -1) < 0 || typeof value.initialized !== "boolean") {
        throw new Error("invalid schema or revision");
      }
      return {
        schemaVersion: 1,
        revision: value.revision!,
        initialized: value.initialized,
        settings: sharedQuotaSettings.mergeQuotaSettings(value.settings),
        source: typeof value.source === "string" ? value.source : "unknown",
        idempotency: value.idempotency && typeof value.idempotency === "object" ? value.idempotency : {},
      };
    } catch (error) {
      throw new Error(`Quota settings are corrupt at ${this.filePath}; preserved without overwrite: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private write(value: StoredSettings): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    try { fs.renameSync(temporary, this.filePath); }
    catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* preserve original rename error */ }
      throw error;
    }
  }
}

function snapshot(stored: StoredSettings): QuotaSettingsSnapshot {
  return { ok: true, revision: stored.revision, initialized: stored.initialized, settings: stored.settings, source: stored.source, errors: [] };
}

function normalizeIdempotencyKey(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const key = value.trim();
  if (key.length > 128) throw new Error("idempotencyKey must not exceed 128 characters.");
  return key;
}
