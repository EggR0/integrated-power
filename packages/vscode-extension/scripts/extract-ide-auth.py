import sqlite3
import base64
import re
import json
import os

EMAIL_RE = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}')
ACCESS_TOKEN_RE = re.compile(r'ya29\.[A-Za-z0-9_\-]+')
REFRESH_TOKEN_RE = re.compile(r'1//[A-Za-z0-9_\-]+')
B64_FULL_RE = re.compile(rb'^[A-Za-z0-9+/_=-]+$')


def parse_proto_fields(buf):
    pos = 0
    n = len(buf)
    fields = []
    while pos < n:
        tag = 0
        shift = 0
        while pos < n:
            b = buf[pos]
            pos += 1
            tag |= (b & 0x7F) << shift
            if not (b & 0x80):
                break
            shift += 7
            if shift > 64:
                return None
        else:
            return None

        field_num = tag >> 3
        wire_type = tag & 0x7
        if field_num == 0:
            return None

        if wire_type == 0:
            val = 0
            shift = 0
            while pos < n:
                b = buf[pos]
                pos += 1
                val |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
                if shift > 64:
                    return None
            else:
                return None
            fields.append((field_num, wire_type, val))
        elif wire_type == 1:
            if pos + 8 > n:
                return None
            fields.append((field_num, wire_type, buf[pos:pos + 8]))
            pos += 8
        elif wire_type == 2:
            length = 0
            shift = 0
            while pos < n:
                b = buf[pos]
                pos += 1
                length |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
                if shift > 35:
                    return None
            else:
                return None
            if pos + length > n:
                return None
            fields.append((field_num, wire_type, buf[pos:pos + length]))
            pos += length
        elif wire_type == 5:
            if pos + 4 > n:
                return None
            fields.append((field_num, wire_type, buf[pos:pos + 4]))
            pos += 4
        else:
            return None

    return fields if fields else None


def try_decode_base64(data_bytes):
    s = data_bytes.strip()
    if len(s) < 8 or not B64_FULL_RE.match(s):
        return None
    try:
        padded = s + b'=' * (-len(s) % 4)
        if b'-' in s or b'_' in s:
            decoded = base64.urlsafe_b64decode(padded)
        else:
            decoded = base64.b64decode(padded)
        return decoded if decoded else None
    except Exception:
        return None


def collect_decoded_texts(raw_value, max_depth=6):
    if not raw_value:
        return []
    raw_bytes = raw_value.encode('utf-8', errors='ignore') if isinstance(raw_value, str) else bytes(raw_value)
    collected = []
    seen = set()

    def walk(buf, depth):
        if not buf or depth > max_depth or buf in seen:
            return
        seen.add(buf)
        collected.append(buf.decode('utf-8', errors='ignore'))

        fields = parse_proto_fields(buf)
        if fields:
            for _, wire_type, val in fields:
                if wire_type == 2 and isinstance(val, bytes):
                    walk(val, depth + 1)
            return

        dec = try_decode_base64(buf)
        if dec and dec != buf:
            walk(dec, depth + 1)
            return

        # Fallback for embedded base64 chunks inside plain text
        for match in re.findall(rb'[A-Za-z0-9+/=]{16,}', buf):
            sub_dec = try_decode_base64(match)
            if sub_dec:
                walk(sub_dec, depth + 1)

    walk(raw_bytes, 0)
    return collected


def extract_email_from_value(raw_value):
    for text in collect_decoded_texts(raw_value):
        for email in EMAIL_RE.findall(text):
            return email
    return None


def extract_agy2_email(app_storage_path=None):
    path = app_storage_path or os.path.expandvars(r'%APPDATA%\Antigravity\app_storage.json')
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return None
        for key in ('agy.onboarding.lastLoginUsername', 'jetski.onboarding.lastLoginUsername'):
            val = data.get(key)
            if isinstance(val, str):
                candidate = val.strip().strip('"').strip("'")
                m = EMAIL_RE.search(candidate)
                if m:
                    return m.group(0)
    except Exception:
        pass
    return None


def extract_auth(ide_db_path=None, app_storage_path=None):
    db = ide_db_path or os.path.expandvars(r'%APPDATA%\Antigravity IDE\User\globalStorage\state.vscdb')
    agy2_email = extract_agy2_email(app_storage_path)

    email = None
    access_token = None
    refresh_token = None

    if db and os.path.exists(db):
        con = None
        try:
            try:
                con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
            except Exception:
                con = sqlite3.connect(db)
            cur = con.cursor()

            # 1. userStatus -> extract email via protobuf + recursive base64 parser
            cur.execute("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.userStatus'")
            r = cur.fetchone()
            if r and r[0]:
                email = extract_email_from_value(r[0])

            # 1b. Onboarding username fallback in state.vscdb
            if not email:
                for key in ('jetski.onboarding.lastLoginUsername', 'agy.onboarding.lastLoginUsername'):
                    cur.execute("SELECT value FROM ItemTable WHERE key = ?", (key,))
                    r = cur.fetchone()
                    if r and r[0]:
                        val = r[0].decode('utf-8', errors='ignore') if isinstance(r[0], bytes) else str(r[0])
                        m = EMAIL_RE.search(val.strip().strip('"').strip("'"))
                        if m:
                            email = m.group(0)
                            break

            # 2. oauthToken -> extract access_token and refresh_token
            cur.execute("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'")
            r = cur.fetchone()
            if r and r[0]:
                for text in collect_decoded_texts(r[0]):
                    if not access_token:
                        toks = ACCESS_TOKEN_RE.findall(text)
                        if toks:
                            access_token = toks[0]
                    if not refresh_token:
                        rfs = REFRESH_TOKEN_RE.findall(text)
                        if rfs:
                            refresh_token = rfs[0]
                    if access_token and refresh_token:
                        break
        except Exception:
            pass
        finally:
            if con is not None:
                try:
                    con.close()
                except Exception:
                    pass

    if email or agy2_email:
        return {
            'email': email,
            'access_token': access_token,
            'refresh_token': refresh_token,
            'source': 'antigravity-ide-db' if email else None,
            'agy2_email': agy2_email,
            'agy2_source': 'antigravity-app-storage' if agy2_email else None,
        }

    return None


if __name__ == '__main__':
    auth = extract_auth()
    if auth:
        print(json.dumps(auth))
