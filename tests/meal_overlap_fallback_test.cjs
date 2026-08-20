'use strict';

process.env.TZ = 'Europe/Berlin';

const assert = require('node:assert/strict');
const base = require('../docs/app-meal-window.js');
const patched = require('../docs/app-meal-overlap-fallback.js');

const MINUTE_MS = 60_000;

function minute(year, monthIndex, day, hour, minuteValue) {
  return Math.round(new Date(year, monthIndex, day, hour, minuteValue).getTime() / MINUTE_MS);
}

function fixture(secondBolusCarbs = 35) {
  const mealMinute = minute(2026, 7, 1, 8, 0);
  const entry = {
    when: '2026-08-01T08:00',
    occasion: 'Frühstück',
    food: 'Hafermilch',
    carbs: '20',
  };
  const values = new Map([
    [-15, 100], [-10, 100], [-5, 100], [0, 100], [5, 105], [10, 112],
    [15, 120], [20, 130], [25, 140], [30, 150], [35, 158], [40, 162],
    [45, 165], [50, 166], [55, 166], [60, 165], [65, 162], [70, 158],
    [75, 152], [80, 146], [85, 140],
  ]);
  const cgm = [...values.entries()]
    .map(([offset, value]) => [mealMinute + offset, value, 0])
    .sort((a, b) => a[0] - b[0]);
  const boluses = [
    [mealMinute - 10, 20, 2, 100, 'Normal'],
    [mealMinute + 90, secondBolusCarbs, 3, 166, 'Normal'],
  ];
  return { mealMinute, entry, cgm, boluses };
}

function testMealBolusCreatesFallbackReference() {
  const data = fixture(35);
  const oldResult = base.analyzeMealAdaptivePeak(
    data.entry,
    data.cgm,
    data.boluses,
    null,
  );
  assert.equal(oldResult.complete, false);
  assert.equal(oldResult.twoHour ?? null, null);

  const result = patched.analyzeMealAdaptivePeak(
    data.entry,
    data.cgm,
    data.boluses,
    null,
  );
  assert.equal(result.complete, true);
  assert.equal(result.status, 'complete-overlap-fallback');
  assert.equal(result.twoHourFallback, true);
  assert.equal(result.twoHourFallbackAvailable, true);
  assert.equal(result.twoHour, 166);
  assert.equal(result.twoHourDelta, 66);
  assert.equal(result.nextMealBolusFromMeal, 90);
  assert.equal(result.twoHourFallbackObservedFromMeal, 50);
  assert.ok(result.turnMinute < data.mealMinute + 90);

  const groups = patched.buildFoodComparisons([
    result,
    {
      ...result,
      entry: { ...result.entry, when: '2026-08-02T08:00' },
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entries, 2);
  assert.equal(groups[0].analyzed, 2);
  assert.equal(groups[0].twoHourFallbackCount, 2);
  assert.equal(groups[0].medianTwoHourDelta, 66);
}

function testCorrectionBolusDoesNotCutOffTwoHourReference() {
  const data = fixture(0);
  const result = patched.analyzeMealAdaptivePeak(
    data.entry,
    data.cgm,
    data.boluses,
    null,
  );
  assert.equal(result.twoHourFallback, undefined);
  assert.equal(result.complete, false);
}

testMealBolusCreatesFallbackReference();
testCorrectionBolusDoesNotCutOffTwoHourReference();
console.log('Meal-overlap two-hour fallback contracts passed');
