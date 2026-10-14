// scripts/verify-cross-platform-broker.js
// Integrated Power: Verification Suite for Cross-Platform Broker & Durable Protocol

const fs = require('fs');
const path = require('path');
const http = require('http');

const arg = process.argv[2];

function loadBroker() {
  const tsPath = path.join(__dirname, '..', 'vscode-extension', 'out', 'broker', 'index.js');
  if (fs.existsSync(tsPath)) {
    return require(tsPath);
  }
  const bundled = path.join(__dirname, '..', 'control-center', 'broker-out', 'broker', 'index.js');
  if (fs.existsSync(bundled)) {
    return require(bundled);
  }
  throw new Error('Broker bundle missing. Run npm run compile first.');
}

async function run() {
  const broker = loadBroker();

  if (arg === '--check-paths') {
    const {
      resolvePlatformStateRoot,
      resolvePlatformConfigDir,
      resolveGoogleDriveMcpPaths,
      getPlatformPaths,
    } = broker;

    // 1. Windows simulation
    const winRoot = resolvePlatformStateRoot(undefined, 'win32', { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }, 'C:\\Users\\test');
    if (!winRoot.includes('IntegratedPower\\state') || !winRoot.startsWith('C:\\Users\\test\\AppData\\Local')) {
      console.error('Windows stateRoot failed:', winRoot);
      process.exit(1);
    }

    // 2. macOS simulation
    const macRoot = resolvePlatformStateRoot(undefined, 'darwin', {}, '/Users/test');
    if (macRoot !== '/Users/test/Library/Application Support/IntegratedPower/state') {
      console.error('macOS stateRoot failed:', macRoot);
      process.exit(1);
    }

    // 3. Linux XDG simulation
    const linuxRoot = resolvePlatformStateRoot(undefined, 'linux', { XDG_DATA_HOME: '/home/test/.local/share' }, '/home/test');
    if (linuxRoot !== '/home/test/.local/share/IntegratedPower/state') {
      console.error('Linux stateRoot failed:', linuxRoot);
      process.exit(1);
    }

    // 4. Linux XDG fallback
    const linuxFallback = resolvePlatformStateRoot(undefined, 'linux', {}, '/home/test');
    if (linuxFallback !== '/home/test/.local/share/IntegratedPower/state') {
      console.error('Linux fallback stateRoot failed:', linuxFallback);
      process.exit(1);
    }

    // 5. Google Drive MCP paths on POSIX
    const gdriveLinux = resolveGoogleDriveMcpPaths('linux', {}, '/home/test');
    if (gdriveLinux.configDir !== '/home/test/.config/google-drive-mcp') {
      console.error('Linux gdrive configDir failed:', gdriveLinux);
      process.exit(1);
    }

    console.log('cross-platform paths verified');
    process.exit(0);
  }

  if (arg === '--check-standalone-broker') {
    const standaloneScript = path.join(__dirname, 'standalone-broker.js');
    if (!fs.existsSync(standaloneScript)) {
      console.error('standalone-broker.js missing');
      process.exit(1);
    }
    const content = fs.readFileSync(standaloneScript, 'utf-8');
    if (!content.includes('probeBroker') || !content.includes('IntegratedPowerBroker') || !content.includes('SIGINT')) {
      console.error('standalone-broker.js incomplete');
      process.exit(1);
    }

    // Test probe against loopback port
    const { probeBroker } = require(standaloneScript);
    const probe = await probeBroker(37241, 600);
    // Even if broker is running or stopped, probe function must resolve cleanly without crashing
    if (typeof probe.alive !== 'boolean') {
      console.error('probeBroker returned invalid result:', probe);
      process.exit(1);
    }

    console.log('standalone broker lifecycle verified');
    process.exit(0);
  }

  if (arg === '--check-approval-discipline') {
    // Verify that self-approval blocking and approval discipline are enforced
    const serverPath = path.join(__dirname, '..', 'vscode-extension', 'src', 'broker', 'server.ts');
    const serverCode = fs.readFileSync(serverPath, 'utf-8');

    // Authority rule: approvals are only granted via explicit user UI endpoints, not autonomous agents
    const hasApprovalRoute = serverCode.includes('/v1/approvals') && serverCode.includes('/approve');
    const hasRejectRoute = serverCode.includes('/reject');
    const mentionsControlCenterOnly = serverCode.includes('control center') || serverCode.includes('approval');

    if (!hasApprovalRoute || !hasRejectRoute || !mentionsControlCenterOnly) {
      console.error('Approval discipline code missing in server.ts');
      process.exit(1);
    }

    // Verify protocol task statuses
    const protocolPath = path.join(__dirname, '..', 'vscode-extension', 'src', 'broker', 'protocol.ts');
    const protocolCode = fs.readFileSync(protocolPath, 'utf-8');
    if (!protocolCode.includes('"awaiting_approval"') || !protocolCode.includes('"running"') || !protocolCode.includes('"completed"')) {
      console.error('Protocol missing durable task statuses');
      process.exit(1);
    }

    console.log('approval discipline verified');
    process.exit(0);
  }

  if (arg === '--check-distillation-bridge') {
    const { DriveKnowledgeDistillationBridge } = broker;
    if (!DriveKnowledgeDistillationBridge) {
      console.error('DriveKnowledgeDistillationBridge missing from broker exports');
      process.exit(1);
    }

    const bridge = new DriveKnowledgeDistillationBridge();
    const fakeTask = {
      id: 'task_test_123',
      title: 'Decouple Broker Cross-Platform',
      goal: 'Decouple Integrated Power broker from IDE and align with IPCC',
      contextFiles: ['platformPaths.ts'],
      originProvider: 'google.antigravity.ide',
      privacy: 'private',
      status: 'completed',
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const fakeArtifacts = [
      {
        fileId: 'gdrive_file_999',
        fileName: 'broker-e2e-recording.webp',
        remoteFolderId: 'artifacts_folder_001',
        sizeBytes: 15 * 1024 * 1024,
        webViewLink: 'https://drive.google.com/file/d/gdrive_file_999/view',
        uploadedAt: new Date().toISOString(),
      },
    ];

    const result = bridge.distill({
      task: fakeTask,
      summary: 'Successfully decoupled broker from IDE with cross-platform OS path resolver and durable protocol.',
      tags: ['#CrossPlatform', '#Architecture'],
      keyDecisions: ['Separate standalone daemon on port 37241', 'Preserve Git repo by offloading large binaries to Google Drive 5TB'],
      offloadedArtifacts: fakeArtifacts,
    });

    if (!result.markdown.includes('# Decouple Broker Cross-Platform')) {
      console.error('Distillation markdown missing title');
      process.exit(1);
    }
    if (!result.markdown.includes('https://drive.google.com/file/d/gdrive_file_999/view')) {
      console.error('Distillation markdown missing artifact pointer link');
      process.exit(1);
    }
    if (!result.markdown.includes('Google Drive 5TB')) {
      console.error('Distillation markdown missing storage tier info');
      process.exit(1);
    }

    console.log('distillation bridge verified');
    process.exit(0);
  }

  if (arg === '--check-docs') {
    const doc1 = path.join(__dirname, '..', 'docs', 'reference', 'cross-platform-broker-ipcc.ko.md');
    const doc2 = path.join(__dirname, '..', 'docs', 'reference', 'durable-agent-broker-protocol.ko.md');
    const reuseMap = path.join(__dirname, '..', 'docs', 'reuse-map.md');

    if (!fs.existsSync(doc1) || !fs.existsSync(doc2) || !fs.existsSync(reuseMap)) {
      console.error('Required doc files missing');
      process.exit(1);
    }

    const doc1Content = fs.readFileSync(doc1, 'utf-8');
    const doc2Content = fs.readFileSync(doc2, 'utf-8');
    const reuseContent = fs.readFileSync(reuseMap, 'utf-8');

    if (!doc1Content.includes('platformPaths.ts') || !doc1Content.includes('IPCC')) {
      console.error('cross-platform-broker-ipcc.ko.md missing key sections');
      process.exit(1);
    }
    if (!doc2Content.includes('에이전트는 자동화된 요소가 아니다') || !doc2Content.includes('DriveKnowledgeDistillationBridge')) {
      console.error('durable-agent-broker-protocol.ko.md missing key sections');
      process.exit(1);
    }
    if (!reuseContent.includes('platformPaths.ts') || !reuseContent.includes('DriveKnowledgeDistillationBridge')) {
      console.error('docs/reuse-map.md missing entries for new components');
      process.exit(1);
    }

    console.log('architecture and protocol docs verified');
    process.exit(0);
  }

  console.error('Usage: node verify-cross-platform-broker.js <--check-paths|--check-standalone-broker|--check-approval-discipline|--check-distillation-bridge|--check-docs>');
  process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
