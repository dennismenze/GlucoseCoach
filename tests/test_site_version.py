from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "stamp_site_version.py"
SPEC = importlib.util.spec_from_file_location("stamp_site_version", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SiteVersionTest(unittest.TestCase):
    def test_generated_script_contains_visible_version_and_commit(self) -> None:
        source = MODULE.javascript(
            "2026.08.20.17",
            "abcdef1",
            "2026-08-20T10:45:00Z",
        )
        self.assertIn('version: "2026.08.20.17"', source)
        self.assertIn('commit: "abcdef1"', source)
        self.assertIn("Version ${build.version}", source)
        self.assertIn("#app-version", source)

    def test_timestamp_is_normalized_to_utc(self) -> None:
        parsed = MODULE.parse_time("2026-08-20T12:45:00+02:00")
        self.assertEqual(parsed.isoformat(), "2026-08-20T10:45:00+00:00")


if __name__ == "__main__":
    unittest.main()
