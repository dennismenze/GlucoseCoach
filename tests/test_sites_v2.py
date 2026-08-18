from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
LOADER = (ROOT / "docs" / "app-v3.js").read_text(encoding="utf-8")
CORE = (ROOT / "docs" / "app-v3-core.js").read_text(encoding="utf-8")
IMPORTERS = (ROOT / "docs" / "app-importers.js").read_text(encoding="utf-8")
CONTEXT_IMPORTERS = (ROOT / "docs" / "app-importers-context.js").read_text(encoding="utf-8")
BUNDLE = "\n".join((HTML, LOADER, CORE, IMPORTERS, CONTEXT_IMPORTERS))


class PersonalSitesContractTests(unittest.TestCase):
    def test_new_browser_has_no_published_patient_baseline(self) -> None:
        forbidden = [
            "25.382", "25382", "138.5", "6.62", "82.22", "16.55",
            "Veröffentlichter Ausgangsstand", "07.05.–04.08.2026",
            "202 mg/dl", "95 Minuten", "STATIC_BASELINE",
        ]
        leaks = [value for value in forbidden if value in BUNDLE]
        self.assertFalse(leaks, f"published patient baseline leaked into public site: {leaks}")

    def test_storage_is_personal_and_browser_local(self) -> None:
        required = [
            "glucosecoach-profile-v1",
            "glucosecoach-diary-v1",
            "glucosecoach-clinical-v1",
            "Ein neuer Browser startet ohne Gesundheitsdaten",
            "Noch keine persönlichen CGM-Daten",
            "Es werden keine Beispielwerte oder Daten anderer Nutzer eingeblendet",
            "localStorage",
        ]
        missing = [value for value in required if value not in BUNDLE]
        self.assertFalse(missing, f"missing personal-local markers: {missing}")

    def test_complete_omnipod_export_set_is_supported(self) -> None:
        required = [
            "cgm_data_*.csv",
            "bolus_data_*.csv",
            "insulin_data_*.csv",
            "basal_data_*.csv",
            "bg_data_*.csv",
            "alarms_data_*.csv",
            "cgm_carbs_data_",
            "exercise_data_",
            "food_data_",
            "manual_insulin_data_",
            "medication_data_",
            "notes_data_",
            "dailyInsulin",
            "basalEvents",
            "manualGlucose",
            "cgmCarbs",
            "exerciseEvents",
            "foodEvents",
            "manualInsulin",
            "medications",
            "notes",
        ]
        missing = [value for value in required if value not in BUNDLE]
        self.assertFalse(missing, f"missing complete Omnipod importer markers: {missing}")

    def test_csv_append_and_recalculation_are_present(self) -> None:
        required = [
            "parseClinicalCsv",
            "mergeClinical",
            "dedupeCgm",
            "dedupeBoluses",
            "Eintrag speichern und neu berechnen",
            "Ausgewählte CSV lokal importieren",
            "gcRender()",
        ]
        missing = [value for value in required if value not in BUNDLE]
        self.assertFalse(missing, f"missing recalculation markers: {missing}")

    def test_meal_analysis_keeps_methodological_boundary(self) -> None:
        required = [
            "erster nachhaltiger Anstieg",
            "CGM-Wendepunkt-Proxy",
            "kein direkter pharmakologischer Wirkeintritt",
            "Keine Diagnose, keine automatische Insulindosierung",
            "kein passender positiver Bolus gefunden",
        ]
        missing = [value for value in required if value not in BUNDLE]
        self.assertFalse(missing, f"missing analysis boundaries: {missing}")

    def test_no_direct_identifier_or_email_is_hardcoded(self) -> None:
        self.assertIsNone(re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", BUNDLE))

    def test_loader_keeps_personal_bundle_modular(self) -> None:
        self.assertIn('<script src="app-v3.js"></script>', HTML)
        self.assertIn("app-v3-core.js", LOADER)
        self.assertIn("app-importers.js", LOADER)
        self.assertIn("app-importers-context.js", LOADER)
        for legacy in ("app-core.js", "app-analysis.js", "app-render.js", "app-events.js"):
            self.assertNotIn(f'<script src="{legacy}"></script>', HTML)
        self.assertIn("module.exports", CORE)
        self.assertIn("module.exports", IMPORTERS)
        self.assertIn("module.exports", CONTEXT_IMPORTERS)

    def test_node_logic_suite(self) -> None:
        subprocess.run(
            ["node", str(ROOT / "tests" / "sites_logic_test.cjs")],
            check=True,
            capture_output=True,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
