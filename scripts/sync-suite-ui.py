#!/usr/bin/env python3
"""Synchronize the canonical Celluloid Science Apps UI runtime.

Run from the DuckBio-site checkout with the six app repositories
checked out as sibling directories.

  python scripts/sync-suite-ui.py --check
  python scripts/sync-suite-ui.py --write

The app copies are vendored/generated release assets. They remain local at
runtime so one DuckBio app never depends on another app or on the
website being available.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "suite-ui.js"
TARGETS = {
    "DuckMan": ROOT.parent / "DuckMan" / "suite-ui.js",
    "EEL": ROOT.parent / "EEL" / "public" / "suite-ui.js",
    "LIMSMan": ROOT.parent / "LIMSMan" / "suite-ui.js",
    "MethPipe": ROOT.parent / "MethPipe" / "suite-ui.js",
    "GoFlo": ROOT.parent / "GoFlo" / "public" / "suite-ui.js",
    "ManTrain": ROOT.parent / "ManTrain" / "suite-ui.js",
}

def canonical_bytes() -> bytes:
    raw = CANONICAL.read_bytes()
    text = raw.decode("utf-8")
    match = re.search(r"const VERSION=['\"]([^'\"]+)['\"];", text)
    if not match or not match.group(1).strip():
        raise SystemExit("Canonical suite-ui.js needs a non-empty VERSION.")
    required = [
        "CelluloidSuiteUI",
        "cc-suite-theme",
        "HEADER_ORDER",
        "MENU_ORDER",
    ]
    missing = [token for token in required if token not in text]
    if missing:
        raise SystemExit(f"Canonical suite-ui.js is missing required contract tokens: {missing}")
    return raw

def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="fail if an app copy differs")
    mode.add_argument("--write", action="store_true", help="copy canonical bytes to all apps")
    args = parser.parse_args()

    raw = canonical_bytes()
    drift: list[str] = []
    for app, target in TARGETS.items():
        if not target.parent.exists():
            drift.append(f"{app}: sibling checkout missing at {target.parent}")
            continue
        if args.write:
            target.write_bytes(raw)
            print(f"updated {app}: {target}")
        elif not target.exists() or target.read_bytes() != raw:
            drift.append(f"{app}: {target}")

    if drift:
        print("Suite UI drift detected:", file=sys.stderr)
        for item in drift:
            print(f"  - {item}", file=sys.stderr)
        return 1
    if args.check:
        print("All app suite-ui.js copies match the canonical source.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
