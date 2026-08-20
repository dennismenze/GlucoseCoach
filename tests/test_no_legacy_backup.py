from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
PRODUCTION_FILES = (
    DOCS / "index.html",
    DOCS / "app-v3.js",
    DOCS / "app-v3-core.js",
    DOCS / "app-importers.js",
    DOCS / "app-importers-context.js",
    DOCS / "app-export-core.js",
    DOCS / "app-export-ui.js",
)

LEGACY_BACKUP_TOKENS = (
    "glucosecoach-backup",
    "GC_BACKUP_SCHEMA",
    "gcDownload(",
    "export-diary",
    "import-diary",
    "import-all",
    "export-all-json",
    "legacy-json-control-hider",
    "Tagebuch-JSON",
    "Gesamtsicherung exportieren",
    "Gesamtsicherung importieren",
    "Ungültige Gesamtsicherung",
    "Rohdaten_JSON",
    "Zeitstempel_lokal",
    "buildBackupPayload",
)


class NoLegacyBackupTest(unittest.TestCase):
    def test_production_source_contains_no_legacy_json_backup_path(self) -> None:
        occurrences: list[str] = []
        for path in PRODUCTION_FILES:
            source = path.read_text(encoding="utf-8")
            for token in LEGACY_BACKUP_TOKENS:
                if token in source:
                    occurrences.append(f"{path.relative_to(ROOT)}: {token}")
        self.assertEqual(occurrences, [], "Legacy backup source returned")

    def test_static_page_exposes_one_csv_exchange_path_and_one_version_source(self) -> None:
        index = (DOCS / "index.html").read_text(encoding="utf-8")
        loader = (DOCS / "app-v3.js").read_text(encoding="utf-8")
        self.assertEqual(index.count('id="export-all"'), 1)
        self.assertEqual(index.count('id="import-complete-csv"'), 1)
        self.assertEqual(index.count('src="version.js"'), 1)
        self.assertEqual(index.count('src="app-v3.js"'), 1)
        self.assertEqual(index.count('id="app-version"'), 1)
        self.assertNotIn("version.js", loader)
        self.assertNotIn("JSON", index)
        self.assertIn("Vollständige CSV herunterladen", index)
        self.assertIn("Vollständige CSV importieren", index)


if __name__ == "__main__":
    unittest.main()
