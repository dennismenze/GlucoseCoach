'use strict';

const oracle = require('./oracle.cjs');

const PEAK_WINDOW_MINUTES = 120;
const CONTEXT_MINUTES = 180;
const CONFIRMATION_POINTS = 4;
const CONFIRMATION_MINUTES = 20;
const MAX_POINT_GAP_MINUTES = 7;
const DROP_MGDL = 8;
const REBOUND_TOLERANCE_MGDL = 3;
const STEP_TOLERANCE_MGDL = 1;
const MEALS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);

function closest(rows, target) {
  return [...rows].sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target))[0] || null;
}

function contiguousConfirmation(rows, startIndex) {
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

function sustainedDecline(post, peakRow) {
  const firstEligibleIndex = post.findIndex((row) => row[0] >= peakRow[0]);
  if (firstEligibleIndex < 0) return null;
  for (let index = firstEligibleIndex; index < post.length; index += 1) {
    const candidate = post[index];
    const future = contiguousConfirmation(post, index);
    if (!future) continue;
    const sequence = [candidate, ...future];
    const nonIncreasingSteps = future
      .map((row, deltaIndex) => row[1] - sequence[deltaIndex][1])
      .filter((delta) => delta <= STEP_TOLERANCE_MGDL).length;
    const remaining = post.slice(index + 1);
    const highestLaterValue = remaining.length
      ? Math.max(...remaining.map((row) => row[1]))
      : candidate[1];
    if (
      nonIncreasingSteps >= CONFIRMATION_POINTS - 1 &&
      candidate[1] - future.at(-1)[1] >= DROP_MGDL &&
      highestLaterValue <= candidate[1] + REBOUND_TOLERANCE_MGDL
    ) return candidate;
  }
  return null;
}

function analyze(entry, cgm, boluses, nextMealMinute) {
  const minute = entry.minute;
  const contextEnd = Math.min(
    minute + CONTEXT_MINUTES,
    Number.isFinite(nextMealMinute) && nextMealMinute > minute
      ? nextMealMinute - 1
      : Number.POSITIVE_INFINITY,
  );
  const overlapsPeakWindow = contextEnd < minute + PEAK_WINDOW_MINUTES;
  const windowRows = cgm.filter((row) => row[0] >= minute - 15 && row[0] <= contextEnd);
  if (!windowRows.length) return { entry, minute, status: 'missing-cgm', complete: false };
  const pre = windowRows.filter((row) => row[0] <= minute && row[1] !== null);
  const post = windowRows.filter((row) => row[0] >= minute + 5 && row[1] !== null);
  const peakRows = post.filter((row) => row[0] <= minute + PEAK_WINDOW_MINUTES);
  if (!pre.length || peakRows.length < 18) {
    return {
      entry,
      minute,
      status: overlapsPeakWindow ? 'overlapping-meal' : 'partial-cgm',
      complete: false,
      cgmPoints: peakRows.length,
    };
  }
  const baseline = pre.at(-1)[1];
  const peakRow = peakRows.reduce((best, row) => row[1] > best[1] ? row : best, peakRows[0]);
  const two = closest(
    post.filter((row) => row[0] >= minute + 105 && row[0] <= minute + 135),
    minute + 120,
  );
  let rise = null;
  for (let index = 0; index <= post.length - 3; index += 1) {
    const [first, second, third] = [post[index], post[index + 1], post[index + 2]];
    if (first[1] >= baseline + 5 && second[1] >= baseline + 3 && third[1] >= baseline + 3) {
      rise = first;
      break;
    }
  }
  const bolus = boluses
    .filter((row) => row[0] >= minute - 60 && row[0] <= minute + 30 && Number(row[2]) > 0)
    .sort((a, b) => Math.abs(a[0] - minute) - Math.abs(b[0] - minute))[0] || null;
  const turn = sustainedDecline(post, peakRow);
  const complete = peakRows.length >= 18 && Boolean(two) && !overlapsPeakWindow;
  return {
    entry,
    minute,
    complete,
    status: complete ? 'complete' : overlapsPeakWindow ? 'overlapping-meal' : 'partial-analysis',
    baseline,
    minutesToRise: rise ? rise[0] - minute : null,
    peak: peakRow[1],
    minutesToPeak: peakRow[0] - minute,
    peakDelta: peakRow[1] - baseline,
    twoHour: two?.[1] ?? null,
    twoHourDelta: two ? two[1] - baseline : null,
    bolus,
    bolusOffset: bolus ? bolus[0] - minute : null,
    turnMinute: turn?.[0] ?? null,
    turnFromMeal: turn ? turn[0] - minute : null,
    turnFromBolus: turn && bolus ? turn[0] - bolus[0] : null,
  };
}

oracle.analysesFor = function hystereticTwoHourAnalyses(fixture) {
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

const baseExpectedRecommendations = oracle.expectedRecommendations;
oracle.expectedRecommendations = function expectedTwoHourPeakRecommendations(...args) {
  return baseExpectedRecommendations(...args).map((card) => {
    const finding = String(card.finding || '');
    if (!finding.includes('Peak-Anstieg')) return card;
    return {
      ...card,
      finding: finding
        .replace('Peak-Anstieg', '2-h-Peak-Anstieg')
        .replace(/ min\.$/, ' min innerhalb der ersten 120 Minuten.'),
    };
  });
};
