"""
Antigravity IDE Conversation History Auto-Sync & Recovery Tool
Integrated into Integrated POWER (Antigravity IDE Exclusive)
- Scans C:\\Users\\<user>\\.gemini\\antigravity-ide\\conversations\\*.db and brain\\*
- Cross-references with %APPDATA%\\Antigravity IDE\\User\\globalStorage\\state.vscdb
- Full Protobuf Wire Specification adherence (including Field 17 details & Field 22 status)
- Active session grace period protection against premature recovery of newly started chats
- Workspace URI migration support (e.g. C: drive -> D: drive workspace transitions)
- Automatic step_count recovery from transcript.jsonl for abnormally terminated sessions
- Automatic minimal .db stub recreation for transcript-only brain sessions
- Safe backups before applying changes
"""

import os
import sys
import sqlite3
import base64
import json
import shutil
import time
import re
import argparse
from datetime import datetime

# Ensure stdout uses utf-8
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

USER_PROFILE = os.environ.get('USERPROFILE', os.path.expanduser('~'))
CONV_DIR = os.path.join(USER_PROFILE, r'.gemini\antigravity-ide\conversations')
BRAIN_DIR = os.path.join(USER_PROFILE, r'.gemini\antigravity-ide\brain')
LEGACY_CONV_DIR = os.path.join(USER_PROFILE, r'.gemini\antigravity\conversations')
LEGACY_BRAIN_DIR = os.path.join(USER_PROFILE, r'.gemini\antigravity\brain')
STATE_VSCDB = os.path.join(USER_PROFILE, r'AppData\Roaming\Antigravity IDE\User\globalStorage\state.vscdb')

def merge_legacy_directories():
    """Merges loose conversation and brain files from legacy .gemini/antigravity paths."""
    if os.path.exists(LEGACY_CONV_DIR) and os.path.exists(CONV_DIR):
        for f in os.listdir(LEGACY_CONV_DIR):
            src_f = os.path.join(LEGACY_CONV_DIR, f)
            dst_f = os.path.join(CONV_DIR, f)
            if not os.path.exists(dst_f):
                try:
                    shutil.copy2(src_f, dst_f)
                except Exception:
                    pass
    if os.path.exists(LEGACY_BRAIN_DIR) and os.path.exists(BRAIN_DIR):
        for d in os.listdir(LEGACY_BRAIN_DIR):
            src_d = os.path.join(LEGACY_BRAIN_DIR, d)
            dst_d = os.path.join(BRAIN_DIR, d)
            if os.path.isdir(src_d) and not os.path.exists(dst_d):
                try:
                    shutil.copytree(src_d, dst_d)
                except Exception:
                    pass

DEFAULT_TARGET_WORKSPACE = 'file:///d:/Workspace/Integrated%20POWER'
LEGACY_WORKSPACE_PATTERNS = [
    'file:///c:/Users/jsp0/Documents/Intergrated%20POWER',
    'file:///c:/Users/jsp0/Documents/Intergrated POWER',
    'file:///c%3A/Users/jsp0/Documents/Intergrated%20POWER',
    'Intergrated%20POWER',
    'Intergrated POWER'
]

# --- Protobuf Helpers ---
def encode_varint(val):
    res = bytearray()
    val = int(val)
    if val < 0:
        val = (1 << 64) + val
    while val > 0x7f:
        res.append((val & 0x7f) | 0x80)
        val >>= 7
    res.append(val & 0x7f)
    return bytes(res)

def encode_field(field_num, wire_type, payload):
    tag = encode_varint((field_num << 3) | wire_type)
    if wire_type == 0:
        return tag + encode_varint(payload)
    elif wire_type == 2:
        return tag + encode_varint(len(payload)) + payload
    elif wire_type in (1, 5):
        return tag + payload
    return tag + payload

def parse_protobuf(data):
    idx = 0
    fields = []
    n = len(data)
    while idx < n:
        tag = 0; shift = 0
        while True:
            if idx >= n: return fields
            b = data[idx]; idx += 1; tag |= (b & 0x7f) << shift; shift += 7
            if (b & 0x80) == 0: break
        wire_type = tag & 0x07
        field_num = tag >> 3
        if wire_type == 0:
            val = 0; shift = 0
            while True:
                if idx >= n: return fields
                b = data[idx]; idx += 1; val |= (b & 0x7f) << shift; shift += 7
                if (b & 0x80) == 0: break
            fields.append((field_num, wire_type, val))
        elif wire_type == 2:
            length = 0; shift = 0
            while True:
                if idx >= n: return fields
                b = data[idx]; idx += 1; length |= (b & 0x7f) << shift; shift += 7
                if (b & 0x80) == 0: break
            val = data[idx:idx+length]
            idx += length
            fields.append((field_num, wire_type, val))
        elif wire_type == 1:
            val = data[idx:idx+8]; idx += 8
            fields.append((field_num, wire_type, val))
        elif wire_type == 5:
            val = data[idx:idx+4]; idx += 4
            fields.append((field_num, wire_type, val))
        else:
            break
    return fields

