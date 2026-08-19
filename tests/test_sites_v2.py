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
UI_CONTRACT = (ROOT / "docs" / "app-ui-contract.js").read_text(encoding="utf-8")
MEAL_WINDOW = (ROOT / "docs" / "app-meal-window.js").read_text(encoding="utf-8")
INSULIN_ACTION = (ROOT / "docs" / "app-insulin-action.js").read_text(encoding="utf-8")
BUNDLE = "\n".join(
    (
        HTML,
        LOADER,
        CORE,
        IMPORTERS,
        CONTEXT_IMPORTERS,
        UI_CONTRACT,
        MEAL_WINDOW,
        INSULIN_ACTION,
    )
)


class PersonalSitesContractTests(unittest.TestCase):
    def test_new_browser_has_no_published_patient_baseline(self) -> None:
        forbidden = [
            "25.382",
            "25382",
            "138.5",
            "6.62",
            "82.22",
            "16.55",
            "Veröffentlichter Ausgangsstand",
            "07.05.–04.08.2026",
            "202 mg/dl",
            "95 Minuten",
            "STATIC_BASELINE",
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
            "SUPPORTED_OMNIPOD_TYPE_COUNT = 12",
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
            "höchste CGM-Wert in den ersten 120 Minuten",
            "kein Nachweis eines Insulin-Wirkbeginns",
            "GC_POSTPRANDIAL_PEAK_MINUTES",
            "GC_DECLINE_CONFIRMATION_MINUTES",
            "GC_DECLINE_DROP_MGDL",
        ]
        missing = [value for value in required if value not in BUNDLE]
        self.assertFalse(missing, f"missing meal-analysis boundaries: {missing}")

    def test_insulin_action_analysis_is_bounded_and_personal(self) -> None:
        required = [
            'data-panel="insulin-action"',
            'id="insulin-action"',
            "Geschätzte effektive Glukosesenkungswirkung",
            "streng isolierte Korrekturereignisse",
            "Aus Mahlzeitenboli wird keine pharmakodynamische Wirkzeit abgeleitet",
            "GC_INSULIN_ACTION_WINDOW_MINUTES",
            "ACTION_WINDOW_MINUTES = 300",
            "MIN_CGM_COVERAGE = 0.80",
            "END_REMAINING_FRACTION = 0.10",
            "analyzeInsulinAction",
            "effectOnset",
            "maximumDropRate",
            "stablePhase",
            "positiveAuc",
            "keine Empfehlung zur Änderung von Pumpenparametern",
            "Die Pumpeneinstellung von 2 Stunden wird für diese Schätzung nicht verwendet",
        ]
        missing = [value for value in required if value not in BUNDLE]
        self.assertFalse(missing, f"missing insulin-action contract: {missing}")

    def test_no_direct_identifier_or_email_is_hardcoded(self) -> None:
        self.assertIsNone(re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", BUNDLE))

    def test_loader_keeps_personal_bundle_modular(self) -> None:
        self.assertIn('<script src="app-v3.js"></script>', HTML)
        modules = (
            "app-v3-core.js",
            "app-importers.js",
            "app-importers-context.js",
            "app-ui-contract.js",
            "app-meal-window.js",
            "app-insulin-action.js",
        )
        for module in modules:
            self.assertIn(module, LOADER)
        for legacy in ("app-core.js", "app-analysis.js", "app-render.js", "app-events.js"):
            self.assertNotIn(f'<script src="{legacy}"></script>', HTML)
        for source in (
            CORE,
            IMPORTERS,
            CONTEXT_IMPORTERS,
            UI_CONTRACT,
            MEAL_WINDOW,
            INSULIN_ACTION,
        ):
            self.assertIn("module.exports", source)

    def test_e2e_contract_is_present(self) -> None:
        paths = (
            ROOT / "e2e" / "glucosecoach.e2e.spec.cjs",
            ROOT / "e2e" / "postprandial-peak.e2e.spec.cjs",
            ROOT / "e2e" / "insulin-action.e2e.spec.cjs",
            ROOT / "e2e" / "insulin-action-oracle.cjs",
            ROOT / "e2e" / "oracle.cjs",
            ROOT / "playwright.config.cjs",
            ROOT / ".github" / "workflows" / "e2e.yml",
        )
        for path in paths:
            self.assertTrue(path.is_file(), f"missing E2E artifact: {path.relative_to(ROOT)}")
        main_spec = paths[0].read_text(encoding="utf-8")
        self.assertIn("SEEDS", main_spec)
        self.assertIn("WINDOW_VALUES = ['7', '14', '30', '90', 'all']", main_spec)
        self.assertIn("assertStoredData", main_spec)
        self.assertIn("assertMealAnalysis", main_spec)
        self.assertIn("assertQuality", main_spec)
        peak_text = paths[1].read_text(encoding="utf-8")
        self.assertIn("latePeak", peak_text)
        self.assertIn("CGM-Wendepunkt-Proxy", peak_text)
        insulin_text = paths[2].read_text(encoding="utf-8")
        self.assertIn("assertEveryDisplayedInsulinNumber", insulin_text)
        self.assertIn("insulin-action-oracle.cjs", insulin_text)

    def test_node_logic_suites(self) -> None:
        for script in (
            ROOT / "tests" / "sites_logic_test.cjs",
            ROOT / "tests" / "postprandial_peak_test.cjs",
            ROOT / "tests" / "insulin_action_test.cjs",
        ):
            subprocess.run(["node", str(script)], check=True)


if __name__ == "__main__":
    unittest.main()
