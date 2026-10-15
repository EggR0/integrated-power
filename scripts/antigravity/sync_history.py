#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/antigravity/sync_history.py

Canonical forwarding wrapper pointing to vscode-extension/assets/antigravity/sync_history.py.
Preserves single-source-of-truth while keeping external launcher scripts functional.
"""

import sys
import runpy
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent.parent / "vscode-extension" / "assets" / "antigravity" / "sync_history.py"

if not TARGET.exists():
    sys.stderr.write(f"Error: Target sync script not found at {TARGET}\n")
    sys.exit(1)

# Execute the canonical script in the current process
runpy.run_path(str(TARGET), run_name="__main__")
