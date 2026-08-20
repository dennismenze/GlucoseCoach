from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class GlookoModeContractTests(unittest.TestCase):
    def test_browser_loader_and_public_contract(self) -> None:
        loader = (ROOT / "docs" / "app-v3.js").read_text(encoding="utf-8")
        source = (ROOT / "docs" / "app-glooko-mode.js").read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        integration = (ROOT / "GLOOKO_INTEGRATION.md").read_text(encoding="utf-8")

        self.assertIn("app-glooko-mode.js", loader)
        for marker in (
            "glucosecoach-meal-source-v1",
            "SOURCE_COMBINED",
            "buildGlookoMealEntries",
            "buildAdditionalGlookoMealEntries",
            "buildAnalysisDiary",
            "isDuplicateMeal",
            "Glooko-Webexport",
            "Glooko · nur lesbar",
            "Beide Quellen fließen gemeinsam in die Auswertung ein",
            "form.hidden = false",
            "foodEvents",
            "cgmCarbs",
            "Eine offizielle direkte Kontosynchronisation",
        ):
            self.assertIn(marker, source)

        self.assertNotIn('id="glooko-meal-source"', source)
        self.assertIn("Glooko als zusätzliche Datenquelle", readme)
        self.assertIn("bleibt vollständig erhalten", readme)
        self.assertIn("Individuelle Nutzerkonten", integration)
        self.assertIn("kein inoffizielles Login", integration)
        self.assertIn("Das lokale Formular wird nicht ausgeblendet", integration)

    def test_unit_and_e2e_artifacts_are_executable(self) -> None:
        unit = ROOT / "tests" / "glooko_mode_test.cjs"
        e2e = ROOT / "e2e" / "glooko-mode.e2e.spec.cjs"
        self.assertTrue(unit.is_file())
        self.assertTrue(e2e.is_file())
        subprocess.run(
            ["node", "--check", str(ROOT / "docs" / "app-glooko-mode.js")],
            check=True,
        )
        subprocess.run(["node", "--check", str(e2e)], check=True)
        subprocess.run(["node", str(unit)], check=True)


if __name__ == "__main__":
    unittest.main()
