from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
JS = "\n".join((ROOT / "docs" / name).read_text(encoding="utf-8") for name in ("app-core.js", "app-analysis.js", "app-render.js", "app-events.js"))
BUNDLE = HTML + "\n" + JS


class SitesV2ContractTests(unittest.TestCase):
    def test_existing_diary_storage_is_migrated_by_key_stability(self) -> None:
        self.assertIn("const DIARY_KEY = 'glucosecoach-diary-v1'", JS)
        self.assertIn("Bestehende Einträge aus der bisherigen Version", HTML)

    def test_csv_append_and_recalculation_are_present(self) -> None:
        required = [
            "glucosecoach-clinical-v1",
            "parseClinicalCsv",
            "mergeClinical",
            "dedupeCgm",
            "dedupeBoluses",
            "Eintrag speichern und neu berechnen",
            "Ausgewählte CSV lokal importieren",
            "Überlappende Zeiträume werden automatisch dedupliziert",
            "renderAll();",
        ]
        missing = [value for value in required if value not in BUNDLE]
        self.assertFalse(missing, f"missing Sites v2 contract markers: {missing}")

    def test_meal_analysis_has_explicit_methodological_boundary(self) -> None:
        required = [
            "ersten nachhaltigen Anstieg",
            "CGM-Wendepunkt-Proxy",
            "nicht als pharmakologischer Wirkeintritt",
            "Keine Diagnose, keine automatische Insulindosierung",
            "kein passender positiver Bolus gefunden",
        ]
        missing = [value for value in required if value not in BUNDLE]
        self.assertFalse(missing, f"missing analysis boundaries: {missing}")

    def test_original_verified_baseline_remains_available(self) -> None:
        for value in ["25382", "138.5", "6.62", "32.5", "82.22", "16.55"]:
            self.assertIn(value, BUNDLE)
        self.assertIn("Veröffentlichter Ausgangsstand 07.05.–04.08.2026", HTML)
        self.assertIn("nicht rechnerisch mit dem Aggregat vermischt", BUNDLE)

    def test_no_direct_identifiers_or_user_entries_are_hardcoded(self) -> None:
        forbidden = [
            "stephanmenze" + "@" + "gmx.de",
            "stephanmenze" + "@" + "icloud.com",
            "Daten - (stephanmenze",
            "Banane, Himbeeren, Haferpops, Milch",
            "Konnte nicht in Steuergerät eingegeben werden",
        ]
        leaks = [value for value in forbidden if value.lower() in BUNDLE.lower()]
        self.assertFalse(leaks, f"private source content leaked into Sites file: {leaks}")
        self.assertIsNone(re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", BUNDLE))

    def test_app_script_is_exportable_for_logic_tests(self) -> None:
        self.assertIn('<script src="app-core.js"></script>', HTML)
        self.assertIn('<script src="app-analysis.js"></script>', HTML)
        self.assertIn('<script src="app-render.js"></script>', HTML)
        self.assertIn('<script src="app-events.js"></script>', HTML)
        self.assertIn("module.exports", JS)
        self.assertIn("if (typeof document !== 'undefined') bootstrap();", JS)

    def test_node_logic_suite(self) -> None:
        subprocess.run(["node", str(ROOT / "tests" / "sites_logic_test.cjs")], check=True, capture_output=True, text=True)


if __name__ == "__main__":
    unittest.main()
