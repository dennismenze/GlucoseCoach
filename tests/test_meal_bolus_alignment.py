from __future__ import annotations

import subprocess
from pathlib import Path
import unittest


class MealBolusAlignmentJavaScriptTest(unittest.TestCase):
    def test_javascript_alignment_analysis(self) -> None:
        root = Path(__file__).resolve().parents[1]
        subprocess.run(
            ["node", str(root / "tests" / "meal_bolus_alignment_test.cjs")],
            cwd=root,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
