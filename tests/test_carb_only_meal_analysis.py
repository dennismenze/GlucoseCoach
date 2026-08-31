from __future__ import annotations

import subprocess
from pathlib import Path
import unittest


class CarbohydrateOnlyMealJavaScriptTest(unittest.TestCase):
    def test_carbohydrate_only_meals_and_usable_filter(self) -> None:
        root = Path(__file__).resolve().parents[1]
        subprocess.run(
            ["node", str(root / "tests" / "carb_only_meal_analysis_test.cjs")],
            cwd=root,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
