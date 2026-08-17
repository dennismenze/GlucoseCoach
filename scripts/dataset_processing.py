#!/usr/bin/env python3
"""Build the de-identified GlucoseCoach dataset from a German Omnipod export.

The script deliberately ignores the first metadata row (which contains the
person's name) and drops device serial numbers. Exact health observations are
retained. Out-of-range device sentinels are stored as LOW/HIGH flags rather
than fictitious numeric glucose values.
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

DATE_FORMAT = "%d.%m.%Y %H:%M"
LOW_SENTINEL = 1
HIGH_SENTINEL = 2001
LOW_DISPLAY = 39
HIGH_DISPLAY = 401


def read_export_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, skiprows=1, decimal=",", encoding="utf-8-sig")


def number(value: Any, digits: int = 2) -> float | int | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    result = round(float(value), digits)
    return int(result) if result.is_integer() else result


def percent(mask: pd.Series) -> float:
    return round(float(mask.mean() * 100), 2) if len(mask) else 0.0


def iso_minute(value: pd.Timestamp) -> str:
    return value.strftime("%Y-%m-%dT%H:%M")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def load_cgm(root: Path) -> pd.DataFrame:
    frames = [read_export_csv(path) for path in sorted(root.glob("cgm_data_*.csv"))]
    if not frames:
        raise FileNotFoundError("Keine cgm_data_*.csv gefunden")
    cgm = pd.concat(frames, ignore_index=True)
    cgm["timestamp"] = pd.to_datetime(cgm["Zeitstempel"], format=DATE_FORMAT)
    cgm["raw"] = pd.to_numeric(cgm["CGM-Glukosewert (mg/dl)"], errors="coerce")
    cgm = cgm.sort_values("timestamp").drop_duplicates("timestamp").reset_index(drop=True)
    cgm["flag"] = np.select(
        [cgm["raw"].eq(LOW_SENTINEL), cgm["raw"].eq(HIGH_SENTINEL)],
        ["LOW", "HIGH"],
        default="",
    )
    cgm["glucose"] = cgm["raw"].where(cgm["raw"].between(40, 400))
    cgm["class_value"] = cgm["raw"].replace(
        {LOW_SENTINEL: LOW_DISPLAY, HIGH_SENTINEL: HIGH_DISPLAY}
    )
    return cgm


def load_insulin_daily(root: Path) -> pd.DataFrame:
    path = root / "Insulin data" / "insulin_data_1.csv"
    frame = read_export_csv(path)
    frame["timestamp"] = pd.to_datetime(frame["Zeitstempel"], format=DATE_FORMAT)
    frame["date"] = frame["timestamp"].dt.strftime("%Y-%m-%d")
    for column in ["Bolus gesamt (U)", "Insulin gesamt (U)", "Basal gesamt (U)"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.sort_values("timestamp")


def load_boluses(root: Path) -> pd.DataFrame:
    path = root / "Insulin data" / "bolus_data_1.csv"
    frame = read_export_csv(path)
    frame["timestamp"] = pd.to_datetime(frame["Zeitstempel"], format=DATE_FORMAT)
    for column in [
        "Blutzuckereingabe (mg/dl)",
        "Kohlenhydrataufnahme (g)",
        "Kohlenhydratverhältnis",
        "Abgegebenes Insulin (E)",
        "Anfängliche Abgabe (E)",
        "Verzögerte Abgabe (E)",
    ]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.sort_values("timestamp")


def load_basal_events(root: Path) -> pd.DataFrame:
    path = root / "Insulin data" / "basal_data_1.csv"
    frame = read_export_csv(path)
    frame["timestamp"] = pd.to_datetime(frame["Zeitstempel"], format=DATE_FORMAT)
    for column in ["Dauer (Minuten)", "Prozentsatz (%)", "Rate", "Abgegebenes Insulin (E)"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.sort_values("timestamp")


def load_bg(root: Path) -> pd.DataFrame:
    frame = read_export_csv(root / "bg_data_1.csv")
    frame["timestamp"] = pd.to_datetime(frame["Zeitstempel"], format=DATE_FORMAT)
    frame["glucose"] = pd.to_numeric(frame["Glukosewert (mg/dl)"], errors="coerce")
    return frame.sort_values("timestamp")


def load_alarms(root: Path) -> pd.DataFrame:
    frame = read_export_csv(root / "alarms_data_1.csv")
    frame["timestamp"] = pd.to_datetime(frame["Zeitstempel"], format=DATE_FORMAT)
    return frame.sort_values("timestamp")


def range_metrics(frame: pd.DataFrame) -> dict[str, Any]:
    exact = frame["glucose"].dropna()
    values = frame["class_value"]
    mean = exact.mean()
    sd = exact.std(ddof=0)
    return {
        "samples": int(len(frame)),
        "exactSamples": int(exact.size),
        "mean": number(mean, 1),
        "median": number(exact.median(), 1),
        "sd": number(sd, 1),
        "cv": number(sd / mean * 100, 1) if mean else None,
        "gmi": number(3.31 + 0.02392 * mean, 2) if mean else None,
        "min": number(exact.min(), 0),
        "max": number(exact.max(), 0),
        "veryLow": percent(values < 54),
        "low": percent((values >= 54) & (values < 70)),
        "inRange": percent((values >= 70) & (values <= 180)),
        "high": percent((values > 180) & (values <= 250)),
        "veryHigh": percent(values > 250),
        "below70": percent(values < 70),
        "above180": percent(values > 180),
        "lowSentinels": int(frame["flag"].eq("LOW").sum()),
        "highSentinels": int(frame["flag"].eq("HIGH").sum()),
    }


def quantile(exact: pd.Series, q: float) -> float | int | None:
    return number(exact.quantile(q), 1) if not exact.empty else None


def build_hourly(cgm: pd.DataFrame) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for hour, frame in cgm.groupby(cgm["timestamp"].dt.hour):
        exact = frame["glucose"].dropna()
        metrics = range_metrics(frame)
        result.append(
            {
                "hour": int(hour),
                "samples": int(len(frame)),
                "mean": metrics["mean"],
                "median": metrics["median"],
                "p10": quantile(exact, 0.10),
                "p25": quantile(exact, 0.25),
                "p75": quantile(exact, 0.75),
                "p90": quantile(exact, 0.90),
                "inRange": metrics["inRange"],
                "below70": metrics["below70"],
                "above180": metrics["above180"],
                "veryLow": metrics["veryLow"],
                "veryHigh": metrics["veryHigh"],
            }
        )
    return result


def build_periods(cgm: pd.DataFrame) -> list[dict[str, Any]]:
    definitions = [
        ("Nacht", 0, 6),
        ("Morgen", 6, 12),
        ("Nachmittag", 12, 18),
        ("Abend", 18, 24),
    ]
    hours = cgm["timestamp"].dt.hour
    result = []
    for label, start, end in definitions:
        frame = cgm[(hours >= start) & (hours < end)]
        result.append({"label": label, "startHour": start, "endHour": end, **range_metrics(frame)})
    return result


def build_windows(cgm: pd.DataFrame) -> list[dict[str, Any]]:
    end = cgm["timestamp"].max()
    result = []
    for days in [7, 14, 30, 60, 90]:
        frame = cgm[cgm["timestamp"] >= end - pd.Timedelta(days=days)]
        result.append(
            {
                "days": days,
                "start": iso_minute(frame["timestamp"].min()),
                "end": iso_minute(frame["timestamp"].max()),
                **range_metrics(frame),
            }
        )
    return result


def build_daily(cgm: pd.DataFrame, insulin: pd.DataFrame, boluses: pd.DataFrame) -> list[dict[str, Any]]:
    insulin_by_date = {
        row["date"]: row for _, row in insulin.iterrows()
    }
    boluses = boluses.copy()
    boluses["date"] = boluses["timestamp"].dt.strftime("%Y-%m-%d")
    bolus_groups = {date: frame for date, frame in boluses.groupby("date")}
    result = []
    for date, frame in cgm.groupby(cgm["timestamp"].dt.strftime("%Y-%m-%d")):
        metrics = range_metrics(frame)
        insulin_row = insulin_by_date.get(date)
        event_frame = bolus_groups.get(date)
        if event_frame is None:
            meal_count = correction_count = 0
            carbs = 0.0
        else:
            carb_values = event_frame["Kohlenhydrataufnahme (g)"].fillna(0)
            meal_count = int((carb_values > 0).sum())
            correction_count = int((carb_values == 0).sum())
            carbs = float(carb_values.sum())
        result.append(
            {
                "date": date,
                **metrics,
                "bolusTotal": number(insulin_row["Bolus gesamt (U)"], 2) if insulin_row is not None else None,
                "basalTotal": number(insulin_row["Basal gesamt (U)"], 2) if insulin_row is not None else None,
                "insulinTotal": number(insulin_row["Insulin gesamt (U)"], 2) if insulin_row is not None else None,
                "carbs": number(carbs, 1),
                "mealEvents": meal_count,
                "correctionEvents": correction_count,
            }
        )
    return result


def episode_summary(cgm: pd.DataFrame, threshold: float, direction: str) -> dict[str, Any]:
    values = cgm["class_value"]
    mask = values < threshold if direction == "below" else values > threshold
    indices = np.flatnonzero(mask.to_numpy())
    episodes: list[dict[str, Any]] = []
    if len(indices):
        start = previous = int(indices[0])
        for current_raw in indices[1:]:
            current = int(current_raw)
            gap = (cgm.loc[current, "timestamp"] - cgm.loc[previous, "timestamp"]).total_seconds() / 60
            if gap <= 15:
                previous = current
            else:
                episodes.append(build_episode(cgm, start, previous))
                start = previous = current
        episodes.append(build_episode(cgm, start, previous))
    durations = [episode["durationMinutes"] for episode in episodes]
    return {
        "count": len(episodes),
        "medianDurationMinutes": number(float(np.median(durations)), 0) if durations else 0,
        "maxDurationMinutes": max(durations, default=0),
        "longest": sorted(episodes, key=lambda item: item["durationMinutes"], reverse=True)[:8],
    }


def build_episode(cgm: pd.DataFrame, start: int, end: int) -> dict[str, Any]:
    frame = cgm.loc[start:end]
    return {
        "start": iso_minute(cgm.loc[start, "timestamp"]),
        "end": iso_minute(cgm.loc[end, "timestamp"]),
        "durationMinutes": int((cgm.loc[end, "timestamp"] - cgm.loc[start, "timestamp"]).total_seconds() / 60 + 5),
        "nadir": number(frame["class_value"].min(), 0),
        "peak": number(frame["class_value"].max(), 0),
    }


def build_gaps(cgm: pd.DataFrame) -> dict[str, Any]:
    gaps = cgm["timestamp"].diff().dt.total_seconds().div(60)
    relevant = gaps[gaps > 10]
    details = []
    for index, minutes in relevant.sort_values(ascending=False).head(20).items():
        details.append(
            {
                "start": iso_minute(cgm.loc[index - 1, "timestamp"]),
                "end": iso_minute(cgm.loc[index, "timestamp"]),
                "minutes": number(minutes, 0),
            }
        )
    expected = int(round((cgm["timestamp"].max() - cgm["timestamp"].min()).total_seconds() / 300)) + 1
    return {
        "expectedSamples": expected,
        "observedSamples": int(len(cgm)),
        "activePercent": number(len(cgm) / expected * 100, 2),
        "gapsOver10Minutes": int(len(relevant)),
        "maxGapMinutes": number(relevant.max(), 0) if len(relevant) else 0,
        "largestGaps": details,
    }


def meal_response(cgm: pd.DataFrame, boluses: pd.DataFrame) -> dict[str, Any]:
    meals = boluses[boluses["Kohlenhydrataufnahme (g)"].fillna(0) > 0].sort_values("timestamp").copy()
    meals["previousMealMinutes"] = meals["timestamp"].diff().dt.total_seconds().div(60)
    meals["nextMealMinutes"] = meals["timestamp"].shift(-1).sub(meals["timestamp"]).dt.total_seconds().div(60)
    indexed = cgm.set_index("timestamp").sort_index()
    events = []
    for _, meal in meals.iterrows():
        if pd.notna(meal["previousMealMinutes"]) and meal["previousMealMinutes"] < 120:
            continue
        if pd.notna(meal["nextMealMinutes"]) and meal["nextMealMinutes"] < 180:
            continue
        timestamp = meal["timestamp"]
        pre = indexed.loc[timestamp - pd.Timedelta(minutes=15):timestamp, "glucose"].dropna()
        post = indexed.loc[timestamp + pd.Timedelta(minutes=5):timestamp + pd.Timedelta(minutes=180), "glucose"].dropna()
        at_two_hours = indexed.loc[timestamp + pd.Timedelta(minutes=105):timestamp + pd.Timedelta(minutes=135), "glucose"].dropna()
        if pre.empty or len(post) < 25 or at_two_hours.empty:
            continue
        baseline = float(pre.iloc[-1])
        peak = float(post.max())
        peak_at = post.idxmax()
        target = timestamp + pd.Timedelta(minutes=120)
        nearest_index = int(np.abs(at_two_hours.index - target).argmin())
        two_hour = float(at_two_hours.iloc[nearest_index])
        events.append(
            {
                "timestamp": iso_minute(timestamp),
                "hour": int(timestamp.hour),
                "carbs": number(meal["Kohlenhydrataufnahme (g)"], 1),
                "insulin": number(meal["Abgegebenes Insulin (E)"], 2),
                "baseline": number(baseline, 0),
                "peak": number(peak, 0),
                "minutesToPeak": number((peak_at - timestamp).total_seconds() / 60, 0),
                "peakDelta": number(peak - baseline, 0),
                "twoHour": number(two_hour, 0),
                "twoHourDelta": number(two_hour - baseline, 0),
            }
        )
    event_frame = pd.DataFrame(events)
    if event_frame.empty:
        return {"sourceMealEvents": int(len(meals)), "isolatedAnalyzableEvents": 0, "byPeriod": [], "byCarbs": [], "events": []}

    def aggregate(frame: pd.DataFrame, label: str) -> dict[str, Any]:
        return {
            "label": label,
            "events": int(len(frame)),
            "medianCarbs": number(frame["carbs"].median(), 1),
            "medianBaseline": number(frame["baseline"].median(), 0),
            "medianPeak": number(frame["peak"].median(), 0),
            "medianMinutesToPeak": number(frame["minutesToPeak"].median(), 0),
            "medianPeakDelta": number(frame["peakDelta"].median(), 0),
            "medianTwoHour": number(frame["twoHour"].median(), 0),
            "medianTwoHourDelta": number(frame["twoHourDelta"].median(), 0),
        }

    periods = [
        ("Frühstück 05–11", 5, 11),
        ("Mittag 11–15", 11, 15),
        ("Nachmittag/Abend 15–20", 15, 20),
        ("Spät 20–24", 20, 24),
        ("Nacht 00–05", 0, 5),
    ]
    by_period = []
    for label, start, end in periods:
        frame = event_frame[(event_frame["hour"] >= start) & (event_frame["hour"] < end)]
        if len(frame):
            by_period.append(aggregate(frame, label))

    bins = [
        ("≤15 g", 0, 15),
        ("15–30 g", 15, 30),
        ("30–50 g", 30, 50),
        (">50 g", 50, math.inf),
    ]
    by_carbs = []
    for label, lower, upper in bins:
        if math.isinf(upper):
            frame = event_frame[event_frame["carbs"] > lower]
        elif lower == 0:
            frame = event_frame[(event_frame["carbs"] > lower) & (event_frame["carbs"] <= upper)]
        else:
            frame = event_frame[(event_frame["carbs"] > lower) & (event_frame["carbs"] <= upper)]
        if len(frame):
            by_carbs.append(aggregate(frame, label))

    return {
        "sourceMealEvents": int(len(meals)),
        "isolatedAnalyzableEvents": int(len(event_frame)),
        "method": "Mahlzeiten mit mindestens 120 Minuten Abstand vorher, 180 Minuten Abstand nachher und ausreichender CGM-Abdeckung.",
        "byPeriod": by_period,
        "byCarbs": by_carbs,
        "events": events,
    }
