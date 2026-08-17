#!/usr/bin/env python3
"""Build the de-identified GlucoseCoach dataset from a German Omnipod export."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import pandas as pd

from dataset_processing import (
    HIGH_SENTINEL,
    LOW_SENTINEL,
    build_daily,
    build_gaps,
    build_hourly,
    build_periods,
    build_windows,
    episode_summary,
    iso_minute,
    load_alarms,
    load_basal_events,
    load_bg,
    load_boluses,
    load_cgm,
    load_insulin_daily,
    meal_response,
    number,
    range_metrics,
    write_json,
)

def build_months(cgm: pd.DataFrame, output: Path) -> list[dict[str, Any]]:
    months = []
    for month, frame in cgm.groupby(cgm["timestamp"].dt.strftime("%Y-%m")):
        readings = []
        for _, row in frame.iterrows():
            if row["flag"]:
                readings.append([iso_minute(row["timestamp"]), None, row["flag"]])
            else:
                readings.append([iso_minute(row["timestamp"]), number(row["glucose"], 0)])
        filename = f"cgm-{month}.json"
        write_json(output / filename, {"month": month, "readings": readings})
        months.append({"month": month, **range_metrics(frame)})
    return months


def build_insulin_payload(
    insulin: pd.DataFrame,
    boluses: pd.DataFrame,
    basal: pd.DataFrame,
    bg: pd.DataFrame,
    alarms: pd.DataFrame,
) -> dict[str, Any]:
    daily = [
        {
            "date": row["date"],
            "bolus": number(row["Bolus gesamt (U)"], 2),
            "basal": number(row["Basal gesamt (U)"], 2),
            "total": number(row["Insulin gesamt (U)"], 2),
        }
        for _, row in insulin.iterrows()
    ]
    bolus_events = [
        {
            "timestamp": iso_minute(row["timestamp"]),
            "type": str(row["Insulin-Typ"]),
            "enteredGlucose": number(row["Blutzuckereingabe (mg/dl)"], 0),
            "carbs": number(row["Kohlenhydrataufnahme (g)"], 1),
            "carbRatio": number(row["Kohlenhydratverhältnis"], 1),
            "delivered": number(row["Abgegebenes Insulin (E)"], 2),
            "initial": number(row["Anfängliche Abgabe (E)"], 2),
            "extended": number(row["Verzögerte Abgabe (E)"], 2),
        }
        for _, row in boluses.iterrows()
    ]
    basal_events = [
        {
            "timestamp": iso_minute(row["timestamp"]),
            "type": str(row["Insulin-Typ"]),
            "durationMinutes": number(row["Dauer (Minuten)"], 0),
            "percentage": number(row["Prozentsatz (%)"], 1),
            "rate": number(row["Rate"], 2),
            "delivered": number(row["Abgegebenes Insulin (E)"], 2),
        }
        for _, row in basal.iterrows()
    ]
    bg_events = [
        {
            "timestamp": iso_minute(row["timestamp"]),
            "glucose": number(row["glucose"], 0),
            "manual": str(row["Manuelles Lesen"]),
        }
        for _, row in bg.iterrows()
    ]
    alarm_events = [
        {"timestamp": iso_minute(row["timestamp"]), "event": str(row["Alarm/Ereignis"])}
        for _, row in alarms.iterrows()
    ]
    alarm_counts = [
        {"event": str(event), "count": int(count)}
        for event, count in alarms["Alarm/Ereignis"].value_counts().items()
    ]
    return {
        "daily": daily,
        "boluses": bolus_events,
        "basalEvents": basal_events,
        "manualGlucose": bg_events,
        "alarms": alarm_events,
        "alarmCounts": alarm_counts,
    }


def build_recommendations(summary: dict[str, Any]) -> list[dict[str, Any]]:
    hourly = {row["hour"]: row for row in summary["hourly"]}
    overall = summary["overall"]
    meal_periods = {row["label"]: row for row in summary["mealResponse"]["byPeriod"]}
    breakfast = meal_periods.get("Frühstück 05–11")
    cards: list[dict[str, Any]] = []

    if breakfast and breakfast["events"] >= 10:
        cards.append(
            {
                "id": "breakfast",
                "priority": 1,
                "title": "Frühstücksmuster zuerst untersuchen",
                "finding": (
                    f"Bei {breakfast['events']} isoliert auswertbaren Frühstücksereignissen lag der mediane Peak bei "
                    f"{breakfast['medianPeak']} mg/dl, im Median {breakfast['medianPeakDelta']} mg/dl über dem Ausgangswert. "
                    f"Der Peak trat nach rund {breakfast['medianMinutesToPeak']} Minuten auf."
                ),
                "action": "Für 14 Tage das konkrete Frühstück, Beginn, Fett/Eiweiß/Ballaststoffe, Aktivität und Bolus-Zeitpunkt protokollieren. Gleiche Mahlzeiten erst nach mindestens drei vergleichbaren Wiederholungen bewerten.",
                "boundary": "Keine Dosis- oder Timingänderung aus dieser Beobachtung ableiten; die Auswertung zeigt nur ein wiederkehrendes Muster.",
                "evidence": ["meal-response", "hourly-09", "hourly-10"],
            }
        )

    h21 = hourly.get(21)
    h22 = hourly.get(22)
    if h21 and h21["above180"] >= overall["above180"] + 8:
        cards.append(
            {
                "id": "late-evening-high",
                "priority": 2,
                "title": "Späte Anstiege um 21 Uhr trennen",
                "finding": f"Um 21 Uhr lagen {h21['above180']} % der Werte über 180 mg/dl; um 22 Uhr waren es {h22['above180']} %. Über alle Zeiten waren es {overall['above180']} %.",
                "action": "Abendessen und spätere Snacks getrennt erfassen. Bei fettreichen oder eiweißreichen Mahlzeiten zusätzlich Menge und Uhrzeit notieren, damit verzögerte Anstiege von anderen Ursachen unterscheidbar werden.",
                "boundary": "Ohne konkrete Mahlzeiten-, Aktivitäts- und Krankheitsdaten ist keine Ursache bewiesen.",
                "evidence": ["hourly-21", "hourly-22"],
            }
        )

    h19 = hourly.get(19)
    h20 = hourly.get(20)
    if h19 and h19["below70"] >= overall["below70"] + 1:
        cards.append(
            {
                "id": "early-evening-low",
                "priority": 3,
                "title": "Unterzuckerungscluster am frühen Abend prüfen",
                "finding": f"Um 19 Uhr lagen {h19['below70']} % der Werte unter 70 mg/dl, um 20 Uhr {h20['below70']} %. Der Gesamtanteil betrug {overall['below70']} %.",
                "action": "Bei Ereignissen zwischen 18 und 20 Uhr Aktivität, vorherige Mahlzeit, Bolus-Zeitpunkt und besondere Belastung dokumentieren. Wiederkehrende Konstellationen für die gemeinsame Prüfung mit dem Diabetesteam markieren.",
                "boundary": "Die App gibt keine Hypoglykämiebehandlung und keine Änderung von Pumpeneinstellungen vor; dafür gilt der bestehende Behandlungsplan.",
                "evidence": ["hourly-19", "hourly-20", "low-episodes"],
            }
        )

    cards.append(
        {
            "id": "context-data",
            "priority": 4,
            "title": "Fehlende Kontextdaten schließen",
            "finding": "Der Export enthält CGM-, Kohlenhydrat- und Insulindaten, aber keine ausgefüllten Angaben zu konkreten Lebensmitteln, Sport, Schlaf, Krankheit oder Stress.",
            "action": "Das lokale Tagebuch gezielt nur bei Mahlzeiten, Sport, Krankheit, ungewöhnlichem Stress und abweichendem Schlaf nutzen. Dadurch werden spätere Vergleiche kausal belastbarer, ohne jeden Tag vollständig protokollieren zu müssen.",
            "boundary": "Korrelationen bleiben Beobachtungen; sie beweisen weder Insulinresistenz noch eine bestimmte Ursache.",
            "evidence": ["source-coverage"],
        }
    )
    return cards


def build_dataset(input_root: Path, output: Path) -> None:
    cgm = load_cgm(input_root)
    insulin = load_insulin_daily(input_root)
    boluses = load_boluses(input_root)
    basal = load_basal_events(input_root)
    bg = load_bg(input_root)
    alarms = load_alarms(input_root)

    output.mkdir(parents=True, exist_ok=True)
    months = build_months(cgm, output)
    daily = build_daily(cgm, insulin, boluses)
    meal = meal_response(cgm, boluses)
    gaps = build_gaps(cgm)
    summary: dict[str, Any] = {
        "schemaVersion": 1,
        "profile": {
            "label": "Privates Glukoseprofil",
            "realMeasurements": True,
            "deidentified": True,
            "timezone": "Europe/Berlin",
            "rangeStart": iso_minute(cgm["timestamp"].min()),
            "rangeEnd": iso_minute(cgm["timestamp"].max()),
            "sourceType": "Omnipod CSV-Export",
        },
        "targets": {
            "displayRange": [70, 180],
            "veryLowBelow": 54,
            "veryHighAbove": 250,
            "referenceOnly": True,
            "note": "Referenzbereiche sind keine individuellen Therapieziele.",
        },
        "sentinelHandling": {
            "lowCode": LOW_SENTINEL,
            "highCode": HIGH_SENTINEL,
            "lowCount": int(cgm["flag"].eq("LOW").sum()),
            "highCount": int(cgm["flag"].eq("HIGH").sum()),
            "method": "LOW/HIGH-Codes zählen für Bereichsanteile, werden aber aus Mittelwert, GMI und CV ausgeschlossen.",
        },
        "dataQuality": gaps,
        "overall": range_metrics(cgm),
        "windows": build_windows(cgm),
        "months": months,
        "periods": build_periods(cgm),
        "hourly": build_hourly(cgm),
        "daily": daily,
        "episodes": {
            "below70": episode_summary(cgm, 70, "below"),
            "below54": episode_summary(cgm, 54, "below"),
            "above180": episode_summary(cgm, 180, "above"),
            "above250": episode_summary(cgm, 250, "above"),
        },
        "mealResponse": meal,
        "sourceCoverage": {
            "cgm": int(len(cgm)),
            "dailyInsulin": int(len(insulin)),
            "bolusEvents": int(len(boluses)),
            "mealEvents": int((boluses["Kohlenhydrataufnahme (g)"].fillna(0) > 0).sum()),
            "correctionOnlyEvents": int((boluses["Kohlenhydrataufnahme (g)"].fillna(0) == 0).sum()),
            "basalEvents": int(len(basal)),
            "manualGlucose": int(len(bg)),
            "alarms": int(len(alarms)),
            "manualContext": {
                "food": 0,
                "exercise": 0,
                "sleep": 0,
                "illnessStress": 0,
            },
        },
    }
    summary["recommendations"] = build_recommendations(summary)
    write_json(output / "summary.json", summary)
    write_json(output / "clinical-events.json", build_insulin_payload(insulin, boluses, basal, bg, alarms))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True, help="Entpackter Exportordner")
    parser.add_argument("--output", type=Path, default=Path("data"))
    args = parser.parse_args()
    build_dataset(args.input, args.output)
