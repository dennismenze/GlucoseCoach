from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class NoLegacyJsonExchangeTest(unittest.TestCase):
    def test_page_exposes_one_csv_zip_exchange_path_without_json(self) -> None:
        index = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
        loader = (ROOT / "docs" / "app-v3.js").read_text(encoding="utf-8")
        ui = (ROOT / "docs" / "app-export-ui.js").read_text(encoding="utf-8")

        self.assertNotIn("JSON", index)
        self.assertNotIn("application/json", index)
        self.assertNotIn("export-diary", index)
        self.assertNotIn("import-diary", index)
        self.assertNotIn("import-all", index)
        self.assertIn('class="import-drop"', index)
        self.assertIn('id="csv-files"', index)
        self.assertIn('id="export-all"', index)

        self.assertIn("app-zip-core.js", loader)
        self.assertLess(loader.index("app-zip-core.js"), loader.index("app-export-ui.js"))
        self.assertIn("CSV-ZIP herunterladen", ui)
        self.assertIn("application/zip", ui)
        self.assertIn("drop", ui)
        self.assertIn("expandInputFiles", ui)
        self.assertIn("import-complete-csv-label", ui)
        self.assertIn(".remove()", ui)

    def test_obsolete_exchange_handlers_are_removed_from_browser_sources(self) -> None:
        paths = (
            "docs/app-v3-core.js",
            "docs/app-importers.js",
            "docs/app-importers-context.js",
            "docs/app-v3.js",
            "docs/app-export-ui.js",
            "docs/app-zip-core.js",
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
