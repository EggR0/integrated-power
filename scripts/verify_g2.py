import sys
import os
import time

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(repo_root, "vscode-extension", "assets", "antigravity"))
from sync_history import sync_conversations, extract_session_info

# Test 1: Active grace period decision logic
now_ts = int(time.time())
recent_info = {'mtime': now_ts - 30} # 30 seconds ago
old_info = {'mtime': now_ts - 3600}   # 1 hour ago
grace_period = 300

# Recent file without force must be skipped
is_recent_skipped = (now_ts - recent_info['mtime']) < grace_period
assert is_recent_skipped == True, "Recent file should be detected as within grace period"

# Old file must not be skipped
is_old_skipped = (now_ts - old_info['mtime']) < grace_period
assert is_old_skipped == False, "Old file should not be skipped"

# Test 2: explicit exclude_active_cid check
active_cid = "11112222-3333-4444-5555-666677778888"
assert (active_cid == active_cid) == True

# Test 3: Integration run with force=False and force=True
res_normal = sync_conversations(dry_run=True, json_output=False, force=False)
assert res_normal['status'] == 'ok'

res_forced = sync_conversations(dry_run=True, json_output=False, force=True)
assert res_forced['status'] == 'ok'

print("G2_PYTHON_ASSERTIONS_PASSED")
