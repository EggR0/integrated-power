import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import * as http from "http";
import { execFile } from "child_process";
import { promisify } from "util";
import { IntegratedPowerBroker, createPreferredEventLedger, createFirstWaveAdapters, startBrokerServer, BrokerServerHandle } from "./broker";

const execFileAsync = promisify(execFile);

export class BrokerController implements vscode.Disposable {
  private server: BrokerServerHandle | undefined;
  private broker: IntegratedPowerBroker | undefined;
  private outputChannel: vscode.OutputChannel;
  private workerTerminal: vscode.Terminal | undefined;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Integrated Power Worker & Broker");
    this.log("Integrated Power Broker Controller initialized.");
  }

  public log(message: string): void {
    const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "");
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  public showLogs(preserveFocus = true): void {
    this.outputChannel.show(preserveFocus);
  }

  public async start(context: vscode.ExtensionContext): Promise<void> {
    if (this.server) return;
    this.log("Starting Integrated Power broker...");
    const configuredPort = Number.parseInt(process.env.INTEGRATED_POWER_BROKER_PORT ?? "37241", 10);
    const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 37241;
    if (await probeBroker(port)) {
      this.server = { port, close: async () => undefined };
      await context.globalState.update("integratedPower.broker.v1", { port, startedAt: new Date().toISOString(), bind: "127.0.0.1", attached: true });
      this.log(`Attached to existing broker running on 127.0.0.1:${port}`);
      return;
    }
    const root = path.join(context.globalStorageUri.fsPath, "broker");
    const ledger = createPreferredEventLedger(path.join(root, "events.enc.jsonl"));
    this.broker = new IntegratedPowerBroker(ledger, createFirstWaveAdapters());
    await this.broker.initialize();
    try {
      this.server = await startBrokerServer(this.broker, port);
      this.log(`Broker successfully listening on http://127.0.0.1:${port}`);
    } catch (error) {
      if (!isAddressInUse(error) || !(await probeBroker(port))) {
        this.log(`Broker start error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      this.broker = undefined;
      this.server = { port, close: async () => undefined };
      this.log(`Broker port ${port} in use, attached to existing process.`);
    }
    await context.globalState.update("integratedPower.broker.v1", {
      port: this.server.port,
      startedAt: new Date().toISOString(),
      bind: "127.0.0.1",
    });
  }

  public getPort(): number | undefined { return this.server?.port; }
  public getBroker(): IntegratedPowerBroker | undefined { return this.broker; }

  public async startDLocalModelServer(context: vscode.ExtensionContext): Promise<string> {
    const script = path.join(context.extensionPath, "assets", "start-d-local-llm.ps1");
    this.log(`Executing local model launcher script: ${script}`);
    const result = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      { windowsHide: true, timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const stdout = String(result.stdout).trim();
    if (stdout) this.log(`[Local LLM Launcher] ${stdout}`);
    return stdout;
  }

  public dispose(): void {
    if (this.server) void this.server.close();
    this.server = undefined;
    this.broker = undefined;
    this.outputChannel.dispose();
    if (this.workerTerminal) {
      this.workerTerminal.dispose();
      this.workerTerminal = undefined;
    }
  }
}

function probeBroker(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(response.statusCode === 200 && JSON.parse(body).service === "integrated-power-broker"); }
        catch { resolve(false); }
      });
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => { request.destroy(); resolve(false); });
  });
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EADDRINUSE");
}

function resolveControlCenterDir(context?: vscode.ExtensionContext): string {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const extPath = context?.extensionPath;
  const candidates = [
    wsFolder ? path.join(wsFolder, "control-center") : undefined,
    wsFolder ? path.join(wsFolder, "..", "integrated-power-control-center") : undefined,
    extPath ? path.join(extPath, "control-center") : undefined,
    process.platform === "win32" ? "d:\\Workspace\\integrated-power-control-center" : undefined,
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return wsFolder || (extPath ?? process.cwd());
}
