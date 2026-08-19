from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PostprandialPeakTests(unittest.TestCase):
    def test_peak_is_limited_to_first_120_minutes(self) -> None:
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "postprandial_peak_test.cjs")],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            self.fail(
                "Two-hour peak Node contract failed.\n"
                f"STDOUT:\n{result.stdout}\n"
                f"STDERR:\n{result.stderr}"
            )


if __name__ == "__main__":
    unittest.main()
