#!/usr/bin/env python3
"""Package generated de-identified data and write a reproducibility manifest."""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PART_CHARS = 12_000


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def digest_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="Extracted original CSV directory")
    parser.add_argument("--data", type=Path, default=Path("data"), help="Generated data directory")
    args = parser.parse_args()

    summary = read_json(args.data / "summary.json")
    clinical = read_json(args.data / "clinical-events.json")
    months: dict[str, Any] = {}
    for path in sorted(args.data.glob("cgm-*.json")):
        payload = read_json(path)
        months[payload["month"]] = payload

    package = {
        "schemaVersion": 1,
        "description": "De-identified exact measurements derived from the supplied Omnipod export",
        "summary": summary,
        "clinicalEvents": clinical,
        "cgmByMonth": months,
    }
    package_json = json.dumps(package, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    compressed = gzip.compress(package_json, compresslevel=9, mtime=0)
    package_path = args.data / "full-export.deidentified.json.gz"
    package_path.write_bytes(compressed)

    for old_part in args.data.glob("full-export.part*.b64"):
        old_part.unlink()
    encoded = base64.b64encode(compressed).decode("ascii")
    parts = []
    for index, offset in enumerate(range(0, len(encoded), PART_CHARS), start=1):
        content = encoded[offset:offset + PART_CHARS]
        name = f"full-export.part{index:02d}.b64"
        path = args.data / name
        path.write_text(content + "\n", encoding="ascii")
        parts.append({"path": f"data/{name}", "characters": len(content)})

    package_manifest = {
        "schemaVersion": 1,
        "encoding": "base64",
        "compression": "gzip",
        "parts": parts,
        "compressedBytes": len(compressed),
        "compressedSha256": digest_bytes(compressed),
        "uncompressedBytes": len(package_json),
        "uncompressedSha256": digest_bytes(package_json),
    }
    manifest_path = args.data / "package-manifest.json"
    manifest_path.write_text(json.dumps(package_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    source_files = []
    for path in sorted(args.source.rglob("*.csv")):
        source_files.append(
            {
                "path": str(path.relative_to(args.source)),
                "bytes": path.stat().st_size,
                "sha256": digest(path),
            }
        )

    provenance = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "input": {
            "kind": "Omnipod CSV export attached to private email",
            "files": source_files,
            "rawFilesCommitted": False,
        },
        "output": {
            "summary": {
                "location": "embedded as fullDataset.summary",
                "generatedIntermediate": "data/summary.json",
                "committedSeparately": False,
                "bytes": (args.data / "summary.json").stat().st_size,
                "sha256": digest(args.data / "summary.json"),
            },
            "fullDataset": {
                "manifest": "data/package-manifest.json",
                "parts": [part["path"] for part in parts],
                "compressedBytes": len(compressed),
                "compressedSha256": digest_bytes(compressed),
                "compression": "gzip",
                "transportEncoding": "base64 parts",
            },
        },
        "privacy": {
            "deidentified": True,
            "removed": ["full name", "email addresses", "device serial number", "mail headers"],
            "warning": "Derived dates, glucose, insulin and meal-event values remain sensitive health data.",
        },
        "processing": {
            "script": "scripts/build_dataset.py",
            "sentinels": "1 and 2001 retained as LOW/HIGH classifications but excluded from numeric mean, GMI and CV",
            "timezone": "Europe/Berlin",
        },
    }
    (args.data / "provenance.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {package_path} ({len(compressed)} bytes)")
    print(f"Wrote {manifest_path} with {len(parts)} text parts")
    print(f"Wrote {args.data / 'provenance.json'}")


if __name__ == "__main__":
    main()
