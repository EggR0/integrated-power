import argparse
import datetime as _dt
import json
import os
import pickle
from pathlib import Path


def _strip_cache_suffix(cache_key: str):
    for suffix, include_body in (("-False", False), ("-True", True)):
        if cache_key.endswith(suffix):
            return cache_key[: -len(suffix)], include_body
    return cache_key, None


def _range(symbol):
    value = symbol.get("range") or {}
    start = value.get("start") or {}
    end = value.get("end") or {}
    return {
        "startLine": start.get("line"),
        "startCharacter": start.get("character"),
        "endLine": end.get("line"),
        "endCharacter": end.get("character"),
    }


def _symbol_record(symbol, depth=0, max_depth=3):
    record = {
        "name": symbol.get("name"),
        "kind": symbol.get("kind"),
        "detail": symbol.get("detail") or "",
        "range": _range(symbol),
    }
    children = symbol.get("children") or []
    if children and depth < max_depth:
        record["children"] = [
            _symbol_record(child, depth + 1, max_depth) for child in children
        ]
    return record


def _read_cache_file(path: Path):
    with path.open("rb") as handle:
        data = pickle.load(handle)
    if not isinstance(data, dict):
        return []

    by_file = {}
    for key, value in data.items():
        relative_path, include_body = _strip_cache_suffix(str(key))
        if include_body is True:
            continue
        if not isinstance(value, tuple) or len(value) != 2:
            continue

        content_hash, payload = value
        top_level_symbols = []
        all_symbols_count = 0
        if isinstance(payload, tuple) and len(payload) >= 2:
            all_symbols = payload[0] if isinstance(payload[0], list) else []
            roots = payload[1] if isinstance(payload[1], list) else []
            all_symbols_count = len(all_symbols)
            top_level_symbols = roots
        elif isinstance(payload, list):
            top_level_symbols = [
                item for item in payload if isinstance(item, dict) and not item.get("parent")
            ]
            all_symbols_count = len(payload)

        by_file[relative_path] = {
            "path": relative_path.replace("\\", "/"),
            "contentHash": content_hash,
            "symbolCount": all_symbols_count,
            "topLevelSymbolCount": len(top_level_symbols),
            "topLevelSymbols": [
                _symbol_record(symbol)
                for symbol in top_level_symbols
                if isinstance(symbol, dict)
            ],
        }

    return sorted(by_file.values(), key=lambda item: item["path"].lower())


def export_symbols(repo_root: Path):
    cache_dir = repo_root / ".serena" / "cache"
    cache_files = sorted(cache_dir.rglob("*.pkl")) if cache_dir.exists() else []
    files = []
    errors = []

    for cache_file in cache_files:
        try:
            files.extend(_read_cache_file(cache_file))
        except Exception as exc:
            errors.append({"cacheFile": str(cache_file), "error": str(exc)})

    return {
        "generatedAt": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "repoRoot": str(repo_root),
        "cacheRoot": str(cache_dir),
        "cacheFiles": [str(path.relative_to(repo_root)) for path in cache_files],
        "fileCount": len(files),
        "symbolCount": sum(item.get("symbolCount", 0) for item in files),
        "files": files,
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Export Serena LSP symbol cache into deterministic JSON."
    )
    parser.add_argument("repo_root", nargs="?", default=os.getcwd())
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    result = export_symbols(repo_root)
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)


if __name__ == "__main__":
    main()
