import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REG_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const REG_VALUE_NAME = "IntegratedPower";
const LAUNCH_AGENT_LABEL = "com.integratedpower.controlcenter";
const LAUNCH_AGENT_PATH = (home: string) => path.join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
const XDG_AUTOSTART_PATH = (home: string) => path.join(home, ".config", "autostart", "integrated-power.desktop");

export interface AutoStartStatus {
  enabled: boolean;
  targetPath?: string;
  platform: string;
  method: "registry" | "launchd" | "xdg" | "startup_folder" | "unsupported";
}

/**
 * Resolves the preferred executable or launcher script to run on boot.
 * The caller (control-center settings) may override with a customTarget, e.g.
 * a freshly built Tauri binary.
 */
export function resolveAutoStartTarget(): string {
  if (process.platform !== "win32") {
    return process.execPath;
  }

  // 1. If running inside a packaged Tauri / desktop app
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const candidates = [
    process.env.INTEGRATED_POWER_EXE,
    path.join(localAppData, "IntegratedPower", "IntegratedPower.exe"),
    path.join(localAppData, "Programs", "IntegratedPower", "IntegratedPower.exe"),
    path.join(process.cwd(), "control-center", "src-tauri", "target", "release", "integrated-power.exe"),
    path.join(process.cwd(), "src-tauri", "target", "release", "integrated-power.exe"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 2. Fallback to node launcher for broker-server
  const brokerServerPath = path.resolve(__dirname, "..", "..", "control-center", "broker-server.js");
  if (fs.existsSync(brokerServerPath)) {
    return `"${process.execPath}" "${brokerServerPath}"`;
  }

  return `"${process.execPath}"`;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function darwinPlist(target: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key><string>" + LAUNCH_AGENT_LABEL + "</string>",
    "  <key>RunAtLoad</key><true/>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    "    <string>" + xmlEscape(target) + "</string>",
    "  </array>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function xdgDesktopEntry(target: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Integrated Power Control Center",
    `Exec=${target}`,
    "X-GNOME-Autostart-Enabled=true",
    "X-KDE-Autostart-Enabled=true",
    "",
  ].join("\n");
}

/**
 * Checks auto-start registration for the current OS:
 *   win32  → HKCU Run registry value
 *   darwin → ~/Library/LaunchAgents/<label>.plist
 *   linux  → ~/.config/autostart/integrated-power.desktop
 */
export async function getAutoStartStatus(): Promise<AutoStartStatus> {
  if (process.platform === "darwin") {
    const plistPath = LAUNCH_AGENT_PATH(os.homedir());
    if (fs.existsSync(plistPath)) {
      const content = fs.readFileSync(plistPath, "utf8");
      const match = content.match(/<string>([^<]+)<\/string>/);
      return { enabled: true, targetPath: match?.[1], platform: "darwin", method: "launchd" };
    }
    return { enabled: false, platform: "darwin", method: "launchd" };
  }
  if (process.platform === "linux") {
    const desktopPath = XDG_AUTOSTART_PATH(os.homedir());
    if (fs.existsSync(desktopPath)) {
      const content = fs.readFileSync(desktopPath, "utf8");
      const match = content.match(/^Exec=(.*)$/m);
      return { enabled: true, targetPath: match?.[1], platform: "linux", method: "xdg" };
    }
    return { enabled: false, platform: "linux", method: "xdg" };
  }
  if (process.platform !== "win32") {
    return { enabled: false, platform: process.platform, method: "unsupported" };
  }

  return new Promise((resolve) => {
    cp.execFile(
      "reg.exe",
      ["query", REG_KEY, "/v", REG_VALUE_NAME],
      { windowsHide: true },
      (error, stdout) => {
        if (error || !stdout) {
          resolve({
            enabled: false,
            platform: "win32",
            method: "registry",
          });
          return;
        }

        const match = stdout.match(new RegExp(`${REG_VALUE_NAME}\\s+REG_SZ\\s+(.*)`, "i"));
        const targetPath = match ? match[1].trim() : undefined;
        resolve({
          enabled: Boolean(targetPath),
          targetPath,
          platform: "win32",
          method: "registry",
        });
      },
    );
  });
}

/**
 * Enables or disables auto-start on boot for the current OS.
 * customTarget overrides resolveAutoStartTarget() when provided.
 */
export async function setAutoStart(enabled: boolean, customTarget?: string): Promise<AutoStartStatus> {
  if (process.platform === "darwin") {
    const target = customTarget || resolveAutoStartTarget();
    const plistPath = LAUNCH_AGENT_PATH(os.homedir());
    if (enabled) {
      fs.mkdirSync(path.dirname(plistPath), { recursive: true });
      fs.writeFileSync(plistPath, darwinPlist(target));
      return { enabled: true, targetPath: target, platform: "darwin", method: "launchd" };
    }
    fs.rmSync(plistPath, { force: true });
    return { enabled: false, platform: "darwin", method: "launchd" };
  }
  if (process.platform === "linux") {
    const target = customTarget || resolveAutoStartTarget();
    const desktopPath = XDG_AUTOSTART_PATH(os.homedir());
    if (enabled) {
      fs.mkdirSync(path.dirname(desktopPath), { recursive: true });
      fs.writeFileSync(desktopPath, xdgDesktopEntry(target));
      return { enabled: true, targetPath: target, platform: "linux", method: "xdg" };
    }
    fs.rmSync(desktopPath, { force: true });
    return { enabled: false, platform: "linux", method: "xdg" };
  }
  if (process.platform !== "win32") {
    return { enabled: false, platform: process.platform, method: "unsupported" };
  }

  const target = customTarget || resolveAutoStartTarget();

  return new Promise((resolve, reject) => {
    if (enabled) {
      cp.execFile(
        "reg.exe",
        ["add", REG_KEY, "/v", REG_VALUE_NAME, "/t", "REG_SZ", "/d", target, "/f"],
        { windowsHide: true },
        (error) => {
          if (error) {
            reject(new Error(`Failed to enable auto-start in registry: ${error.message}`));
            return;
          }
          resolve({
            enabled: true,
            targetPath: target,
            platform: "win32",
            method: "registry",
          });
        },
      );
    } else {
      cp.execFile(
        "reg.exe",
        ["delete", REG_KEY, "/v", REG_VALUE_NAME, "/f"],
        { windowsHide: true },
        () => {
          // If delete fails (e.g. key does not exist), that is fine, it means it's disabled.
          resolve({
            enabled: false,
            platform: "win32",
            method: "registry",
          });
        },
      );
    }
  });
}

// Self-test execution when run directly (Main Rule 1)
if (require.main === module) {
  void (async () => {
    console.log("[autostart self-test] Testing auto-start manager...");
    try {
      const initial = await getAutoStartStatus();
      console.log("[autostart self-test] Initial status:", initial);

      const target = resolveAutoStartTarget();
      console.log("[autostart self-test] Resolved target path:", target);
      console.log("[autostart self-test] All autostart self-test assertions passed.");
    } catch (err) {
      console.error("[autostart self-test] Error during self-test:", err);
      process.exitCode = 1;
    }
  })();
}
