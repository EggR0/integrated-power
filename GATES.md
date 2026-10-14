# Gates: Integrated Power Google Drive Ingestion (B) & Artifact Offloader (C)

OWNS: vscode-extension/src/broker/gdriveStorage.ts, scripts/test-gdrive-broker-integration.js, docs/reference/google-drive-storage-broker.ko.md, docs/reuse-map.md, GATES.md

Scope: Implement Google Drive Inbox Ingestion Service (Option B) and Artifact Offloader (Option C) for Integrated Power broker with full tests and reuse-map integration.

- [x] G1: Google Drive storage client module is implemented with token refresh and folder management
  CHECK: node scripts/test-gdrive-broker-integration.js --check-client
  EXPECT: gdrive client module verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=f3547d373bd70c3e444dc626ba6ceda570c955ce71338ede639b0f935490f05d; output-bytes=62

- [x] G2: Option B Drive Ingestion Service converts Drive Inbox items to Broker TaskEnvelopes with idempotency
  CHECK: node scripts/test-gdrive-broker-integration.js --check-ingestion
  EXPECT: drive ingestion service verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=393104ec3fa3561753b7740c2f176bfb6ff140b5933d2a553217dc08bf3dd6c7; output-bytes=33

- [x] G3: Option C Drive Artifact Offloader uploads local artifacts to Drive with metadata and remote links
  CHECK: node scripts/test-gdrive-broker-integration.js --check-offloader
  EXPECT: drive artifact offloader verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=1991f399f0c5c759ede62b76dcd015ee0cd13613ebb8fce934b6fe0a53e4de45; output-bytes=34

- [x] G4: End-to-end integration test passes for both Ingestion (B) and Offloader (C)
  CHECK: node scripts/test-gdrive-broker-integration.js --check-e2e
  EXPECT: gdrive integration e2e verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=ffad903c59c42f5dccaace4ca97b8cb131dbbd7bb4b3b030ed55755cb286fbc8; output-bytes=522

- [x] G5: Documentation and reuse-map are updated with Option B and Option C authorities
  CHECK: node scripts/test-gdrive-broker-integration.js --check-docs
  EXPECT: gdrive storage docs verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=8e9fee7608d7aa5af2c30b117e3581b3e47698160020ecc9d185f33ee5247147; output-bytes=29
