from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOADER = (ROOT / "docs" / "app-v3.js").read_text(encoding="utf-8")
MODULE = (ROOT / "docs" / "app-meal-management.js").read_text(encoding="utf-8")


class MealManagementTests(unittest.TestCase):
    def test_browser_bundle_loads_meal_management(self) -> None:
        self.assertIn("app-meal-management.js", LOADER)
        self.assertIn("mergeMealEntries", MODULE)
        self.assertIn("complete-overlap-censored", MODULE)
        self.assertIn("Fenster vor Wendepunkt beendet", MODULE)
        self.assertIn("comparisonEligible", MODULE)

    def test_node_contracts(self) -> None:
        subprocess.run(
            ["node", str(ROOT / "tests" / "meal_management_test.cjs")],
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
