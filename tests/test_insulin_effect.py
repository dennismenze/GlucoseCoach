from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PersonalInsulinEffectTests(unittest.TestCase):
    def test_personal_insulin_effect_contract(self) -> None:
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "insulin_effect_test.cjs")],
            capture_output=True,
            text=True,
        )
        if result.returncode:
            self.fail(
                "Personal insulin-effect Node contract failed.\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )


if __name__ == "__main__":
    unittest.main()
