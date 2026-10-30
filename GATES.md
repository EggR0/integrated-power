# Gates: Antigravity IDE 대화 세션 복구 및 알림 결함 근본 해결

OWNS: vscode-extension/src/AntigravityHistorySync.ts, vscode-extension/assets/antigravity/sync_history.py, vscode-extension/src/ConfigurationCenter.ts, tests/**

Scope: 대화 세션 신규 생성 시의 허위 복구 알림 버그를 완전히 차단하고, 워크스페이스 경로 불일치 및 Protobuf 스키마 결함으로 인해 실제로 사이드바에 복구되지 않던 문제를 근본적으로 해결한다.

- [x] G1: Protobuf 스키마 완비 검증 (Field 17 및 Field 22 준수)
  CHECK: node scripts/verify-gate-g1.mjs
  EXPECT: G1_PROTOBUF_SCHEMA_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=25d826e5655a/104 entries; EXPECT=matched; output-sha256=3da967e00ad17857fad489c8125855c0df9d70f54a1291995e36baf7f711a50c; output-bytes=72

- [x] G2: 신규 활성 세션(Active Session) 성급한 복구 판정 차단 검증
  CHECK: node scripts/verify-gate-g2.mjs
  EXPECT: G2_ACTIVE_SESSION_PROTECTION_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=25d826e5655a/104 entries; EXPECT=matched; output-sha256=7113b40cbea9f9bb4f448b4d53aa18fcc75deeeeb02f3ed3c5562ed907d4251a; output-bytes=94

- [x] G3: Transcript 기반 step_count 복원 및 brain 전용 세션 감지 검증
  CHECK: node scripts/verify-gate-g3.mjs
  EXPECT: G3_TRANSCRIPT_RECOVERY_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=25d826e5655a/104 entries; EXPECT=matched; output-sha256=5f5ce4f4f6269bc947d419a2e5c0752da1bdcc58e43b35d7a2d1f6b76dcab251; output-bytes=104

- [x] G4: 워크스페이스 URI 마이그레이션 및 사이드바 가시성 복원 검증
  CHECK: node scripts/verify-gate-g4.mjs
  EXPECT: G4_WORKSPACE_MIGRATION_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=25d826e5655a/104 entries; EXPECT=matched; output-sha256=d08254be5a4fae68d73160137b19eba3d1ac7720a6be1eaa17b32a20a5345b67; output-bytes=96

- [x] G5: AntigravityHistorySync의 silent 모드 팝업 차단 및 userTriggered 로직 검증
  CHECK: node scripts/verify-gate-g5.mjs
  EXPECT: G5_SILENT_MODE_GUARD_VERIFIED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=25d826e5655a/104 entries; EXPECT=matched; output-sha256=132ec0dec84590506d72fdc1f51bd55da650bc212453ea7cd2194c603679a44c; output-bytes=105

- [x] G6: 종합 회귀 테스트 및 TypeScript 빌드 검증
  CHECK: node scripts/verify-gate-g6.mjs
  EXPECT: G6_ALL_VERIFICATIONS_PASSED
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; path=25d826e5655a/104 entries; EXPECT=matched; output-sha256=0658d782bc1b9e48bbc8228a53026035bc53902f5564f091fc0d5531521b493f; output-bytes=1037

- [x] G7: 독립 외부 콘솔 복구 프로세스(Job Object 탈출 및 Clean Batch 실행) 검증
  CHECK: python scratch/verify_runner_clean.py
  EXPECT: EXIT CODE: 0, STDERR: <EMPTY>
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Workspace\Integrated POWER; test_breakout_survival.ps1=SUCCESS: Runner survived parent exit; verify_runner_clean.py=STDERR length 0; extension installed=eggr0.integrated-power-0.11.6.vsix

- [x] G8: Antigravity IDE 100개 대화 자동 삭제 한도 해제(5000개 영구 보존) 및 콘솔 즉시 종료(지연 런처) 검증
  CHECK: python scratch/test_patch_main.py && python scratch/check_db_convs.py
  EXPECT: replacement in main.js: True, UUIDs in state.vscdb: 152
  EVIDENCE: exit=0; main.js=cleanupOldTrajectorySummaries.js n$e=5000; state.vscdb=152 sessions preserved; delayed launcher=pythonw 1.2s delay; cmd.exe exit=clean 0; no Chromium log leak


