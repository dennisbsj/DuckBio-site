#!/usr/bin/env python3
"""Synchronize the canonical Celluloid Science Apps permission policy.

Run from the DuckBio-site checkout with the six app repositories
checked out as sibling directories.

  python scripts/sync-suite-permissions.py --check
  python scripts/sync-suite-permissions.py --write

The generated app copies must not be edited by hand.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "suite-permissions.json"
TARGETS = {
    "DuckMan": ROOT.parent / "DuckMan" / "suite-permissions.json",
    "EEL": ROOT.parent / "EEL" / "suite-permissions.json",
    "LIMSMan": ROOT.parent / "LIMSMan" / "suite-permissions.json",
    "MethPipe": ROOT.parent / "MethPipe" / "suite-permissions.json",
    "GoFlo": ROOT.parent / "GoFlo" / "suite-permissions.json",
    "ManTrain": ROOT.parent / "ManTrain" / "suite-permissions.json",
}
EXPECTED_APPS = set(TARGETS)


def canonical_bytes() -> bytes:
    raw = CANONICAL.read_bytes()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Canonical permissions JSON is invalid: {exc}") from exc
    if data.get("suite") != "Celluloid Science Apps":
        raise SystemExit("Canonical suite name must be 'Celluloid Science Apps'.")
    version = data.get("policyVersion")
    if not isinstance(version, str) or not version.strip():
        raise SystemExit("Canonical permission policy needs a non-empty policyVersion.")
    apps = set((data.get("apps") or {}).keys())
    if apps != EXPECTED_APPS:
        raise SystemExit(f"Canonical app set mismatch: {sorted(apps)}")
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
        print("Suite permission policy drift detected:", file=sys.stderr)
        for item in drift:
            print(f"  - {item}", file=sys.stderr)
        return 1
    if args.check:
        print("All app permission-policy copies match the canonical source.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
