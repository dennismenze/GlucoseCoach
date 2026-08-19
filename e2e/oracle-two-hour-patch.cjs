'use strict';

const oracle = require('./oracle.cjs');

const TWO_HOUR_REFERENCE_MINUTES = 120;
const CONTEXT_MINUTES = 300;
const BOLUS_LOOKBACK_MINUTES = 60;
const CONFIRMATION_POINTS = 4;
const CONFIRMATION_MINUTES = 20;
const MAX_POINT_GAP_MINUTES = 7;
const DROP_MGDL = 8;
const REBOUND_TOLERANCE_MGDL = 3;
const STEP_TOLERANCE_MGDL = 1;
const MEALS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
const TIME_ZONE = 'Europe/Berlin';

function round(value, digits = 0) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function closest(rows, target) {
  return [...rows].sort(
    (a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target),
  )[0] || null;
}

function positiveBoluses(boluses, start, end) {
  return [...(boluses || [])]
    .filter((row) => Number.isFinite(Number(row?.[0])))
    .filter((row) => row[0] >= start && row[0] <= end && Number(row[2]) > 0)
    .sort((a, b) => a[0] - b[0]);
}

function confirmation(rows, startIndex) {
  const candidate = rows[startIndex];
  const future = [];
  let previousMinute = candidate[0];
  for (let index = startIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row[0] - candidate[0] > CONFIRMATION_MINUTES + 5) break;
    if (row[0] - previousMinute > MAX_POINT_GAP_MINUTES) break;
    future.push(row);
    previousMinute = row[0];
    if (future.length === CONFIRMATION_POINTS) break;
  }
  if (future.length < CONFIRMATION_POINTS) return null;
  if (future.at(-1)[0] - candidate[0] < CONFIRMATION_MINUTES - 5) return null;
  return future;
}

function sustainedDecline(rows, earliestMinute) {
  const startIndex = rows.findIndex((row) => row[0] >= earliestMinute);
  if (startIndex < 0) return null;
  for (let index = startIndex; index < rows.length; index += 1) {
    const candidate = rows[index];
    const future = confirmation(rows, index);
    if (!future) continue;
    const sequence = [candidate, ...future];
    const nonIncreasing = future
      .map((row, deltaIndex) => row[1] - sequence[deltaIndex][1])
      .filter((delta) => delta <= STEP_TOLERANCE_MGDL).length;
    const highestConfirmation = Math.max(...future.map((row) => row[1]));
    const remaining = rows.slice(index + 1);
    const highestLater = remaining.length
      ? Math.max(...remaining.map((row) => row[1]))
      : candidate[1];
    if (
      highestConfirmation <= candidate[1] &&
      nonIncreasing >= CONFIRMATION_POINTS - 1 &&
      candidate[1] - future.at(-1)[1] >= DROP_MGDL &&
      highestLater <= candidate[1] + REBOUND_TOLERANCE_MGDL
    ) return candidate;
  }
  return null;
}

function analyze(entry, cgm, boluses, nextMealMinute) {
  const minute = entry.minute;
  const naturalEnd = minute + CONTEXT_MINUTES;
  const contextEnd = Math.min(
    naturalEnd,
    Number.isFinite(nextMealMinute) && nextMealMinute > minute
      ? nextMealMinute - 1
      : Number.POSITIVE_INFINITY,
  );
  const truncatedByNextMeal = contextEnd < naturalEnd;
  const windowRows = cgm.filter(
    (row) => row[0] >= minute - BOLUS_LOOKBACK_MINUTES &&
      row[0] <= contextEnd && row[1] !== null,
  );
  if (!windowRows.length) {
    return { entry, minute, status: 'missing-cgm', complete: false };
  }
  const pre = windowRows.filter((row) => row[0] <= minute);
  const post = windowRows.filter((row) => row[0] >= minute + 5);
  const firstTwoHours = post.filter((row) => row[0] <= minute + TWO_HOUR_REFERENCE_MINUTES);
  if (!pre.length || firstTwoHours.length < 18) {
    return {
      entry,
      minute,
      status: truncatedByNextMeal && contextEnd < minute + TWO_HOUR_REFERENCE_MINUTES
        ? 'overlapping-meal'
        : 'partial-cgm',
      complete: false,
      cgmPoints: firstTwoHours.length,
    };
  }

  const baseline = pre.at(-1)[1];
  const two = closest(
    post.filter((row) => row[0] >= minute + 105 && row[0] <= minute + 135),
    minute + TWO_HOUR_REFERENCE_MINUTES,
  );
  let rise = null;
  for (let index = 0; index <= post.length - 3; index += 1) {
    const [first, second, third] = [post[index], post[index + 1], post[index + 2]];
    if (first[1] >= baseline + 5 && second[1] >= baseline + 3 && third[1] >= baseline + 3) {
      rise = first;
      break;
    }
  }

  const allBoluses = positiveBoluses(
    boluses,
    minute - BOLUS_LOOKBACK_MINUTES,
    contextEnd,
  );
  const lastBolus = allBoluses.at(-1) || null;
  const searchStart = lastBolus
    ? Math.max(minute + 5, lastBolus[0] + 10)
    : minute + 5;
  const turn = sustainedDecline(post, searchStart);
  const bolus = turn
    ? allBoluses.filter((row) => row[0] <= turn[0]).at(-1) || null
    : null;
  const peakRows = turn && bolus
    ? windowRows.filter((row) => row[0] >= bolus[0] && row[0] <= turn[0])
    : [];
  const peakRow = peakRows.length
    ? peakRows.reduce((best, row) => row[1] > best[1] ? row : best, peakRows[0])
    : null;

  let status = 'partial-analysis';
  if (!allBoluses.length) status = 'missing-bolus';
  else if (!turn && truncatedByNextMeal) status = 'overlapping-meal';
  else if (!turn) status = 'no-stable-decline';
  else if (!bolus || !peakRow || !two) status = 'partial-analysis';
  else status = 'complete';

  return {
    entry,
    minute,
    complete: status === 'complete',
    status,
    baseline,
    minutesToRise: rise ? rise[0] - minute : null,
    peak: peakRow?.[1] ?? null,
    minutesToPeak: peakRow ? peakRow[0] - minute : null,
    peakFromBolus: peakRow && bolus ? peakRow[0] - bolus[0] : null,
    peakDelta: peakRow ? peakRow[1] - baseline : null,
    twoHour: two?.[1] ?? null,
    twoHourDelta: two ? two[1] - baseline : null,
    bolus,
    bolusOffset: bolus ? bolus[0] - minute : null,
    bolusCountBeforeTurn: turn ? allBoluses.filter((row) => row[0] <= turn[0]).length : 0,
    turnMinute: turn?.[0] ?? null,
    turnFromMeal: turn ? turn[0] - minute : null,
    turnFromBolus: turn && bolus ? turn[0] - bolus[0] : null,
  };
}

