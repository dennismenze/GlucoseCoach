#!/usr/bin/env python3
"""Generate the visible GlucoseCoach build version used by the static site."""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "docs" / "version.js"


def build_version(sha: str, run_number: str, build_date: dt.date | None = None) -> str:
    clean_sha = re.sub(r"[^0-9a-fA-F]", "", sha or "")[:7].lower() or "local"
    clean_run = re.sub(r"[^0-9]", "", str(run_number or "")) or "0"
    day = build_date or dt.datetime.now(dt.timezone.utc).date()
    return f"v{day:%Y.%m.%d}.{clean_run}-{clean_sha}"


def render_version(version: str) -> str:
    if not re.fullmatch(r"v\d{4}\.\d{2}\.\d{2}\.\d+-[0-9a-z]+", version):
        raise ValueError(f"Ungültige Versionsnummer: {version}")
    return f"window.GLUCOSECOACH_VERSION = '{version}';\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", default=os.environ.get("GITHUB_SHA", ""))
    parser.add_argument("--run-number", default=os.environ.get("GITHUB_RUN_NUMBER", "0"))
    parser.add_argument("--date", help="UTC-Datum im Format YYYY-MM-DD")
    parser.add_argument("--output", type=Path, default=VERSION_FILE)
    args = parser.parse_args()

    build_date = dt.date.fromisoformat(args.date) if args.date else None
    version = build_version(args.sha, args.run_number, build_date)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render_version(version), encoding="utf-8")
    print(version)


if __name__ == "__main__":
    main()
