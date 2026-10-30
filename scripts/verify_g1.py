import sys
import os
import base64

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(repo_root, "vscode-extension", "assets", "antigravity"))
from sync_history import build_trajectory_entry, parse_protobuf

test_info = {
    'cascade_id': '11111111-2222-3333-4444-555555555555',
    'trajectory_id': '66666666-7777-8888-9999-000000000000',
    'title': 'Test Gate Session',
    'step_count': 42,
    'workspace_uri': 'file:///d:/Workspace/Integrated%20POWER',
    'mtime': 1780000000,
    'ctime': 1770000000,
    'branch': 'main'
}

entry = build_trajectory_entry(test_info)
top_fields = parse_protobuf(entry)

assert len(top_fields) == 1, f"Expected 1 top field, got {len(top_fields)}"
assert top_fields[0][0] == 1, "Expected field number 1"
fval = top_fields[0][2]
sub = parse_protobuf(fval)
assert len(sub) == 2, f"Expected 2 sub fields, got {len(sub)}"
assert sub[0][0] == 1, "Expected sub field 1 (cascade_id)"
assert sub[0][2].decode('utf-8') == test_info['cascade_id'], "Cascade ID mismatch"

assert sub[1][0] == 2, "Expected sub field 2 (wrapper)"
sub2 = parse_protobuf(sub[1][2])
b64_chunk = sub2[0][2]
decoded = base64.b64decode(b64_chunk)
sub3 = parse_protobuf(decoded)

field_map = {f[0]: f for f in sub3}

# Mandatory fields
assert 1 in field_map, "Field 1 (title) missing"
assert 2 in field_map, "Field 2 (step_count) missing"
assert 3 in field_map, "Field 3 (ts_end) missing"
assert 4 in field_map, "Field 4 (trajectory_id) missing"
assert 7 in field_map, "Field 7 (ts_start) missing"
assert 9 in field_map, "Field 9 (workspace_info) missing"
assert 16 in field_map, "Field 16 (step_count) missing"
assert 17 in field_map, "Field 17 (SessionDetails) missing"
assert 22 in field_map, "Field 22 (status) missing"
assert field_map[22][2] == 4, f"Field 22 must be 4, got {field_map[22][2]}"

# Verify Field 17 subfields
f17_sub = parse_protobuf(field_map[17][2])
f17_map = {f[0]: f for f in f17_sub}
assert 1 in f17_map, "Field 17.1 (WorkspaceInfo) missing"
assert 2 in f17_map, "Field 17.2 (ts_start) missing"
assert 3 in f17_map, "Field 17.3 (trajectory_id) missing"
assert 7 in f17_map, "Field 17.7 (workspace_uri) missing"

print("G1_PYTHON_ASSERTIONS_PASSED")
