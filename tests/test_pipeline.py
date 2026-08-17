from __future__ import annotations

import base64
import gzip
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_dataset
import dataset_processing


class PipelineTests(unittest.TestCase):
    def test_cgm_import_deduplicates_and_classifies_sentinels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            header = "Zeitstempel,CGM-Glukosewert (mg/dl)\n"
            (root / "cgm_data_1.csv").write_text(
                "Name: removed\n" + header + "17.08.2026 10:00,100\n17.08.2026 10:05,110\n",
                encoding="utf-8",
            )
            (root / "cgm_data_2.csv").write_text(
                "Name: removed\n" + header + "17.08.2026 10:05,111\n17.08.2026 10:10,2001\n17.08.2026 10:15,1\n",
                encoding="utf-8",
            )
            frame = dataset_processing.load_cgm(root)

        self.assertEqual(len(frame), 4)
        self.assertTrue(frame["timestamp"].is_unique)
        self.assertEqual(frame["flag"].tolist(), ["", "", "HIGH", "LOW"])
        self.assertEqual(frame["glucose"].notna().sum(), 2)

    def test_sentinels_do_not_distort_numeric_statistics(self):
        frame = pd.DataFrame({
            "glucose": [100.0, None, None],
            "class_value": [100.0, 39.0, 401.0],
            "flag": ["", "LOW", "HIGH"],
        })
        metrics = dataset_processing.range_metrics(frame)
        self.assertEqual(metrics["mean"], 100)
        self.assertEqual(metrics["exactSamples"], 1)
        self.assertAlmostEqual(metrics["inRange"], 33.33, places=2)
        self.assertAlmostEqual(metrics["veryLow"], 33.33, places=2)
        self.assertAlmostEqual(metrics["veryHigh"], 33.33, places=2)

    def test_recommendations_are_rule_based_and_bounded(self):
        hourly = [{"hour": hour, "above180": 10.0, "below70": 0.5} for hour in range(24)]
        hourly[19]["below70"] = 2.5
        hourly[20]["below70"] = 1.8
        hourly[21]["above180"] = 27.0
        hourly[22]["above180"] = 24.0
        summary = {
            "overall": {"above180": 16.0, "below70": 1.0},
            "hourly": hourly,
            "mealResponse": {"byPeriod": [{
                "label": "Frühstück 05–11",
                "events": 12,
                "medianPeak": 202,
                "medianPeakDelta": 65,
                "medianMinutesToPeak": 95,
            }]},
        }
        items = build_dataset.build_recommendations(summary)
        self.assertEqual(
            [item["id"] for item in items],
            ["breakfast", "late-evening-high", "early-evening-low", "context-data"],
        )
        for item in items:
            self.assertTrue(item["finding"] and item["action"] and item["boundary"] and item["evidence"])

    def test_release_packaging_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, data = root / "source", root / "data"
            source.mkdir()
            data.mkdir()
            (source / "cgm_data_1.csv").write_text("metadata\nheader\n", encoding="utf-8")
            summary = {
                "profile": {"realMeasurements": True, "deidentified": True},
                "overall": {"samples": 2, "veryLow": 0, "low": 0, "inRange": 100, "high": 0, "veryHigh": 0},
                "sourceCoverage": {"bolusEvents": 0},
            }
            (data / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
            (data / "clinical-events.json").write_text(json.dumps({"boluses": []}), encoding="utf-8")
            (data / "cgm-2026-08.json").write_text(
                json.dumps({"month": "2026-08", "readings": [["2026-08-17T10:00", 100], ["2026-08-17T10:05", 110]]}),
                encoding="utf-8",
            )
            subprocess.run(
                [sys.executable, str(ROOT / "scripts/package_release.py"), "--source", str(source), "--data", str(data)],
                check=True,
                capture_output=True,
            )
            manifest = json.loads((data / "package-manifest.json").read_text(encoding="utf-8"))
            encoded = "".join((root / part["path"]).read_text(encoding="ascii").strip() for part in manifest["parts"])
            compressed = base64.b64decode(encoded)
            full = json.loads(gzip.decompress(compressed))

        self.assertEqual(manifest["compressedBytes"], len(compressed))
        self.assertEqual(full["summary"]["overall"]["samples"], 2)
        self.assertEqual(len(full["cgmByMonth"]["2026-08"]["readings"]), 2)


if __name__ == "__main__":
    unittest.main()
