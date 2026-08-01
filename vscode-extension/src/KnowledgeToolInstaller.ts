import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { resolveIntegratedPowerToolsRoot } from "./storagePath";

const SCRIPT_NAMES = [
  "eggr-roots.ps1",
  "set-eggr-roots.ps1",
  "initialize-eggr-knowledge.ps1",
  "route-knowledge.ps1",
  "save-knowledge.ps1",
  "save-agent-worklog.ps1",
] as const;
const STATE_NAME = ".integrated-power-knowledge-tools.json";

export interface KnowledgeToolsStatus {
  installed: boolean;
  installRoot: string;
  wizardPath: string;
  routerPath: string;
  savePath: string;
  missing: string[];
}

export interface KnowledgeToolsInstallResult extends KnowledgeToolsStatus {
  changed: string[];
  backupRoot: string;
}

function productRoot(installRootOverride?: string): string {
  return installRootOverride
    ? path.resolve(installRootOverride)
    : resolveIntegratedPowerToolsRoot().path;
}

function sourceRoot(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "assets", "knowledge-tools");
}

function launcherFor(scriptName: string): string {
  return `@echo off\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0${scriptName}" %*\r\n`;
}

function powershell5Content(content: Buffer): Buffer {
  const hasUtf8Bom =
    content.length >= 3 &&
    content[0] === 0xef &&
    content[1] === 0xbb &&
    content[2] === 0xbf;
  return hasUtf8Bom
    ? content
    : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content]);
}

function sha256(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex").toUpperCase();
}

function sameFile(target: string, content: Buffer | string): boolean {
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
  return sha256(fs.readFileSync(target)) === sha256(content);
}

function writeAtomic(target: string, content: Buffer | string): void {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, content);
    fs.copyFileSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function inspectKnowledgeTools(
  context?: vscode.ExtensionContext,
  installRootOverride?: string,
): KnowledgeToolsStatus {
  const installRoot = productRoot(installRootOverride);
  const expected = [
    ...SCRIPT_NAMES,
    ...SCRIPT_NAMES.map((name) => `${path.parse(name).name}.cmd`),
  ];
  const missing = expected.filter(
    (name) => !fs.existsSync(path.join(installRoot, name)),
  );
  const preferredWizard = path.join(
    installRoot,
    "initialize-eggr-knowledge.ps1",
  );
  const wizardPath = fs.existsSync(preferredWizard) ? preferredWizard : "";
  let installed = missing.length === 0;
  if (context && installed) {
    const assets = sourceRoot(context);
    installed = SCRIPT_NAMES.every((name) => {
      const source = path.join(assets, name);
      return (
        fs.existsSync(source) &&
        sameFile(
          path.join(installRoot, name),
          powershell5Content(fs.readFileSync(source)),
        )
      );
    });
  }
  return {
    installed,
    installRoot,
    wizardPath,
    routerPath: path.join(installRoot, "route-knowledge.ps1"),
    savePath: path.join(installRoot, "save-knowledge.ps1"),
    missing,
  };
}

export function installKnowledgeTools(
  context: vscode.ExtensionContext,
  installRootOverride?: string,
): KnowledgeToolsInstallResult {
  const assets = sourceRoot(context);
  for (const name of SCRIPT_NAMES) {
    const source = path.join(assets, name);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`확장에 포함된 Knowledge 도구가 없습니다: ${name}`);
    }
  }

  const installRoot = productRoot(installRootOverride);
  fs.mkdirSync(installRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(
    installRoot,
    ".integrated-power-backups",
    timestamp,
  );
  const changed: string[] = [];
  const hashes: Record<string, string> = {};

  const installOne = (name: string, content: Buffer | string): void => {
    const target = path.join(installRoot, name);
    hashes[name] = sha256(content);
    if (sameFile(target, content)) return;
    if (fs.existsSync(target)) {
      fs.mkdirSync(backupRoot, { recursive: true });
      fs.copyFileSync(target, path.join(backupRoot, name));
    }
    writeAtomic(target, content);
    changed.push(name);
  };

  for (const scriptName of SCRIPT_NAMES) {
    installOne(
      scriptName,
      powershell5Content(
        fs.readFileSync(path.join(assets, scriptName)),
      ),
    );
    installOne(`${path.parse(scriptName).name}.cmd`, launcherFor(scriptName));
  }
  writeAtomic(
    path.join(installRoot, STATE_NAME),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        productId: "integrated-power",
        extensionVersion: String(context.extension.packageJSON.version),
        installedAt: new Date().toISOString(),
        hashes,
      },
      null,
      2,
    )}\n`,
  );

  return {
    ...inspectKnowledgeTools(context, installRoot),
    changed,
    backupRoot:
      fs.existsSync(backupRoot) && fs.readdirSync(backupRoot).length > 0
        ? backupRoot
        : "",
  };
}
