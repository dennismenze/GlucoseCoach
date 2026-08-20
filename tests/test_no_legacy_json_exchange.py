from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class NoLegacyJsonExchangeTest(unittest.TestCase):
    def test_static_page_contains_only_complete_csv_exchange_controls(self) -> None:
        index = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("JSON", index)
        self.assertNotIn("application/json", index)
        self.assertNotIn("export-diary", index)
        self.assertNotIn("import-diary", index)
        self.assertNotIn("import-all", index)
        self.assertIn("Vollständige CSV herunterladen", index)
        self.assertIn("Vollständige CSV importieren", index)
        self.assertIn('id="import-complete-csv"', index)

    def test_obsolete_exchange_handlers_are_removed_from_browser_sources(self) -> None:
        paths = (
            "docs/app-v3-core.js",
            "docs/app-importers.js",
            "docs/app-importers-context.js",
            "docs/app-v3.js",
            "docs/app-export-ui.js",
        )
        source = "\n".join(
            (ROOT / path).read_text(encoding="utf-8") for path in paths
        )
        forbidden = (
            "export-diary",
            "import-diary",
            "import-all",
            "export-all-json",
            "Tagebuch-JSON",
            "glucosecoach-tagebuch.json",
            "glucosecoach-gesamtsicherung.json",
            "GC_BACKUP_SCHEMA",
            "removeLegacyJsonControls",
            "legacy-json-control-hider",
        )
        for value in forbidden:
            with self.subTest(value=value):
                self.assertNotIn(value, source)


if __name__ == "__main__":
    unittest.main()
