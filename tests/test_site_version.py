from __future__ import annotations

import datetime as dt
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "stamp_site_version", ROOT / "scripts" / "stamp_site_version.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class SiteVersionTest(unittest.TestCase):
    def test_version_is_deterministic_and_traceable(self) -> None:
        version = MODULE.build_version(
            "ABCDEF1234567890",
            "42",
            dt.date(2026, 8, 20),
        )
        self.assertEqual(version, "v2026.08.20.42-abcdef1")
        self.assertEqual(
            MODULE.render_version(version),
            "window.GLUCOSECOACH_VERSION = 'v2026.08.20.42-abcdef1';\n",
        )

    def test_repository_contains_visible_source_version(self) -> None:
        source = (ROOT / "docs" / "version.js").read_text(encoding="utf-8")
        self.assertRegex(
            source,
            r"^window\.GLUCOSECOACH_VERSION = 'v\d{4}\.\d{2}\.\d{2}\.\d+-[0-9a-z]+';\n$",
        )


if __name__ == "__main__":
    unittest.main()
