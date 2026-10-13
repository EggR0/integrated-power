"""
Antigravity IDE Conversation History Auto-Sync & Recovery Tool
Integrated into Integrated POWER (Antigravity IDE Exclusive)
- Scans C:\\Users\\<user>\\.gemini\\antigravity-ide\\conversations\\*.db
- Cross-references with %APPDATA%\\Antigravity IDE\\User\\globalStorage\\state.vscdb
- Automatically indexes missing sessions into antigravityUnifiedStateSync.trajectorySummaries
- Strictly adheres to Protobuf Wire Specification
- Safely creates backups before applying changes
"""

import os
import sys
import sqlite3
import base64
import json
import shutil
import time
import re
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

USER_PROFILE = os.environ.get('USERPROFILE', os.path.expanduser('~'))
CONV_DIR = os.path.join(USER_PROFILE, r'.gemini\antigravity-ide\conversations')
BRAIN_DIR = os.path.join(USER_PROFILE, r'.gemini\antigravity-ide\brain')
STATE_VSCDB = os.path.join(USER_PROFILE, r'AppData\Roaming\Antigravity IDE\User\globalStorage\state.vscdb')

# Protobuf helpers
def encode_varint(val):
    res = bytearray()
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
    while idx < len(data):
        tag = 0; shift = 0
        while True:
            if idx >= len(data): return fields
            b = data[idx]; idx += 1; tag |= (b & 0x7f) << shift; shift += 7
            if (b & 0x80) == 0: break
        wire_type = tag & 0x07
        field_num = tag >> 3
        if wire_type == 0:
            val = 0; shift = 0
            while True:
                if idx >= len(data): return fields
                b = data[idx]; idx += 1; val |= (b & 0x7f) << shift; shift += 7
                if (b & 0x80) == 0: break
            fields.append((field_num, wire_type, val))
        elif wire_type == 2:
            length = 0; shift = 0
            while True:
                if idx >= len(data): return fields
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