# --- Data Extraction & Synthesis ---
def normalize_uri(uri):
    if not uri:
        return ''
    while uri.startswith('file:///file:///'):
        uri = uri[8:]
    # Normalize %3A / %3a
    res = uri.replace('%3A', ':').replace('%3a', ':')
    return res

def should_migrate_uri(uri, target_ws):
    if not uri or not target_ws:
        return False
    norm = normalize_uri(uri)
    for p in LEGACY_WORKSPACE_PATTERNS:
        if p in norm or p in uri:
            return True
    return False

def extract_session_info(cascade_id, db_path=None, target_ws=DEFAULT_TARGET_WORKSPACE):
    info = {
        'cascade_id': cascade_id,
        'trajectory_id': cascade_id,
        'title': '대화 세션',
        'step_count': 0,
        'workspace_uri': target_ws,
        'mtime': int(time.time()),
        'ctime': int(time.time()),
        'branch': 'main',
    }

    # 1. Read SQLite DB if exists
    if db_path and os.path.exists(db_path):
        try:
            info['mtime'] = int(os.path.getmtime(db_path))
            info['ctime'] = int(os.path.getctime(db_path))
            conn = sqlite3.connect(db_path)
            c = conn.cursor()
            
            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='trajectory_meta'")
            if c.fetchone():
                c.execute('SELECT trajectory_id FROM trajectory_meta LIMIT 1')
                row = c.fetchone()
                if row and row[0]:
                    info['trajectory_id'] = str(row[0])

            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='steps'")
            if c.fetchone():
                c.execute('SELECT count(*) FROM steps')
                info['step_count'] = c.fetchone()[0]

            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='trajectory_metadata_blob'")
            if c.fetchone():
                c.execute('SELECT data FROM trajectory_metadata_blob WHERE id="main"')
                row = c.fetchone()
                if row and row[0]:
                    blob = row[0]
                    uris = re.findall(rb'file:///[^\x00-\x1f\x22\x27\x3c\x3e\x7f-\xff]+', blob)
                    if uris:
                        extracted = uris[0].decode('latin1', errors='ignore')
                        while extracted.startswith('file:///file:///'):
                            extracted = extracted[8:]
                        info['workspace_uri'] = extracted
            conn.close()
        except Exception:
            pass

    # 2. Inspect brain transcript.jsonl
    transcript_path = os.path.join(BRAIN_DIR, cascade_id, r'.system_generated\logs\transcript.jsonl')
    if os.path.exists(transcript_path):
        try:
            t_mtime = int(os.path.getmtime(transcript_path))
            t_ctime = int(os.path.getctime(transcript_path))
            if t_mtime > info['mtime']:
                info['mtime'] = t_mtime
            if t_ctime < info['ctime']:
                info['ctime'] = t_ctime

            user_step_count = 0
            found_title = None

            with open(transcript_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    if '"type":"USER_INPUT"' in line:
                        user_step_count += 1
                        if not found_title:
                            try:
                                d = json.loads(line)
                                raw_c = d.get('content', '')
                                c_clean = raw_c.split('<ADDITIONAL_METADATA>')[0].strip()
                                c_clean = c_clean.replace('\n', ' ').strip()
                                if c_clean.startswith('<USER_REQUEST>'):
                                    c_clean = c_clean[len('<USER_REQUEST>'):].strip()
                                if c_clean.endswith('</USER_REQUEST>'):
                                    c_clean = c_clean[:-len('</USER_REQUEST>')].strip()
                                # Remove markdown tags / leading symbols
                                c_clean = re.sub(r'^[#*\-`\s]+', '', c_clean).strip()
                                if c_clean and len(c_clean) > 1:
                                    found_title = c_clean[:60]
                            except Exception:
                                pass
            if found_title:
                info['title'] = found_title
            if info['step_count'] == 0 and user_step_count > 0:
                info['step_count'] = user_step_count
        except Exception:
            pass

    # 3. Known title overrides
    if cascade_id == 'e58fc9a2-fd0e-4435-9a26-ec310a281486':
        info['title'] = '27종 트랩 3D 모델링 및 186종 전수 검증'

    # 4. Clean up any doubled file:///
    while info['workspace_uri'].startswith('file:///file:///'):
        info['workspace_uri'] = info['workspace_uri'][8:]

    # 5. Migrate workspace URI if needed
    if should_migrate_uri(info['workspace_uri'], target_ws):
        info['workspace_uri'] = target_ws

    return info

def ensure_db_stub(cascade_id, info):
    """If .db file is missing but transcript exists, create a minimal valid .db stub."""
    os.makedirs(CONV_DIR, exist_ok=True)
    db_path = os.path.join(CONV_DIR, f"{cascade_id}.db")
    if not os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
            c = conn.cursor()
            c.execute("CREATE TABLE trajectory_meta (trajectory_id TEXT, cascade_id TEXT, trajectory_type INTEGER, source INTEGER)")
            c.execute("INSERT INTO trajectory_meta VALUES (?, ?, 1, 1)", (info['trajectory_id'], cascade_id))
            c.execute("CREATE TABLE steps (step_id TEXT, step_index INTEGER)")
            c.execute("CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB)")
            ws_uri = info['workspace_uri']
            while ws_uri.startswith('file:///file:///'):
                ws_uri = ws_uri[8:]
            blob_content = ws_uri.encode('utf-8')
            c.execute("INSERT INTO trajectory_metadata_blob VALUES ('main', ?)", (blob_content,))
            conn.commit()
            conn.close()
        except Exception:
            pass
    return db_path

def build_trajectory_entry(info):
    chunk = bytearray()
    title_bytes = info['title'].encode('utf-8')
    chunk += encode_field(1, 2, title_bytes)
    chunk += encode_field(2, 0, info['step_count'])
    
    # ts_end
    ts_end = encode_field(1, 0, info['mtime']) + encode_field(2, 0, 0)
    chunk += encode_field(3, 2, ts_end)
    chunk += encode_field(4, 2, info['trajectory_id'].encode('utf-8'))
    chunk += encode_field(5, 0, 1)
    
    # ts_start
    ts_start = encode_field(1, 0, info['ctime']) + encode_field(2, 0, 0)
    chunk += encode_field(7, 2, ts_start)
    
    # WorkspaceInfo
    ws_uri = info['workspace_uri']
    while ws_uri.startswith('file:///file:///'):
        ws_uri = ws_uri[8:]
    uri_b = ws_uri.encode('utf-8')
    branch_b = info.get('branch', 'main').encode('utf-8')
    ws_payload = (
        encode_field(1, 2, uri_b) +
        encode_field(2, 2, uri_b) +
        encode_field(3, 2, b'') +
        encode_field(4, 2, branch_b)
    )
    chunk += encode_field(9, 2, ws_payload)
    chunk += encode_field(10, 2, ts_end)
    chunk += encode_field(15, 2, b'')
    chunk += encode_field(16, 0, info['step_count'])
    
    # Field 17: SessionDetails
    traj_id_bytes = info['trajectory_id'].encode('utf-8')
    f17_payload = (
        encode_field(1, 2, ws_payload) +
        encode_field(2, 2, ts_start) +
        encode_field(3, 2, traj_id_bytes) +
        encode_field(7, 2, uri_b)
    )
    chunk += encode_field(17, 2, f17_payload)
    
    # Field 22: Status = 4
    chunk += encode_field(22, 0, 4)
    
    cascade_bytes = info['cascade_id'].encode('utf-8')
    b64_chunk = base64.b64encode(bytes(chunk))
    wrapper = encode_field(1, 2, b64_chunk)
    entry_payload = encode_field(1, 2, cascade_bytes) + encode_field(2, 2, wrapper)
    return encode_field(1, 2, entry_payload)

def update_existing_entry(fval, target_ws):
    """
    Checks if an existing entry needs URI migration or schema upgrade (missing Field 17/22).
    Returns (modified_entry_bytes, was_migrated).
    """
    sub = parse_protobuf(fval)
    if len(sub) < 2 or sub[0][0] != 1 or sub[1][0] != 2:
        return None, False
        
    cid = sub[0][2].decode('utf-8', errors='ignore')
    sub2 = parse_protobuf(sub[1][2])
    if not sub2 or sub2[0][0] != 1:
        return None, False
        
    try:
        b64_data = sub2[0][2]
        decoded = base64.b64decode(b64_data)
        sub3 = parse_protobuf(decoded)
    except Exception:
        return None, False

    title = '대화 세션'
    step_count = 0
    mtime = int(time.time())
    ctime = int(time.time())
    curr_uri = ''
    traj_id = cid
    has_f17 = False
    has_f22 = False

    for sf, sw, sv in sub3:
        if sf == 1 and sw == 2:
            title = sv.decode('utf-8', errors='ignore')
        elif sf == 2 and sw == 0:
            step_count = sv
        elif sf == 3 and sw == 2:
            ts = parse_protobuf(sv)
            if ts and ts[0][0] == 1: mtime = ts[0][2]
        elif sf == 4 and sw == 2:
            traj_id = sv.decode('utf-8', errors='ignore')
        elif sf == 7 and sw == 2:
            ts = parse_protobuf(sv)
            if ts and ts[0][0] == 1: ctime = ts[0][2]
        elif sf == 9 and sw == 2:
            ws = parse_protobuf(sv)
            if ws and ws[0][0] == 1:
                curr_uri = ws[0][2].decode('utf-8', errors='ignore')
        elif sf == 17:
            has_f17 = True
        elif sf == 22:
            has_f22 = True

    needs_migration = should_migrate_uri(curr_uri, target_ws) or curr_uri.startswith('file:///file:///')
    needs_upgrade = (not has_f17 or not has_f22)

    # Also improve placeholder title if transcript is available
    if title == '대화 세션':
        t_path = os.path.join(BRAIN_DIR, cid, r'.system_generated\logs\transcript.jsonl')
        if os.path.exists(t_path):
            info_temp = extract_session_info(cid, target_ws=target_ws)
            if info_temp['title'] != '대화 세션':
                title = info_temp['title']
                needs_upgrade = True

    if not needs_migration and not needs_upgrade:
        return None, False

    updated_uri = target_ws if needs_migration else curr_uri
    while updated_uri.startswith('file:///file:///'):
        updated_uri = updated_uri[8:]
    info = {
        'cascade_id': cid,
        'trajectory_id': traj_id,
        'title': title,
        'step_count': step_count,
        'workspace_uri': updated_uri,
        'mtime': mtime,
        'ctime': ctime,
        'branch': 'main'
    }
    new_entry = build_trajectory_entry(info)
    return new_entry, needs_migration

# --- Main Sync Routine ---
def sync_conversations(dry_run=False, json_output=False, force=False,
                       target_ws=DEFAULT_TARGET_WORKSPACE,
                       active_grace_period_sec=300,
                       exclude_active_cid=None):
    result = {
        'status': 'ok',
        'dry_run': dry_run,
        'valid_indexed': 0,
        'disk_sessions': 0,
        'missing_count': 0,
        'restored_count': 0,
        'migrated_count': 0,
        'skipped_active_count': 0,
        'target_workspace': target_ws,
        'backup_path': None,
        'error': None
    }

    if not os.path.exists(STATE_VSCDB):
        result['status'] = 'error'
        result['error'] = f"{STATE_VSCDB} not found"
        if json_output: print(json.dumps(result, ensure_ascii=False))
        return result

    if not dry_run:
        merge_legacy_directories()

    try:
        conn = sqlite3.connect(STATE_VSCDB)
        c = conn.cursor()
        c.execute('SELECT value FROM ItemTable WHERE key=?', ('antigravityUnifiedStateSync.trajectorySummaries',))
        row = c.fetchone()
        if not row or not row[0]:
            result['status'] = 'error'
            result['error'] = "trajectorySummaries key not found in state.vscdb"
            conn.close()
            if json_output: print(json.dumps(result, ensure_ascii=False))
            return result

        raw = base64.b64decode(row[0])
        top_fields = parse_protobuf(raw)

        indexed_uuids = set()
        new_top_raw = bytearray()
        migrated_count = 0
        upgraded_count = 0

        # Step 1: Process and potentially migrate/upgrade existing entries
        for fnum, wtype, fval in top_fields:
            sub = parse_protobuf(fval)
            if len(sub) >= 2 and sub[0][0] == 1 and sub[1][0] == 2:
                cid = sub[0][2].decode('utf-8', errors='ignore')
                indexed_uuids.add(cid)
                
                # Check for URI migration or schema upgrade
                upgraded_bytes, was_migrated = update_existing_entry(fval, target_ws)
                if upgraded_bytes:
                    new_top_raw += upgraded_bytes
                    if was_migrated:
                        migrated_count += 1
                    else:
                        upgraded_count += 1
                else:
                    new_top_raw += encode_field(fnum, wtype, fval)
            else:
                new_top_raw += encode_field(fnum, wtype, fval)

        result['valid_indexed'] = len(indexed_uuids)
        result['migrated_count'] = migrated_count

        # Step 2: Gather all available disk sessions (.db + brain-only)
        db_files = [f for f in os.listdir(CONV_DIR) if f.endswith('.db')] if os.path.exists(CONV_DIR) else []
        brain_dirs = [d for d in os.listdir(BRAIN_DIR) if os.path.isdir(os.path.join(BRAIN_DIR, d))] if os.path.exists(BRAIN_DIR) else []

        all_candidate_cids = set(f[:-3] for f in db_files)
        for bd in brain_dirs:
            t_path = os.path.join(BRAIN_DIR, bd, r'.system_generated\logs\transcript.jsonl')
            if os.path.exists(t_path):
                all_candidate_cids.add(bd)

        result['disk_sessions'] = len(all_candidate_cids)

        # Step 3: Find genuinely missing sessions
        missing = []
        skipped_active = 0
        now_ts = int(time.time())

        for cid in all_candidate_cids:
            if cid in indexed_uuids:
                continue

            # Check if this is the currently active conversation
            if exclude_active_cid and cid == exclude_active_cid:
                skipped_active += 1
                continue

            db_path = os.path.join(CONV_DIR, f"{cid}.db")
            info = extract_session_info(cid, db_path if os.path.exists(db_path) else None, target_ws=target_ws)

            # Active Grace Period:
            # If the session was modified within the last N seconds and not forced,
            # don't treat it as missing past session. The IDE is actively managing it!
            file_mtime = info['mtime']
            if not force and (now_ts - file_mtime) < active_grace_period_sec:
                skipped_active += 1
                continue

            # Must have at least 1 step or valid transcript
            if info['step_count'] > 0:
                # Ensure .db stub exists if it was brain-only
                ensure_db_stub(cid, info)
                missing.append(info)

        result['missing_count'] = len(missing)
        result['skipped_active_count'] = skipped_active

        # Step 4: If no changes needed, exit cleanly
        has_changes = (len(missing) > 0 or migrated_count > 0 or upgraded_count > 0)
        if not has_changes:
            conn.close()
            if json_output: print(json.dumps(result, ensure_ascii=False))
            else: print("All conversations are properly indexed and up to date.")
            return result

        if dry_run:
            conn.close()
            if json_output: print(json.dumps(result, ensure_ascii=False))
            else: print(f"Dry run: {len(missing)} missing, {migrated_count} migrated.")
            return result

        # Step 5: Perform Safe Backup
        bak_path = STATE_VSCDB + f".auto_bak_{int(time.time())}"
        shutil.copy2(STATE_VSCDB, bak_path)
        result['backup_path'] = bak_path

        # Step 6: Append newly restored entries
        for m in missing:
            entry = build_trajectory_entry(m)
            new_top_raw += entry

        new_b64 = base64.b64encode(bytes(new_top_raw)).decode('ascii')
        c.execute('UPDATE ItemTable SET value=? WHERE key=?', (new_b64, 'antigravityUnifiedStateSync.trajectorySummaries'))
        conn.commit()
        conn.close()

        result['restored_count'] = len(missing)
        if json_output:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(f"[SUCCESS] Restored {len(missing)} sessions, migrated {migrated_count} sessions to {target_ws}!")
        return result

    except Exception as e:
        result['status'] = 'error'
        result['error'] = str(e)
        if json_output: print(json.dumps(result, ensure_ascii=False))
        else: print(f"Sync error: {e}")
        return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Antigravity Conversation History Sync & Recovery")
    parser.add_argument('--dry-run', action='store_true', help="Inspect without modifying database")
    parser.add_argument('--json', action='store_true', help="Output result as JSON")
    parser.add_argument('--force', action='store_true', help="Force sync ignoring active session grace period")
    parser.add_argument('--target-workspace', type=str, default=DEFAULT_TARGET_WORKSPACE, help="Target workspace URI")
    parser.add_argument('--grace-period', type=int, default=300, help="Grace period in seconds for active files")
    parser.add_argument('--exclude-active', type=str, default=None, help="Explicit active conversation ID to exclude")

    args = parser.parse_args()
    sync_conversations(
        dry_run=args.dry_run,
        json_output=args.json,
        force=args.force,
        target_ws=args.target_workspace,
        active_grace_period_sec=args.grace_period,
        exclude_active_cid=args.exclude_active
    )
