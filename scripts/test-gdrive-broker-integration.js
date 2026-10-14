// scripts/test-gdrive-broker-integration.js
// Integrated Power: Verification Suite for Google Drive Ingestion (B) & Offloader (C)

const fs = require('fs');
const path = require('path');

// Dynamically compile/require TypeScript or transpiled module, or pure Node test
const arg = process.argv[2];

// Helper to load or mock the compiled gdriveStorage
function loadGdriveStorage() {
  // We can transpile gdriveStorage.ts via ts-node or run inline test
  const tsPath = path.join(__dirname, '..', 'vscode-extension', 'src', 'broker', 'gdriveStorage.ts');
  if (!fs.existsSync(tsPath)) {
    throw new Error(`gdriveStorage.ts missing at ${tsPath}`);
  }
  // Simple transpiler for testing using ts-node or esbuild or inline eval
  try {
    return require('../vscode-extension/out/broker/gdriveStorage.js');
  } catch (e) {
    // If not compiled yet, we can compile or use ts-node
    const tsCode = fs.readFileSync(tsPath, 'utf-8');
    // Strip type annotations or compile with typescript if available
    const ts = require(path.join(__dirname, '..', 'vscode-extension', 'node_modules', 'typescript'));
    const jsCode = ts.transpileModule(tsCode, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const m = { exports: {} };
    const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', jsCode);
    fn(require, m, m.exports, path.dirname(tsPath), tsPath);
    return m.exports;
  }
}

async function run() {
  const mod = loadGdriveStorage();
  const { GoogleDriveAuth, GoogleDriveClient, DriveIngestionService, DriveArtifactOffloader } = mod;

  if (arg === '--check-client') {
    const auth = new GoogleDriveAuth();
    if (!auth.isConfigured()) {
      console.error('GoogleDriveAuth is not configured');
      process.exit(1);
    }
    const client = new GoogleDriveClient(auth);
    const quota = await client.getStorageQuota();
    if (quota.limitGb >= 5000) {
      console.log(`Quota limit verified: ${quota.limitGb.toFixed(1)} GB`);
      console.log('gdrive client module verified');
      process.exit(0);
    } else {
      console.error(`Unexpected quota limit: ${quota.limitGb} GB`);
      process.exit(1);
    }
  } else if (arg === '--check-ingestion') {
    // Unit test Ingestion Service with Mock Client
    const mockFiles = [
      { id: 'file_1', name: 'Meeting_Notes.txt', mimeType: 'text/plain' },
      { id: 'file_2', name: 'PRD_Document', mimeType: 'application/vnd.google-apps.document' },
    ];
    let movedFileCount = 0;
    const mockClient = {
      ensureIntegratedPowerStructure: async () => ({
        rootId: 'root',
        inboxId: 'inbox_123',
        inboxProcessedId: 'processed_456',
        artifactsId: 'art_789',
      }),
      listFilesInFolder: async (fId) => {
        if (fId === 'inbox_123') return mockFiles;
        return [];
      },
      downloadFileText: async (f) => `Dummy content of ${f.name}`,
      moveFile: async (fileId, fromId, toId) => {
        if (fromId === 'inbox_123' && toId === 'processed_456') {
          movedFileCount++;
        }
      },
    };

    const createdTasks = [];
    const taskCreator = async (input) => {
      createdTasks.push(input);
      return { id: `task_${createdTasks.length}`, ...input };
    };

    const ingestion = new DriveIngestionService(mockClient, taskCreator);
    const results = await ingestion.pollAndIngest();

    if (
      results.length === 2 &&
      movedFileCount === 2 &&
      createdTasks.length === 2 &&
      createdTasks[0].idempotencyKey === 'gdrive_inbox_file_1' &&
      createdTasks[1].idempotencyKey === 'gdrive_inbox_file_2'
    ) {
      console.log('drive ingestion service verified');
      process.exit(0);
    } else {
      console.error('Ingestion verification failed', { results, movedFileCount, createdTasks });
      process.exit(1);
    }
  } else if (arg === '--check-offloader') {
    // Unit test Offloader with Mock Client
    const scratchDir = path.join(__dirname, '..', 'scratch');
    fs.mkdirSync(scratchDir, { recursive: true });
    const dummyFile = path.join(scratchDir, 'dummy-artifact.log');
    fs.writeFileSync(dummyFile, 'Test build log output 12345', 'utf-8');

    let uploadedPayload = null;
    const mockClient = {
      ensureIntegratedPowerStructure: async () => ({
        rootId: 'root',
        inboxId: 'inbox',
        inboxProcessedId: 'processed',
        artifactsId: 'artifacts_root',
      }),
      ensureFolder: async (name, parentId) => `folder_${name}`,
      uploadFile: async (parentId, fileName, mimeType, content) => {
        uploadedPayload = { parentId, fileName, mimeType, size: content.length };
        return {
          id: 'uploaded_id_999',
          name: fileName,
          webViewLink: 'https://drive.google.com/file/d/uploaded_id_999/view',
        };
      },
    };

    const offloader = new DriveArtifactOffloader(mockClient);
    const res = await offloader.offloadArtifact('task_abc', dummyFile);

    if (
      res.fileId === 'uploaded_id_999' &&
      res.fileName === 'dummy-artifact.log' &&
      uploadedPayload &&
      uploadedPayload.mimeType === 'text/plain' &&
      uploadedPayload.parentId === 'folder_task_abc'
    ) {
      console.log('drive artifact offloader verified');
      process.exit(0);
    } else {
      console.error('Offloader verification failed', res);
      process.exit(1);
    }
  } else if (arg === '--check-e2e') {
    // End-to-End Live Verification with user's Google Drive
    console.log('Running Live E2E Verification against Google Drive (5TB)...');
    const auth = new GoogleDriveAuth();
    const client = new GoogleDriveClient(auth);
    const structure = await client.ensureIntegratedPowerStructure();

    console.log('IntegratedPower Folder Structure:');
    console.log(`- Root      : ${structure.rootId}`);
    console.log(`- Inbox     : ${structure.inboxId}`);
    console.log(`- Processed : ${structure.inboxProcessedId}`);
    console.log(`- Artifacts : ${structure.artifactsId}`);

    // Create a live test artifact to upload
    const scratchDir = path.join(__dirname, '..', 'scratch');
    fs.mkdirSync(scratchDir, { recursive: true });
    const testFile = path.join(scratchDir, 'live-e2e-artifact.json');
    const testContent = {
      test: 'Integrated Power E2E Artifact Offload',
      timestamp: new Date().toISOString(),
      storageQuota: '5TB verified',
    };
    fs.writeFileSync(testFile, JSON.stringify(testContent, null, 2), 'utf-8');

    const offloader = new DriveArtifactOffloader(client);
    const uploadRes = await offloader.offloadArtifact('e2e-verification-task', testFile);

    console.log('Live Upload Success:');
    console.log(`- File ID   : ${uploadRes.fileId}`);
    console.log(`- File Name : ${uploadRes.fileName}`);
    console.log(`- Web Link  : ${uploadRes.webViewLink}`);

    if (uploadRes.fileId && structure.artifactsId) {
      console.log('gdrive integration e2e verified');
      process.exit(0);
    } else {
      console.error('Live E2E verification failed');
      process.exit(1);
    }
  } else if (arg === '--check-docs') {
    const docPath = path.join(__dirname, '..', 'docs', 'reference', 'google-drive-storage-broker.ko.md');
    const reusePath = path.join(__dirname, '..', 'docs', 'reuse-map.md');

    if (fs.existsSync(docPath) && fs.existsSync(reusePath)) {
      const docText = fs.readFileSync(docPath, 'utf-8');
      const reuseText = fs.readFileSync(reusePath, 'utf-8');

      const hasB = docText.includes('DriveIngestionService') && reuseText.includes('DriveIngestionService');
      const hasC = docText.includes('DriveArtifactOffloader') && reuseText.includes('DriveArtifactOffloader');

      if (hasB && hasC) {
        console.log('gdrive storage docs verified');
        process.exit(0);
      }
    }
    console.error('Docs or reuse-map missing Option B/C details');
    process.exit(1);
  } else {
    console.error('Invalid argument');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in test-gdrive-broker-integration:', err);
  process.exit(1);
});
