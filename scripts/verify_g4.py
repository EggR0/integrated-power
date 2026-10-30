import sys
import os
import base64

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(repo_root, "vscode-extension", "assets", "antigravity"))
from sync_history import (
    should_migrate_uri,
    update_existing_entry,
    build_trajectory_entry,
    parse_protobuf,
    DEFAULT_TARGET_WORKSPACE
)

# 1. Test should_migrate_uri logic across multiple legacy patterns
assert should_migrate_uri("file:///c:/Users/jsp0/Documents/Intergrated%20POWER", DEFAULT_TARGET_WORKSPACE) == True
assert should_migrate_uri("file:///c:/Users/jsp0/Documents/Intergrated POWER", DEFAULT_TARGET_WORKSPACE) == True
assert should_migrate_uri("file:///c%3A/Users/jsp0/Documents/Intergrated%20POWER", DEFAULT_TARGET_WORKSPACE) == True
assert should_migrate_uri("file:///d:/Workspace/Integrated%20POWER", DEFAULT_TARGET_WORKSPACE) == False
assert should_migrate_uri("file:///c:/obsidian/1%20Project/apple%20game", DEFAULT_TARGET_WORKSPACE) == False

# 2. Test update_existing_entry with a synthetic legacy entry
legacy_info = {
    'cascade_id': 'aaaa1111-bbbb-2222-cccc-333344445555',
    'trajectory_id': 'aaaa1111-bbbb-2222-cccc-333344445555',
    'title': 'Legacy C Drive Session',
    'step_count': 10,
    'workspace_uri': 'file:///c:/Users/jsp0/Documents/Intergrated%20POWER',
    'mtime': 1780000000,
    'ctime': 1770000000,
    'branch': 'main'
}
legacy_entry_bytes = build_trajectory_entry(legacy_info)

# The payload passed to update_existing_entry is fval (subfields of MapEntry)
top_fields = parse_protobuf(legacy_entry_bytes)
fval = top_fields[0][2]

target_ws = "file:///d:/Workspace/Integrated%20POWER"
upgraded_bytes, was_migrated = update_existing_entry(fval, target_ws)

assert was_migrated == True, "Expected was_migrated to be True for legacy entry"
assert upgraded_bytes is not None, "Expected upgraded_bytes to be returned"

# Parse upgraded_bytes to verify URI was changed
upgraded_top = parse_protobuf(upgraded_bytes)
upgraded_sub = parse_protobuf(upgraded_top[0][2])
upgraded_b64 = parse_protobuf(upgraded_sub[1][2])[0][2]
upgraded_chunk = parse_protobuf(base64.b64decode(upgraded_b64))

found_uri = None
for sf, sw, sv in upgraded_chunk:
    if sf == 9:
        ws_sub = parse_protobuf(sv)
        found_uri = ws_sub[0][2].decode('utf-8')
        break

assert found_uri == target_ws, f"Expected URI to be migrated to {target_ws}, got {found_uri}"

print("G4_PYTHON_ASSERTIONS_PASSED")
