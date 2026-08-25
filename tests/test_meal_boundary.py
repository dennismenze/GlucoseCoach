from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOADER = (ROOT / "docs" / "app-v3.js").read_text(encoding="utf-8")
MODULE = (ROOT / "docs" / "app-meal-boundary.js").read_text(encoding="utf-8")


class MealBoundaryTests(unittest.TestCase):
    def test_browser_bundle_loads_boundary_module_and_versions_children(self) -> None:
        self.assertIn("app-meal-boundary.js", LOADER)
        self.assertIn("GLUCOSECOACH_VERSION", LOADER)
        self.assertIn("complete-before-following-meal-bolus", MODULE)
        self.assertIn("complete-observed-window", MODULE)
        self.assertIn("followingMealBolus", MODULE)

    def test_node_contracts(self) -> None:
        subprocess.run(
            ["node", str(ROOT / "tests" / "meal_boundary_test.cjs")],
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
