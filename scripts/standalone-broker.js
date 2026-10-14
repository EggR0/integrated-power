// scripts/standalone-broker.js
// Integrated Power: Standalone Cross-Platform Headless Broker Daemon Launcher

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

// Resolve broker bundle or TypeScript compiled output
function loadBroker() {
  const builtPath = path.join(__dirname, '..', 'vscode-extension', 'out', 'broker', 'index.js');
  if (fs.existsSync(builtPath)) {
    return require(builtPath);
  }
  const bundledPath = path.join(__dirname, '..', 'control-center', 'broker-out', 'broker', 'index.js');
  if (fs.existsSync(bundledPath)) {
    return require(bundledPath);
  }
  throw new Error('Broker package not found. Run "npm run compile" in vscode-extension first.');
}

function probeBroker(port = 37241, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/health',
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            resolve({
              alive: res.statusCode === 200 && data.service === 'integrated-power-broker',
              data,
            });
          } catch {
            resolve({ alive: false });
          }
        });
      }
    );
    req.on('error', () => resolve({ alive: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ alive: false });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const brokerMod = loadBroker();
  const {
    IntegratedPowerBroker,
    createFirstWaveAdapters,
    startBrokerServer,
    resolvePlatformStateRoot,
    resolveBrokerPort,
  } = brokerMod;

  const port = resolveBrokerPort(process.env);
  const stateRoot = resolvePlatformStateRoot(process.env.INTEGRATED_POWER_STATE_ROOT);
  fs.mkdirSync(stateRoot, { recursive: true });

  if (args.includes('--status')) {
    const probe = await probeBroker(port);
    if (probe.alive) {
      console.log(JSON.stringify({ status: 'running', port, ...probe.data }));
      process.exit(0);
    } else {
      console.log(JSON.stringify({ status: 'stopped', port }));
      process.exit(1);
    }
  }

  // Probe existing broker
  const initialProbe = await probeBroker(port);
  if (initialProbe.alive) {
    console.log(
      JSON.stringify({
        service: 'integrated-power-broker',
        status: 'attached_to_existing',
        port,
        bind: '127.0.0.1',
        platform: process.platform,
        stateRoot,
      })
    );
    return;
  }

  // Initialize canonical SQLite/encrypted ledger & broker
  const { EncryptedFileLedger } = brokerMod;
  const ledgerPath = path.join(stateRoot, 'ledger.dat');
  const ledger = new EncryptedFileLedger(ledgerPath);
  await ledger.initialize();

  const broker = new IntegratedPowerBroker(ledger, createFirstWaveAdapters());
  await broker.initialize();

  const server = await startBrokerServer(broker, port, { stateRoot });

  console.log(
    JSON.stringify({
      service: 'integrated-power-broker',
      status: 'started',
      port: server.port,
      bind: '127.0.0.1',
      pid: process.pid,
      platform: process.platform,
      stateRoot,
    })
  );

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down standalone broker cleanly...`);
    try {
      await server.close();
      console.log('Broker server stopped.');
      process.exit(0);
    } catch (e) {
      console.error('Error during shutdown:', e);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // Keep process alive
  if (args.includes('--once') || args.includes('--smoke')) {
    // Run smoke test verify then close
    const smokeProbe = await probeBroker(port);
    if (!smokeProbe.alive) {
      console.error('Smoke probe failed to reach newly started broker');
      process.exit(1);
    }
    await shutdown('SMOKE_COMPLETE');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to run standalone broker:', err);
    process.exit(1);
  });
}

module.exports = { probeBroker, main };
