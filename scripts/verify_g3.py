import sys
import os
import sqlite3

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(repo_root, "vscode-extension", "assets", "antigravity"))
from sync_history import extract_session_info, ensure_db_stub, USER_PROFILE, CONV_DIR, BRAIN_DIR

# 1. Test 59a5725d session whose SQLite steps == 0
cid_59a5 = "59a5725d-db01-44f2-a6d8-319d89e33338"
db_path = os.path.join(CONV_DIR, f"{cid_59a5}.db")
if os.path.exists(db_path):
    info = extract_session_info(cid_59a5, db_path)
    print(f"59a5 info: step_count={info['step_count']}, title={info['title']}")
    assert info['step_count'] > 0, "Expected step_count > 0 restored from transcript"
    assert info['title'] != '대화 세션', "Expected meaningful title restored from transcript"

# 2. Test fd107758 session (one of the recovered brain-only sessions)
cid_fd10 = "fd107758-5f3d-4028-b680-74c889ea83df"
db_path_fd10 = os.path.join(CONV_DIR, f"{cid_fd10}.db")
assert os.path.exists(db_path_fd10), f"Expected {db_path_fd10} to exist as stub"

# Verify stub db schema
conn = sqlite3.connect(db_path_fd10)
c = conn.cursor()
c.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = set(r[0] for r in c.fetchall())
conn.close()

assert 'trajectory_meta' in tables, "trajectory_meta table missing in stub"
assert 'steps' in tables, "steps table missing in stub"
assert 'trajectory_metadata_blob' in tables, "trajectory_metadata_blob table missing in stub"

info_fd10 = extract_session_info(cid_fd10, db_path_fd10)
print(f"fd10 info: step_count={info_fd10['step_count']}, title={info_fd10['title']}")
assert info_fd10['step_count'] > 0, "Brain session should have restored steps"
assert info_fd10['title'] != '대화 세션', "Brain session should have extracted title"

print("G3_PYTHON_ASSERTIONS_PASSED")
