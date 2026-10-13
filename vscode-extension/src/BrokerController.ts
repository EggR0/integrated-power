import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import * as http from "http";
import { execFile } from "child_process";
import { promisify } from "util";
import { IntegratedPowerBroker, BrokerClient, BrokerHealth, createPreferredEventLedger, createFirstWaveAdapters, startBrokerServer, BrokerServerHandle, loadExistingLedgerKey, loadOrCreateLedgerKey, migrateBrokerLedgers, getCanonicalBrokerLedgerPath } from "./broker";
import { resolveIntegratedPowerStateRoot } from "./storagePath";

const execFileAsync = promisify(execFile);

export class BrokerController implements vscode.Disposable {
  private server: BrokerServerHandle | undefined;
  private broker: IntegratedPowerBroker | undefined;
  private outputChannel: vscode.OutputChannel;
  private workerTerminal: vscode.Terminal | undefined;
  private brokerClient: BrokerClient | undefined;
  private attachedHealth: BrokerHealth | undefined;

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
    const existingHealth = await probeBroker(port);
    if (existingHealth) {
      this.server = { port, close: async () => undefined };
      this.attachedHealth = existingHealth;
      await context.globalState.update("integratedPower.broker.v1", { port, startedAt: new Date().toISOString(), bind: "127.0.0.1", attached: true });
      if (!isCompatibleBroker(existingHealth)) {
        this.log(`Existing broker on 127.0.0.1:${port} is legacy or missing required capabilities. It remains running; Integrated Power will not replace or restart it. Health: ${JSON.stringify(existingHealth)}`);
      } else {
        this.log(`Attached to compatible broker running on 127.0.0.1:${port}`);
      }
      return;
    }
    const canonicalLedgerBase = getCanonicalBrokerLedgerPath();
    const canonicalLedgerPath = existingLedgerPath(canonicalLedgerBase);
    const canonicalExists = fs.existsSync(canonicalLedgerPath);
    const stateRoot = resolveIntegratedPowerStateRoot();
    const legacyBases = [
      path.join(stateRoot, "events.enc.jsonl"),
      path.join(context.globalStorageUri.fsPath, "broker", "events.enc.jsonl"),
    ];
    const candidateSet = new Set(legacyBases.flatMap(existingLedgerCandidates));
    candidateSet.delete(canonicalLedgerPath);
    const legacyLedgers = [...candidateSet].map((sourcePath) => {
      const key = loadExistingLedgerKey(`${sourcePath}.key`);
      if (!key) throw new Error(`Legacy broker ledger key was not found for ${sourcePath}. Both the ledger and existing state were preserved.`);
      return { path: sourcePath, key };
    });
    let canonicalLedgerKey: Buffer | undefined;
    await migrateBrokerLedgers(legacyLedgers, canonicalLedgerPath, (destinationPath, exists) => {
      const key = exists
        ? loadExistingLedgerKey(`${destinationPath}.key`)
        : loadOrCreateLedgerKey(`${canonicalLedgerBase}.key`);
      if (!key) throw new Error(`Canonical broker ledger key was not found for ${destinationPath}. Existing state was preserved.`);
      canonicalLedgerKey = key;
      return key;
    });
    if (!canonicalLedgerKey) {
      canonicalLedgerKey = canonicalExists
        ? loadExistingLedgerKey(`${canonicalLedgerPath}.key`)
        : loadOrCreateLedgerKey(`${canonicalLedgerBase}.key`);
    }
    if (!canonicalLedgerKey) throw new Error(`Canonical broker ledger key was not found for ${canonicalLedgerPath}. Existing state was preserved.`);
    const ledger = createPreferredEventLedger(canonicalLedgerBase, canonicalLedgerKey);
    this.broker = new IntegratedPowerBroker(ledger, createFirstWaveAdapters());
    await this.broker.initialize();
    try {
      this.server = await startBrokerServer(this.broker, port);
      this.log(`Broker successfully listening on http://127.0.0.1:${port}`);
    } catch (error) {
      const racedHealth = isAddressInUse(error) ? await probeBroker(port) : undefined;
      if (!racedHealth) {
        this.log(`Broker start error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      this.broker = undefined;
      this.server = { port, close: async () => undefined };
      this.attachedHealth = racedHealth;
      this.log(isCompatibleBroker(racedHealth)
        ? `Broker port ${port} in use, attached to compatible process.`
        : `Broker port ${port} belongs to an incompatible legacy process; it remains running. Health: ${JSON.stringify(racedHealth)}`);
    }
    await context.globalState.update("integratedPower.broker.v1", {
      port: this.server.port,
      startedAt: new Date().toISOString(),
      bind: "127.0.0.1",
    });
  }

  public getPort(): number | undefined { return this.server?.port; }
  public getBroker(): IntegratedPowerBroker | undefined { return this.broker; }
  public getClient(): BrokerClient {
    this.brokerClient ??= new BrokerClient(() => this.getPort());
    return this.brokerClient;
  }
  public getAttachedHealth(): BrokerHealth | undefined { return this.attachedHealth; }

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

function probeBroker(port: number): Promise<BrokerHealth | undefined> {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          const health = JSON.parse(body) as BrokerHealth;
          resolve(response.statusCode === 200 && health.service === "integrated-power-broker" ? health : undefined);
        }
        catch { resolve(undefined); }
      });
    });
    request.on("error", () => resolve(undefined));
    request.on("timeout", () => { request.destroy(); resolve(undefined); });
  });
}

function isCompatibleBroker(health: BrokerHealth): boolean {
  const required = ["tasks.read", "tasks.write", "approvals.read", "approvals.userDecision", "workspaces.read", "runs.read", "metrics.localLlm.read"];
  return health.schemaVersion === 2 && required.every((capability) => health.capabilities?.includes(capability));
}

function existingLedgerCandidates(basePath: string): string[] {
  const candidates = [basePath, `${basePath}.jsonl`].filter((candidate) => fs.existsSync(candidate));
  if (candidates.length > 1) {
    throw new Error(`Multiple broker ledger formats exist beside ${basePath}. All files were preserved; resolve the ambiguity before startup.`);
  }
  return candidates;
}

function existingLedgerPath(basePath: string): string {
  return existingLedgerCandidates(basePath)[0] ?? basePath;
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EADDRINUSE");
}
