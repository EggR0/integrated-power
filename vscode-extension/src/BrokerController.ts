import * as path from "path";
import * as vscode from "vscode";
import * as http from "http";
import { execFile } from "child_process";
import { promisify } from "util";
import { IntegratedPowerBroker, createPreferredEventLedger, createFirstWaveAdapters, startBrokerServer, BrokerServerHandle } from "./broker";

const execFileAsync = promisify(execFile);

export class BrokerController implements vscode.Disposable {
  private server: BrokerServerHandle | undefined;
  private broker: IntegratedPowerBroker | undefined;

  public async start(context: vscode.ExtensionContext): Promise<void> {
    if (this.server) return;
    const configuredPort = Number.parseInt(process.env.INTEGRATED_POWER_BROKER_PORT ?? "37241", 10);
    const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 37241;
    if (await probeBroker(port)) {
      this.server = { port, close: async () => undefined };
      await context.globalState.update("integratedPower.broker.v1", { port, startedAt: new Date().toISOString(), bind: "127.0.0.1", attached: true });
      return;
    }
    const root = path.join(context.globalStorageUri.fsPath, "broker");
    const ledger = createPreferredEventLedger(path.join(root, "events.enc.jsonl"));
    this.broker = new IntegratedPowerBroker(ledger, createFirstWaveAdapters());
    await this.broker.initialize();
    try {
      this.server = await startBrokerServer(this.broker, port);
    } catch (error) {
      if (!isAddressInUse(error) || !(await probeBroker(port))) throw error;
      this.broker = undefined;
      this.server = { port, close: async () => undefined };
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
    const result = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      { windowsHide: true, timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return String(result.stdout).trim();
  }

  public dispose(): void {
    if (this.server) void this.server.close();
    this.server = undefined;
    this.broker = undefined;
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