def extract_session_info(cascade_id, db_path):
    info = {
        'cascade_id': cascade_id,
        'trajectory_id': cascade_id,
        'title': '대화 세션',
        'step_count': 0,
        'workspace_uri': 'file:///d:/Workspace/Integrated%20POWER',
        'mtime': int(os.path.getmtime(db_path)),
        'ctime': int(os.path.getctime(db_path)),
    }
    
    # 1. Read db
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute('SELECT trajectory_id FROM trajectory_meta LIMIT 1')
        row = c.fetchone()
        if row and row[0]:
            info['trajectory_id'] = row[0]
            
        c.execute('SELECT count(*) FROM steps')
        info['step_count'] = c.fetchone()[0]
        
        c.execute('SELECT data FROM trajectory_metadata_blob WHERE id="main"')
        row = c.fetchone()
        if row and row[0]:
            blob = row[0]
            uris = re.findall(rb'file:///[^\x00-\x1f\x22\x27\x3c\x3e\x7f-\xff]+', blob)
            if uris:
                info['workspace_uri'] = uris[0].decode('latin1', errors='ignore')
        conn.close()
    except Exception:
        pass
        
    # 2. Known overrides
    if cascade_id == 'e58fc9a2-fd0e-4435-9a26-ec310a281486':
        info['title'] = '27종 트랩 3D 모델링 및 186종 전수 검증'
        return info

    # 3. Read transcript for title if available
    transcript_path = os.path.join(BRAIN_DIR, cascade_id, r'.system_generated\logs\transcript.jsonl')
    if os.path.exists(transcript_path):
        try:
            with open(transcript_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    if '"type":"USER_INPUT"' in line:
                        d = json.loads(line)
                        content = d.get('content', '').split('<ADDITIONAL_METADATA>')[0].strip()
                        content = content.replace('\n', ' ').strip()
                        if content.startswith('<USER_REQUEST>'):
                            content = content[len('<USER_REQUEST>'):].strip()
                        if content.endswith('</USER_REQUEST>'):
                            content = content[:-len('</USER_REQUEST>')].strip()
                        if content:
                            info['title'] = content[:40]
                        break
        except Exception:
            pass
            
    return info

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
    
    # workspace URI (nested protobuf field 1 and field 2)
    uri_b = info['workspace_uri'].encode('utf-8')
    ws_payload = encode_field(1, 2, uri_b) + encode_field(2, 2, uri_b)
    chunk += encode_field(9, 2, ws_payload)
    
    chunk += encode_field(10, 2, ts_end)
    chunk += encode_field(15, 2, b'')
    chunk += encode_field(16, 0, 1)
    
    cascade_bytes = info['cascade_id'].encode('utf-8')
    b64_chunk = base64.b64encode(bytes(chunk))
    
    # True Schema:
    # MapEntry:
    #   field 1 (cascade_id)
    #   field 2:
    #     field 1 (b64_chunk)
    wrapper = encode_field(1, 2, b64_chunk)
    entry_payload = encode_field(1, 2, cascade_bytes) + encode_field(2, 2, wrapper)
    entry = encode_field(1, 2, entry_payload)
    return entry

def sync_conversations(dry_run=False, json_output=False):
    result = {
        'status': 'ok',
        'dry_run': dry_run,
        'valid_indexed': 0,
        'disk_sessions': 0,
        'missing_count': 0,
        'restored_count': 0,
        'backup_path': None,
        'error': None
    }
    
    if not os.path.exists(STATE_VSCDB):
        result['status'] = 'error'
        result['error'] = f"{STATE_VSCDB} not found"
        if json_output:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(f"Error: {STATE_VSCDB} not found!")
        return result
        
    try:
        conn = sqlite3.connect(STATE_VSCDB)
        c = conn.cursor()
        c.execute('SELECT value FROM ItemTable WHERE key=?', ('antigravityUnifiedStateSync.trajectorySummaries',))
        row = c.fetchone()
        if not row or not row[0]:
            result['status'] = 'error'
            result['error'] = "trajectorySummaries key not found in state.vscdb"
            conn.close()
            if json_output:
                print(json.dumps(result, ensure_ascii=False))
            else:
                print("Error: trajectorySummaries key not found in state.vscdb!")
            return result
            
        raw = base64.b64decode(row[0])
        top_fields = parse_protobuf(raw)
        
        indexed_uuids = set()
        valid_entries_raw = bytearray()
        
        for fnum, wtype, fval in top_fields:
            sub = parse_protobuf(fval)
            if len(sub) >= 2 and sub[0][0] == 1 and sub[1][0] == 2:
                cid = sub[0][2].decode('utf-8', errors='ignore')
                sub2 = parse_protobuf(sub[1][2])
                if len(sub2) > 0 and sub2[0][0] == 1:
                    indexed_uuids.add(cid)
                    valid_entries_raw += encode_field(fnum, wtype, fval)
                    
        result['valid_indexed'] = len(indexed_uuids)
        
        db_files = [f for f in os.listdir(CONV_DIR) if f.endswith('.db')] if os.path.exists(CONV_DIR) else []
        result['disk_sessions'] = len(db_files)
        
        missing = []
        for f in db_files:
            cid = f[:-3]
            if cid not in indexed_uuids:
                db_path = os.path.join(CONV_DIR, f)
                info = extract_session_info(cid, db_path)
                if info['step_count'] > 0:
                    missing.append(info)
                    
        result['missing_count'] = len(missing)
        
        if not missing and len(indexed_uuids) == len(top_fields):
            conn.close()
            if json_output:
                print(json.dumps(result, ensure_ascii=False))
            else:
                print("All disk conversations are already properly indexed! Nothing to do.")
            return result
            
        if dry_run:
            conn.close()
            if json_output:
                print(json.dumps(result, ensure_ascii=False))
            else:
                print(f"Dry run: {len(missing)} missing conversations found.")
            return result
            
        # Backup
        bak_path = STATE_VSCDB + f".auto_bak_{int(time.time())}"
        shutil.copy2(STATE_VSCDB, bak_path)
        result['backup_path'] = bak_path
        
        new_raw = bytearray(valid_entries_raw)
        for m in missing:
            entry = build_trajectory_entry(m)
            new_raw += entry
            
        new_b64 = base64.b64encode(bytes(new_raw)).decode('ascii')
        c.execute('UPDATE ItemTable SET value=? WHERE key=?', (new_b64, 'antigravityUnifiedStateSync.trajectorySummaries'))
        conn.commit()
        conn.close()
        
        result['restored_count'] = len(missing)
        if json_output:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(f"[SUCCESS] Successfully restored and indexed {len(missing)} missing conversations!")
        return result
    except Exception as e:
        result['status'] = 'error'
        result['error'] = str(e)
        if json_output:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(f"Sync error: {e}")
        return result

if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv
    json_out = '--json' in sys.argv
    sync_conversations(dry_run=dry_run, json_output=json_out)
