'use strict';

process.env.TZ = 'Europe/Berlin';

const assert = require('node:assert/strict');
const base = require('../docs/app-meal-management.js');
const app = require('../docs/app-v3.js');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function entry(id, when, occasion, food, carbs) {
  return { id, when, occasion, food, carbs: String(carbs) };
}

function lateMealBoundaryFixture() {
  const meal = minute('2026-08-21T14:45:00+02:00');
  const mealEntry = entry(
    'late-boundary-lunch',
    '2026-08-21T14:45',
    'Mittagessen',
    'Synthetisches Mittagessen',
    20.3,
  );
  const values = new Map([
    [-15, 100], [-10, 100], [-5, 100], [0, 100],
    [5, 104], [10, 110], [15, 118], [20, 126], [25, 134],
    [30, 140], [35, 145], [40, 149], [45, 152], [50, 154],
    [55, 156], [60, 158], [65, 159], [70, 160], [75, 161],
    [80, 162], [85, 163], [90, 164], [95, 165], [100, 166],
    [105, 167], [110, 168], [115, 169], [120, 170], [125, 171],
    [130, 172], [135, 171], [140, 168], [145, 164], [150, 159],
    [155, 154], [160, 149], [165, 145], [170, 142],
    [180, 145], [185, 150], [190, 156], [195, 162], [200, 168],
    [205, 174], [210, 180], [215, 186], [220, 192], [225, 198],
    [230, 204], [235, 210], [240, 214], [245, 218], [250, 222],
    [255, 225], [260, 228], [265, 231], [270, 234], [275, 237],
    [280, 240], [285, 243], [290, 246], [295, 249], [300, 252],
  ]);
  const cgm = [...values.entries()]
    .map(([offset, glucose]) => [meal + offset, glucose, 0])
    .sort((a, b) => a[0] - b[0]);
  const boluses = [
    [meal - 2, 20.3, 0.65, 100, 'Normal'],
    [meal + 175, 39.1, 0.9, 142, 'Normal'],
  ];
  return { mealEntry, cgm, boluses };
}

function observedWithoutTurnFixture() {
  const meal = minute('2026-08-24T08:00:00+02:00');
  const mealEntry = entry(
    'observed-no-turn',
    '2026-08-24T08:00',
    'Frühstück',
    'Synthetisches Frühstück',
    25,
  );
  const cgm = [];
  for (let offset = -15; offset <= 300; offset += 5) {
    const glucose = offset <= 0 ? 100 : 100 + Math.round(offset / 5);
    cgm.push([meal + offset, glucose, 0]);
  }
  return {
    mealEntry,
    cgm,
    boluses: [[meal - 5, 25, 1, 100, 'Normal']],
  };
}

function testLaterMealBolusTerminatesTheEarlierMeal() {
  const data = lateMealBoundaryFixture();
  const oldResult = base.analyzeMealAdaptivePeak(
    data.mealEntry,
    data.cgm,
    data.boluses,
    null,
  );
  assert.equal(oldResult.complete, false);
  assert.equal(oldResult.status, 'no-stable-decline');

  const result = app.analyzeMealAdaptivePeak(
    data.mealEntry,
    data.cgm,
    data.boluses,
    null,
  );
  assert.equal(result.complete, true);
  assert.equal(result.peakComplete, true);
  assert.equal(result.comparisonEligible, true);
  assert.equal(result.status, 'complete-before-following-meal-bolus');
  assert.equal(result.nextMealBolusFromMeal, 175);
  assert.equal(result.peak, 172);
  assert.equal(result.minutesToPeak, 130);
  assert.equal(result.peakFromBolus, 132);
  assert.equal(result.twoHour, 170);
}

function testUnreliableShortOverlapStaysPartial() {
  const result = app.makeObservedWindowComplete({
    complete: false,
    peakComplete: false,
    comparisonEligible: false,
    status: 'overlapping-meal',
    mealBolus: [1, 20, 1],
    twoHour: 180,
    twoHourFallback: true,
    twoHourFallbackAvailable: false,
    truncatedByNextMealBolus: true,
  });
  assert.equal(result.complete, false);
  assert.equal(result.status, 'overlapping-meal');
}

function testObservedMealWithoutTurnIsCompleteButNotComparable() {
  const data = observedWithoutTurnFixture();
  const oldResult = base.analyzeMealAdaptivePeak(
    data.mealEntry,
    data.cgm,
    data.boluses,
    null,
  );
  assert.equal(oldResult.complete, false);
  assert.equal(oldResult.status, 'no-stable-decline');
  assert.equal(oldResult.twoHourAvailable, true);

  const result = app.analyzeMealAdaptivePeak(
    data.mealEntry,
    data.cgm,
    data.boluses,
    null,
  );
  assert.equal(result.complete, true);
  assert.equal(result.peakComplete, false);
  assert.equal(result.comparisonEligible, false);
  assert.equal(result.status, 'complete-observed-window');
  assert.equal(result.twoHourAvailable, true);
}

testLaterMealBolusTerminatesTheEarlierMeal();
testObservedMealWithoutTurnIsCompleteButNotComparable();
testUnreliableShortOverlapStaysPartial();
console.log('Meal boundary contracts passed');
