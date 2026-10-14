# Gates: Cross-Platform Standalone Broker & Durable Agent-Broker Protocol

OWNS: vscode-extension/src/broker/platformPaths.ts, vscode-extension/src/broker/gdriveStorage.ts, scripts/standalone-broker.js, scripts/verify-cross-platform-broker.js, docs/reference/cross-platform-broker-ipcc.ko.md, docs/reference/durable-agent-broker-protocol.ko.md, docs/reuse-map.md, GATES.md

Scope: Decouple broker from Antigravity IDE into standalone cross-platform daemon (IPCC alignment) and specify durable agent-broker lifecycle protocol respecting agent non-autonomy.

- [x] G1: Cross-platform OS path resolution is implemented for Windows, macOS, and Linux
  CHECK: node scripts/verify-cross-platform-broker.js --check-paths
  EXPECT: cross-platform paths verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=18f67b641b615f5788805cba27bc3da036d694dd537535067f3ca28c7dfe3023; output-bytes=30

- [x] G2: Standalone headless broker runs decoupled from IDE on port 37241 with graceful shutdown
  CHECK: node scripts/verify-cross-platform-broker.js --check-standalone-broker
  EXPECT: standalone broker lifecycle verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=c0842b793f584f505b55d81a5d756ced9b3215535755e9879948bafb865d1518; output-bytes=37

- [x] G3: Durable task and approval lifecycle enforces human-in-the-loop and self-approval block
  CHECK: node scripts/verify-cross-platform-broker.js --check-approval-discipline
  EXPECT: approval discipline verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=e6bfc1d61ff5ba3d45142581ef4e0f52cd8f06eb1d2c5491fada26175eea69d9; output-bytes=29

- [x] G4: Organic Drive Inbox to Knowledge Distillation bridge pipeline is verified
  CHECK: node scripts/verify-cross-platform-broker.js --check-distillation-bridge
  EXPECT: distillation bridge verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=6b3b681b347d3262b080f24c16ec814fd678965358d3ca6e296241908d4ce619; output-bytes=29

- [x] G5: Cross-platform IPCC architecture reference and durable protocol specs are registered in reuse-map
  CHECK: node scripts/verify-cross-platform-broker.js --check-docs
  EXPECT: architecture and protocol docs verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=a3d66442032160703e9cf6c148d3686ea305346a58f0a3f231a6845ff91230f0; output-bytes=40

