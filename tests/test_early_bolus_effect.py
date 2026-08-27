from __future__ import annotations

import subprocess
from pathlib import Path
import unittest


class EarlyBolusEffectJavaScriptTest(unittest.TestCase):
    def test_short_window_effect_analysis(self) -> None:
        root = Path(__file__).resolve().parents[1]
        subprocess.run(
            ["node", str(root / "tests" / "early_bolus_effect_test.cjs")],
            cwd=root,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
