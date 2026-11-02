import * as fs from "fs";
import * as path from "path";
import { resolvePlatformConfigDir } from "../platformPaths";
import type { HubConfig } from "./index";

export const DEFAULT_HUB_CONFIG: HubConfig = {
  autoSyncMarkdown: true,
  disabledConnectors: [],
};

export class HubConfigStore {
  private readonly filePath: string;
  private cachedConfig?: HubConfig;

  public constructor(customPathOrDir?: string) {
    if (customPathOrDir) {
      if (customPathOrDir.endsWith(".json")) {
        this.filePath = path.resolve(customPathOrDir);
      } else {
        this.filePath = path.join(path.resolve(customPathOrDir), "hub-config.json");
      }
    } else {
      this.filePath = path.join(resolvePlatformConfigDir(), "hub-config.json");
    }
  }

  public getConfigPath(): string {
    return this.filePath;
  }

  public getConfig(): HubConfig {
    if (this.cachedConfig) {
      return { ...this.cachedConfig };
    }
    return this.loadConfig();
  }

  public loadConfig(): HubConfig {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw);
        this.cachedConfig = {
          customVaultPath: typeof parsed.customVaultPath === "string" ? parsed.customVaultPath : undefined,
          customTodoFilePath: typeof parsed.customTodoFilePath === "string" ? parsed.customTodoFilePath : undefined,
          disabledConnectors: Array.isArray(parsed.disabledConnectors)
            ? parsed.disabledConnectors
            : [...(DEFAULT_HUB_CONFIG.disabledConnectors || [])],
          autoSyncMarkdown: typeof parsed.autoSyncMarkdown === "boolean"
            ? parsed.autoSyncMarkdown
            : DEFAULT_HUB_CONFIG.autoSyncMarkdown,
        };
        return { ...this.cachedConfig };
      }
    } catch {
      // Fall back to defaults on read/parse error
    }

    this.cachedConfig = { ...DEFAULT_HUB_CONFIG };
    return { ...this.cachedConfig };
  }

  public updateConfig(partial: Partial<HubConfig>): HubConfig {
    const current = this.getConfig();
    const updated: HubConfig = {
      ...current,
      ...partial,
      disabledConnectors: partial.disabledConnectors !== undefined
        ? partial.disabledConnectors
        : current.disabledConnectors,
      autoSyncMarkdown: partial.autoSyncMarkdown !== undefined
        ? partial.autoSyncMarkdown
        : current.autoSyncMarkdown,
    };
    this.saveConfig(updated);
    return updated;
  }

  public saveConfig(config: HubConfig): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(config, null, 2), "utf8");
      this.cachedConfig = { ...config };
    } catch (err) {
      throw new Error(`Failed to save hub configuration to ${this.filePath}: ${err}`);
    }
  }
}
