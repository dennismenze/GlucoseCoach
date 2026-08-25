import subprocess
import unittest
from pathlib import Path


class FeedbackAnalysisNodeTest(unittest.TestCase):
    def test_feedback_analysis_contract(self):
        repository = Path(__file__).resolve().parents[1]
        subprocess.run(
            ["node", "tests/feedback_analysis_test.cjs"],
            cwd=repository,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
