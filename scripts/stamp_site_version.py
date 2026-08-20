#!/usr/bin/env python3
"""Generate the visible GlucoseCoach build identifier used by the static site."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "docs" / "site-version.js"


def git_value(*args: str) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def parse_time(value: str | None) -> datetime:
    if value:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def javascript(version: str, commit: str, built_at: str) -> str:
    values = {
        "version": version,
        "commit": commit,
        "builtAt": built_at,
    }
    encoded = {key: json.dumps(value, ensure_ascii=False) for key, value in values.items()}
    return f"""(function (root) {{
  'use strict';

  const build = Object.freeze({{
    version: {encoded['version']},
    commit: {encoded['commit']},
    builtAt: {encoded['builtAt']},
  }});
  root.GlucoseCoachBuild = build;

  function renderVersion() {{
    const target = document.querySelector('#app-version');
    if (!target) return;
    const commit = build.commit ? ` · ${{build.commit}}` : '';
    target.textContent = `Version ${{build.version}}${{commit}}`;
    target.title = build.builtAt ? `Erzeugt: ${{build.builtAt}}` : '';
  }}

  function ensureStyles() {{
    if (document.querySelector('#site-version-styles')) return;
    const style = document.createElement('style');
    style.id = 'site-version-styles';
    style.textContent = `
      .header-meta {{ display:flex; flex-direction:column; align-items:flex-end; gap:8px; }}
      .version-badge {{ font-size:.78rem; font-weight:600; opacity:.82; white-space:nowrap; }}
      @media (max-width:720px) {{ .header-meta {{ align-items:flex-start; }} }}
    `;
    document.head.appendChild(style);
  }}

  if (typeof document !== 'undefined') {{
    ensureStyles();
    if (document.readyState === 'loading') {{
      document.addEventListener('DOMContentLoaded', renderVersion, {{ once: true }});
    }} else renderVersion();
  }}
}})(typeof globalThis !== 'undefined' ? globalThis : this);
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-number", default=os.getenv("GITHUB_RUN_NUMBER", "0"))
    parser.add_argument("--sha", default=os.getenv("GITHUB_SHA") or git_value("rev-parse", "HEAD") or "development")
    parser.add_argument("--built-at", default=os.getenv("GLUCOSECOACH_BUILT_AT"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    built = parse_time(args.built_at)
    run_number = str(args.run_number or "0").strip() or "0"
    short_sha = str(args.sha or "development").strip()[:7]
    version = f"{built:%Y.%m.%d}.{run_number}"
    content = javascript(version, short_sha, built.isoformat().replace("+00:00", "Z"))

    if args.check:
        if not TARGET.is_file() or TARGET.read_text(encoding="utf-8") != content:
            raise SystemExit(f"Visible version file is not current: {TARGET}")
        return

    TARGET.write_text(content, encoding="utf-8")
    print(f"Stamped visible site version {version} ({short_sha})")


if __name__ == "__main__":
    main()
