// Keep stdout strictly reserved for MCP JSON-RPC frames.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);

const fs = require("fs");
const os = require("os");
const path = require("path");
const bundledModule = fs.existsSync(path.join(__dirname, "broker-out", "broker", "broker-manifest.json"))
  ? path.join(__dirname, "broker-out", "broker")
  : path.join(__dirname, "src-tauri", "resources", "broker-out", "broker");
const { resolveBrokerPackage } = require("./scripts/broker-package.js");
const brokerPackage = resolveBrokerPackage({
  modulePath: process.env.INTEGRATED_POWER_BROKER_MODULE,
  sourcePath: process.env.INTEGRATED_POWER_BROKER_SOURCE,
  packagePath: process.env.INTEGRATED_POWER_BROKER_PACKAGE || bundledModule,
});
const { prepareCanonicalBrokerLedger, configureBrokerAssets, probeBroker, isAddressInUse } = require("./scripts/canonical-broker-state.js");
configureBrokerAssets(brokerPackage, process.env);
const { IntegratedPowerBroker, createFirstWaveAdapters, startBrokerServer, startMcpStdioServer } = require(brokerPackage.entrypointPath);
const stateRoot = process.env.INTEGRATED_POWER_STATE_ROOT || process.env.INTEGRATED_POWER_STATE_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "IntegratedPower", "state");
process.env.INTEGRATED_POWER_STATE_ROOT = stateRoot;
process.env.INTEGRATED_POWER_MCP_SERVER ||= __filename;
fs.mkdirSync(stateRoot, { recursive: true });
(async () => {
  const { ledger } = await prepareCanonicalBrokerLedger(brokerPackage, stateRoot);
  const broker = new IntegratedPowerBroker(ledger, createFirstWaveAdapters());
  await broker.initialize();

  let httpServer;
  if (process.env.INTEGRATED_POWER_MCP_AUTOSTART_HTTP !== "0") {
    const rawPort = Number.parseInt(process.env.INTEGRATED_POWER_BROKER_PORT || "37241", 10);
    const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 37241;
    if (!(await probeBroker(port))) {
      try {
        httpServer = await startBrokerServer(broker, port, { stateRoot, staticDir: path.join(__dirname, "dist") });
      } catch (error) {
        if (!isAddressInUse(error) || !(await probeBroker(port))) {
          console.error("[integrated-power-mcp] HTTP broker autostart failed:", error);
        }
      }
    }
  }

  let closed = false;
  const shutdown = () => {
    if (closed) return;
    closed = true;
    if (httpServer) {
      void httpServer.close().finally(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);

  await startMcpStdioServer(broker);
})().catch((error) => { console.error(error); process.exitCode = 1; });
