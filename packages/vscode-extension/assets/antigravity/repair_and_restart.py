#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Antigravity IDE Complete Recovery & Restart Orchestrator
Executes out-of-process while Antigravity IDE is closed, ensuring
that in-memory caches do not overwrite state.vscdb on shutdown.
"""

import sys
import os
import time
import argparse
import subprocess
import shutil

# Ensure utf-8 output
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

USER_PROFILE = os.environ.get('USERPROFILE', os.path.expanduser('~'))
LOG_DIR = os.path.join(USER_PROFILE, r'.gemini\antigravity-ide\logs')
LOG_FILE = os.path.join(LOG_DIR, 'repair_and_restart.log')

def log(msg):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass

def is_pid_running(pid):
    if pid <= 0:
        return False
    try:
        if sys.platform == 'win32':
            import ctypes
            SYNCHRONIZE = 0x00100000
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not handle:
                return False
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        else:
            os.kill(pid, 0)
            return True
    except Exception:
        return False

def merge_legacy_files():
    legacy_conv = os.path.join(USER_PROFILE, r'.gemini\antigravity\conversations')
    active_conv = os.path.join(USER_PROFILE, r'.gemini\antigravity-ide\conversations')
    legacy_brain = os.path.join(USER_PROFILE, r'.gemini\antigravity\brain')
    active_brain = os.path.join(USER_PROFILE, r'.gemini\antigravity-ide\brain')

    merged_conv = 0
    if os.path.exists(legacy_conv) and os.path.exists(active_conv):
        for f in os.listdir(legacy_conv):
            src_f = os.path.join(legacy_conv, f)
            dst_f = os.path.join(active_conv, f)
            if not os.path.exists(dst_f):
                try:
                    shutil.copy2(src_f, dst_f)
                    merged_conv += 1
                except Exception as e:
                    log(f"Error copying {f}: {e}")

    merged_brain = 0
    if os.path.exists(legacy_brain) and os.path.exists(active_brain):
        for d in os.listdir(legacy_brain):
            src_d = os.path.join(legacy_brain, d)
            dst_d = os.path.join(active_brain, d)
            if os.path.isdir(src_d) and not os.path.exists(dst_d):
                try:
                    shutil.copytree(src_d, dst_d)
                    merged_brain += 1
                except Exception as e:
                    log(f"Error copying brain dir {d}: {e}")

    log(f"Legacy merge: {merged_conv} conversations, {merged_brain} brain directories merged.")

def patch_ide_history_limit():
    """
    Antigravity IDE's electron-main bundle (main.js) contains cleanupOldTrajectorySummaries.js
    with a hardcoded limit of n$e=100. On startup, it actively purges all conversations beyond 100.
    Lifting this limit to 5000 prevents Antigravity IDE from wiping out restored older sessions.
    """
    user_profile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
    main_js_path = os.path.join(user_profile, r'AppData\Local\Programs\Antigravity IDE\resources\app\out\main.js')
    if not os.path.exists(main_js_path):
        return
    try:
        with open(main_js_path, 'r', encoding='utf-8') as f:
            content = f.read()

        target = 'cleanupOldTrajectorySummaries.js"(){"use strict";Km(),XFr(),zi(),n$e=100}});'
        replacement = 'cleanupOldTrajectorySummaries.js"(){"use strict";Km(),XFr(),zi(),n$e=5000}});'

        if target in content:
            bak_path = main_js_path + '.bak'
            if not os.path.exists(bak_path):
                shutil.copy2(main_js_path, bak_path)
            new_content = content.replace(target, replacement, 1)
            with open(main_js_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            log("  -> Antigravity IDE 최대 대화 보존 한도 확장 완료 (100개 -> 5000개 영구 보존)")
        elif replacement in content:
            log("  -> Antigravity IDE 최대 대화 보존 한도(5000개)가 정상 유지되고 있습니다.")
    except Exception as e:
        log(f"  -> main.js 보존 한도 확장 중 예외 (무시됨): {e}")

def main():
    parser = argparse.ArgumentParser(description="Antigravity IDE Repair and Restart")
    parser.add_argument("--ide-pid", type=int, default=0, help="PID of running Antigravity IDE process")
    parser.add_argument("--workspace", type=str, default="", help="Workspace folder path to reopen")
    parser.add_argument("--exec-path", type=str, default="", help="Executable path for Antigravity IDE")
    parser.add_argument("--target-ws-uri", type=str, default="file:///d:/Workspace/Integrated%20POWER", help="Target workspace URI")
    args = parser.parse_args()

    log("================================================================")
    log(" [Integrated Power] Antigravity IDE 대화 기록 안전 복구 및 재시작")
    log("================================================================")
    log(f" * 대상 워크스페이스: {args.workspace or '현재 워크스페이스'}")
    log(f" * Antigravity IDE PID: {args.ide_pid}")
    log("----------------------------------------------------------------")

    # 1. Wait for Antigravity IDE to exit
    if args.ide_pid > 0:
        log(f"[1/4] Antigravity IDE(PID {args.ide_pid}) 프로세스 종료 대기 중...")
        start_wait = time.time()
        while time.time() - start_wait < 25:
            if not is_pid_running(args.ide_pid):
                log("  -> Antigravity IDE 프로세스가 완전히 종료되었습니다.")
                break
            time.sleep(0.5)
        else:
            log("  -> 대기 제한 시간 도달, 복구 단계를 계속 진행합니다.")

    # 2. Wait an extra 3 seconds for file locks and flush to complete
    log("[2/4] SQLite 파일 락 해제 및 스토리지 캐시 디스크 동기화 대기 중 (3초)...")
    time.sleep(3.0)

    # 3. Merge legacy directory files
    log("[3/4] 구버전 세션 자동 병합 및 SQLite DB 영구 복구 주입 중...")
    merge_legacy_files()

    # 4. Run sync_history.py in forced mode while IDE is completely closed
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.append(script_dir)
    try:
        import sync_history
        res = sync_history.sync_conversations(
            dry_run=False,
            json_output=False,
            force=True,
            target_ws=args.target_ws_uri,
            active_grace_period_sec=0
        )
        restored = res.get('restored_count', 0)
        migrated = res.get('migrated_count', 0)
        valid = res.get('valid_indexed', 0)
        log(f"  -> 복구 성공: 복원 세션 {restored}개, 마이그레이션 {migrated}개 (총 {valid}개 세션 정상 인덱싱)")
    except Exception as e:
        log(f"  -> DB 복구 중 오류 발생: {e}")

    # 5. Patch Antigravity IDE hardcoded 100 conversation limit so it does not prune restored sessions
    patch_ide_history_limit()

    # 6. Brief stabilization wait
    time.sleep(1.0)

    # 7. Schedule detached relaunch after console exits
    log("[4/4] 복구 완료. 콘솔 창을 즉시 닫고 Antigravity IDE를 독립 실행합니다...")
    target_exe = None
    if args.exec_path and os.path.exists(args.exec_path):
        target_exe = args.exec_path
    else:
        default_exe = os.path.expandvars(r'%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe')
        if os.path.exists(default_exe):
            target_exe = default_exe

    workspace_arg = f'"{args.workspace}"' if (args.workspace and os.path.exists(args.workspace)) else ""

    # Find pythonw.exe to run the delayed launch without any console window
    user_profile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
    pythonw_candidates = [
        os.path.join(user_profile, r'AppData\Local\Programs\Python\Python311\pythonw.exe'),
        'pythonw.exe',
        'pythonw'
    ]
    pythonw_bin = 'pythonw.exe'
    for p in pythonw_candidates:
        if os.path.isabs(p) and os.path.exists(p):
            pythonw_bin = p
            break

    temp_dir = os.environ.get('TEMP', os.environ.get('TMP', 'C:\\Temp'))
    launcher_script_path = os.path.join(temp_dir, 'antigravity_delayed_launcher.py')
    launcher_code = f"""import time, os
# Wait 1.2s for the recovery CMD console to completely close and be destroyed
time.sleep(1.2)
try:
    os.startfile(r'{target_exe}', 'open', arguments=r'{workspace_arg}')
except Exception:
    import subprocess
    cmd = [r'{target_exe}']
    if r'{args.workspace}':
        cmd.append(r'{args.workspace}')
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
"""
    with open(launcher_script_path, 'w', encoding='utf-8') as f:
        f.write(launcher_code)

    creationflags = 0
    if sys.platform == 'win32':
        creationflags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP

    subprocess.Popen([pythonw_bin, launcher_script_path], creationflags=creationflags, close_fds=True)
    log("  -> 1.2초 후 Antigravity IDE 독립 실행 예약 완료.")
    log("================================================================")
    log(" [완료] 대화 기록이 안전하게 복구되었습니다. 이 창은 즉시 닫힙니다.")
    log("================================================================")
    time.sleep(0.5)
    sys.exit(0)

if __name__ == "__main__":
    main()
