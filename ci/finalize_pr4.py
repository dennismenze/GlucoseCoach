from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, pattern: str, replacement: str, *, flags: int = 0) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count == 0:
        raise SystemExit(f"Expected finalization pattern not found in {path}")
    target.write_text(updated, encoding="utf-8")


# Keep the complete extended importer API in Node consumers. Meal and insulin
# modules intentionally override analytical functions, not CSV parsing.
replace_once(
    "docs/app-v3.js",
    r"  if \(typeof document === 'undefined'\) \{.*?\n  \}\n\n  function loadScript",
    """  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      const core = require('./app-v3-core.js');
      const mealWindow = require('./app-meal-window.js');
      const insulinAction = require('./app-insulin-action.js');
      const importers = require('./app-importers.js');
      const contextImporters = require('./app-importers-context.js');
      const uiContract = require('./app-ui-contract.js');
      module.exports = {
        ...core,
        ...mealWindow,
        ...insulinAction,
        ...importers,
        ...contextImporters,
        ...uiContract,
      };
    }
    return;
  }

  function loadScript""",
    flags=re.S,
)

meal_path = ROOT / "docs/app-meal-window.js"
meal_source = meal_path.read_text(encoding="utf-8")
if "const declineRow = document.createElement('tr');" in meal_source:
    old = re.compile(
        r"        const peakRow = document\.createElement\('tr'\);.*?"
        r"        body\.appendChild\(declineRow\);",
        re.S,
    )
    replacement = """        const mealAnalysisRow = document.createElement('tr');
        mealAnalysisRow.innerHTML =
          '<td>Mahlzeiten-Peakfenster / anhaltender Rückgangs-Proxy</td>' +
          '<td>0–120 min</td>' +
          `<td>Der Peak startet am protokollierten Essen. Der Rückgangs-Proxy liegt erst nach dem Peak; ` +
          `vier Folgewerte über ${DECLINE_CONFIRMATION_MINUTES} Minuten müssen mindestens ` +
          `${DECLINE_DROP_MGDL} mg/dl Abfall bestätigen. Ein späterer Rebound über ` +
          `${DECLINE_REBOUND_TOLERANCE_MGDL} mg/dl bis zum Kontextende verwirft den Kandidaten.</td>`;
        body.appendChild(mealAnalysisRow);"""
    meal_source, count = old.subn(replacement, meal_source, count=1)
    if count != 1:
        raise SystemExit("Could not consolidate meal quality rows")
    meal_path.write_text(meal_source, encoding="utf-8")
elif "Mahlzeiten-Peakfenster / anhaltender Rückgangs-Proxy" not in meal_source:
    raise SystemExit("Unknown meal quality-row structure")

spec_path = ROOT / "e2e/postprandial-peak.e2e.spec.cjs"
spec = spec_path.read_text(encoding="utf-8")
spec = spec.replace(
    "await expect(qualityRow.locator('td').nth(1)).toHaveText('0–120 min ab Essen');",
    "await expect(qualityRow.locator('td').nth(1)).toHaveText('0–120 min');\n"
    "  await expect(qualityRow.locator('td').nth(2)).toContainText('Peak startet am protokollierten Essen');",
)
spec = spec.replace(
    "const declineRow = page.locator('#quality-body tr').filter({ hasText: 'Anhaltender Rückgangs-Proxy' });\n"
    "  await expect(declineRow.locator('td').nth(1)).toHaveText('nach 2-h-Peak · 20 min Hysterese');\n"
    "  await expect(declineRow.locator('td').nth(2)).toContainText('späterer Rebound');",
    "const declineRow = page.locator('#quality-body tr').filter({ hasText: 'anhaltender Rückgangs-Proxy' });\n"
    "  await expect(declineRow.locator('td').nth(1)).toHaveText('0–120 min');\n"
    "  await expect(declineRow.locator('td').nth(2)).toContainText('vier Folgewerte über 20 Minuten');\n"
    "  await expect(declineRow.locator('td').nth(2)).toContainText('späterer Rebound');",
)
spec_path.write_text(spec, encoding="utf-8")

# Preserve the explicit methodological sentence used by the public contract.
index_path = ROOT / "docs/index.html"
index = index_path.read_text(encoding="utf-8")
if "kein direkter pharmakologischer Wirkeintritt" not in index:
    index = index.replace(
        "nicht als direkter pharmakologischer Wirkbeginn interpretiert.",
        "nicht als direkter pharmakologischer Wirkbeginn interpretiert; er ist kein direkter pharmakologischer Wirkeintritt.",
    )
index_path.write_text(index, encoding="utf-8")
