#!/usr/bin/env python3
"""Fail-closed validation for the source pipeline and optional generated package."""
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_FILES = (
    "requirements.txt",
    "scripts/build_dataset.py",
    "scripts/dataset_processing.py",
    "scripts/package_release.py",
    "scripts/validate_project.py",
    "tests/test_pipeline.py",
)
RAW_SUFFIXES = {".csv", ".eml", ".zip"}
TEXT_SUFFIXES = {".html", ".css", ".js", ".json", ".md", ".py", ".txt", ".yml", ".yaml"}
EMAIL_PATTERN = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
DEVICE_PATTERN = re.compile(r"\b\d{8}-\d{9}\b")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def validate_source_tree() -> None:
    for relative in PIPELINE_FILES:
        require((ROOT / relative).is_file(), f"Missing pipeline file: {relative}")

    for path in ROOT.rglob("*"):
        if not path.is_file() or ".git" in path.parts:
            continue
        relative = path.relative_to(ROOT)
        require(path.suffix.lower() not in RAW_SUFFIXES, f"Raw export must not be committed: {relative}")
        if path.suffix.lower() in TEXT_SUFFIXES:
            text = path.read_text(encoding="utf-8", errors="ignore")
            require(not EMAIL_PATTERN.search(text), f"Potential email address in {relative}")
            require(not DEVICE_PATTERN.search(text), f"Potential device identifier in {relative}")


def validate_generated_package() -> bool:
    manifest_path = ROOT / "data/package-manifest.json"
    if not manifest_path.exists():
        return False

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    encoded_parts: list[str] = []
    for part in manifest.get("parts", []):
        relative = part.get("path")
        require(isinstance(relative, str) and relative.startswith("data/full-export.part"), "Invalid package part path")
        path = ROOT / relative
        require(path.is_file(), f"Missing package part: {relative}")
        encoded_parts.append(path.read_text(encoding="ascii").strip())

    require(encoded_parts, "Package manifest contains no parts")
    compressed = base64.b64decode("".join(encoded_parts), validate=True)
    require(len(compressed) == manifest["compressedBytes"], "Compressed package size mismatch")
    require(sha256(compressed) == manifest["compressedSha256"], "Compressed package hash mismatch")
    uncompressed = gzip.decompress(compressed)
    require(len(uncompressed) == manifest["uncompressedBytes"], "Uncompressed package size mismatch")
    require(sha256(uncompressed) == manifest["uncompressedSha256"], "Uncompressed package hash mismatch")

    full: dict[str, Any] = json.loads(uncompressed)
    summary = full["summary"]
    require(summary["profile"]["realMeasurements"] is True, "Dataset is not marked as real measurements")
    require(summary["profile"]["deidentified"] is True, "Dataset is not marked as de-identified")
    samples = summary["overall"]["samples"]
    cgm_count = sum(len(payload["readings"]) for payload in full["cgmByMonth"].values())
    require(cgm_count == samples, "Full package CGM count mismatch")
    shares = sum(summary["overall"][key] for key in ("veryLow", "low", "inRange", "high", "veryHigh"))
    require(abs(shares - 100) < 0.05, "Range percentages do not sum to 100")
    require(
        len(full["clinicalEvents"]["boluses"]) == summary["sourceCoverage"]["bolusEvents"],
        "Bolus count mismatch",
    )
    return True


def main() -> None:
    validate_source_tree()
    package_present = validate_generated_package()
    state = "source and generated package" if package_present else "source pipeline"
    print(f"Project validation passed ({state})")


if __name__ == "__main__":
    main()