oracle.analysesFor = function adaptiveMealAnalyses(fixture) {
  const meals = fixture.diary.filter((entry) => MEALS.has(entry.occasion));
  const chronological = [...meals].sort((a, b) => a.minute - b.minute);
  const nextMeal = new Map();
  chronological.forEach((entry, index) => {
    nextMeal.set(entry, chronological[index + 1]?.minute ?? null);
  });
  return meals.map((entry) =>
    analyze(entry, fixture.clinical.cgm, fixture.clinical.boluses, nextMeal.get(entry)),
  );
};

oracle.foodGroups = function adaptiveFoodGroups(analyses) {
  const groups = new Map();
  for (const analysis of analyses) {
    const key = String(analysis.entry?.food ?? '').trim().toLocaleLowerCase('de-DE');
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, { label: analysis.entry.food.trim(), all: [], ok: [] });
    }
    const group = groups.get(key);
    group.all.push(analysis);
    if (analysis.complete) group.ok.push(analysis);
  }
  return [...groups.values()]
    .filter((group) => group.all.length >= 2)
    .map((group) => ({
      label: group.label,
      entries: group.all.length,
      analyzed: group.ok.length,
      medianPeakDelta: round(median(group.ok.map((item) => item.peakDelta)), 0),
      medianMinutesToPeak: round(median(group.ok.map((item) => item.minutesToPeak)), 0),
      medianMinutesBolusToPeak: round(median(group.ok.map((item) => item.peakFromBolus)), 0),
      medianTwoHourDelta: round(median(group.ok.map((item) => item.twoHourDelta)), 0),
    }));
};

const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
});

function hourOf(minute) {
  return Number(hourFormatter.format(new Date(minute * 60_000)));
}

function hourlyMetrics(rows) {
  const buckets = Array.from({ length: 24 }, () => []);
  for (const row of rows) buckets[hourOf(row[0])].push(row);
  return buckets
    .map((bucket, hour) => bucket.length ? { hour, ...oracle.calculateMetrics(bucket) } : null)
    .filter(Boolean);
}

oracle.expectedRecommendations = function adaptiveExpectedRecommendations(fixture, windowDays) {
  const rows = oracle.filterWindow(fixture.clinical.cgm, windowDays);
  const metrics = oracle.calculateMetrics(rows);
  const analyses = oracle.analysesFor(fixture);
  const groups = oracle.foodGroups(analyses);
  const cards = [];

  for (const group of groups) {
    cards.push(group.analyzed >= 2 ? {
      title: `${group.label}: wiederholter persönlicher Vergleich`,
      finding:
        `${group.analyzed} Wiederholungen zeigen im Median einen Peak-Anstieg von ` +
        `${group.medianPeakDelta ?? '–'} mg/dl nach ${group.medianMinutesToPeak ?? '–'} min ` +
        `ab Essen und ${group.medianMinutesBolusToPeak ?? '–'} min nach dem letzten Bolus ` +
        'vor dem anhaltenden Rückgang.',
    } : {
      title: `${group.label} ist mehrfach dokumentiert`,
      finding: `${group.entries} persönliche Einträge sind vorhanden, aber noch nicht mindestens zweimal vollständig auswertbar.`,
    });
  }

  const hours = hourlyMetrics(rows);
  const high = hours
    .filter((item) => item.samples >= 24 && item.above180 >= metrics.above180 + 8)
    .sort((a, b) => b.above180 - a.above180)[0];
  const low = hours
    .filter((item) => item.samples >= 24 && item.below70 >= metrics.below70 + 1)
    .sort((a, b) => b.below70 - a.below70)[0];
  if (high) cards.push({
    title: `Höherer Hochanteil um ${String(high.hour).padStart(2, '0')}:00 Uhr`,
    finding: `${high.above180}% gegenüber ${metrics.above180}% im gewählten Zeitraum.`,
  });
  if (low) cards.push({
    title: `Höherer Niedriganteil um ${String(low.hour).padStart(2, '0')}:00 Uhr`,
    finding: `${low.below70}% gegenüber ${metrics.below70}% im gewählten Zeitraum.`,
  });
  return cards.slice(0, 10);
};
