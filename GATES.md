# Gates: Quota Idle State & Pre-warm Window Activation

OWNS: shared/quota/**, vscode-extension/scripts/**, vscode-extension/src/**, vscode-extension/webview/**

Scope: Eliminate phantom countdown when quota is 100%, implement pre-warm window activation with instant cancellation, and integrate stop button selectors.

- [x] G1: When 5-hour quota is 100% or above 99.95%, the refresh timer displays Ready and canPrewarm is true
  CHECK: node ./vscode-extension/scripts/test-quota-core.js
  EXPECT: phantom countdown eliminated for 100% quota
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=0376c59e871f71e7f0227a7d91a0c83e3565c6753f45cf3831e769e9589ca172; output-bytes=2632

- [x] G2: Pre-warm trigger emits a minimal token ping and aborts immediately, transitioning the 5-hour window into active countdown with >99% quota retained
  CHECK: node ./vscode-extension/scripts/test-prewarm.js
  EXPECT: pre-warm trigger test passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=c12c3503fb45a7c5331d81fcac0ba57a10677793be4a735890ccdb33530ab823; output-bytes=264

- [x] G3: Webview and control-center expose the pre-warm action button when 5h window is Ready, and Antigravity IDE stop selectors are properly referenced
  CHECK: node ./vscode-extension/scripts/test-compact-ui.js
  EXPECT: compact UI regression passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=8791916324977ffb4b8f2d66fba5af5d10bc149f40eda7d0932bfbd322f8ff06; output-bytes=29

- [x] G4: Full headless and broker regression suites pass without regression
  CHECK: node ./vscode-extension/scripts/run-headless-tests.js
  EXPECT: headless tests passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=d87892797d07/22 entries; EXPECT=matched; output-sha256=460cc06ca6c609edef2174526d16ce815b5631f41358d9c09581ebd352da0759; output-bytes=1789
