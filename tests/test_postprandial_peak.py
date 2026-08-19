from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PostprandialPeakTests(unittest.TestCase):
    def test_peak_follows_last_bolus_until_sustained_decline(self) -> None:
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "postprandial_peak_test.cjs")],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            self.fail(
                "Adaptive meal-peak Node contract failed.\n"
                f"STDOUT:\n{result.stdout}\n"
                f"STDERR:\n{result.stderr}"
            )


if __name__ == "__main__":
    unittest.main()
