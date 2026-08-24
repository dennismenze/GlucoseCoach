'use strict';

process.env.TZ = 'Europe/Berlin';

const assert = require('node:assert/strict');
const overlap = require('../docs/app-meal-overlap-fallback.js');
const managed = require('../docs/app-meal-management.js');

const MINUTE_MS = 60_000;

function minute(year, monthIndex, day, hour, minuteValue) {
  return Math.round(new Date(year, monthIndex, day, hour, minuteValue).getTime() / MINUTE_MS);
}

function completeOverlapFixture() {
  const mealMinute = minute(2026, 7, 1, 8, 0);
  const entry = {
    id: 'complete-overlap',
    when: '2026-08-01T08:00',
    occasion: 'Frühstück',
    food: 'Banane',
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
    [mealMinute + 90, 35, 3, 166, 'Normal'],
  ];
  return { entry, cgm, boluses };
}

function censoredOverlapFixture() {
  const mealMinute = minute(2026, 7, 2, 8, 0);
  const entry = {
    id: 'censored-overlap',
    when: '2026-08-02T08:00',
    occasion: 'Snack',
    food: 'Banane',
    carbs: '20',
  };
  const values = new Map([
    [-15, 88], [-10, 88], [-5, 88], [0, 88], [5, 89], [10, 94],
    [15, 99], [20, 104], [25, 109], [30, 113], [35, 117], [40, 120],
    [45, 122], [50, 124], [55, 126], [60, 127], [65, 128], [70, 129],
    [75, 130], [80, 131], [85, 131], [90, 132],
  ]);
  const cgm = [...values.entries()]
    .map(([offset, value]) => [mealMinute + offset, value, 0])
    .sort((a, b) => a[0] - b[0]);
  const boluses = [
    [mealMinute - 1, 20, 0.15, 88, 'Normal'],
    [mealMinute + 91, 35, 2.5, 132, 'Normal'],
  ];
  return { entry, cgm, boluses };
}

function testCensoredOverlapIsCompleteButNotPeakComparable() {
  const data = censoredOverlapFixture();
  const oldResult = overlap.analyzeMealAdaptivePeak(data.entry, data.cgm, data.boluses, null);
  assert.equal(oldResult.complete, false);
  assert.equal(oldResult.status, 'overlapping-meal');
  assert.equal(oldResult.turnMinute, null);
  assert.equal(oldResult.twoHourFallbackAvailable, true);

  const result = managed.analyzeMealAdaptivePeak(data.entry, data.cgm, data.boluses, null);
  assert.equal(result.complete, true);
  assert.equal(result.status, 'complete-overlap-censored');
  assert.equal(result.peakComplete, false);
  assert.equal(result.comparisonEligible, false);
  assert.equal(result.turnCensoredByNextMealBolus, true);
  assert.equal(result.turnMinute, null);
  assert.equal(result.nextMealBolusFromMeal, 91);
  assert.equal(result.twoHour, 132);
  assert.equal(result.twoHourFallbackObservedFromMeal, 90);
  assert.match(managed.censoredTurnText(result), /2-h-Marke wurde nicht erreicht/);

  const completeData = completeOverlapFixture();
  const complete = managed.analyzeMealAdaptivePeak(
    completeData.entry,
    completeData.cgm,
    completeData.boluses,
    null,
  );
  assert.equal(complete.complete, true);
  assert.equal(complete.peakComplete, true);

  const groups = managed.buildFoodComparisons([complete, result]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entries, 2);
  assert.equal(groups[0].analyzed, 1);
  assert.equal(groups[0].twoHourFallbackCount, 1);
}

function testComparableMealNamesCanBeMerged() {
  const entries = [
    {
      id: 'a', occasion: 'Frühstück',
      food: 'Müsli mit Bananen und Himbeeren', carbs: '42',
    },
    {
      id: 'b', occasion: 'Frühstück',
      food: 'Müsli mit Himbeer und Banane', carbs: '39',
    },
    {
      id: 'sport', occasion: 'Sport', food: 'Müsli', activity: '30 min',
    },
    {
      id: 'glooko', occasion: 'Snack', food: 'Banane', source: 'glooko', readOnly: true,
    },
  ];

  const result = managed.mergeMealEntries(
    entries,
    ['a', 'b', 'sport', 'glooko'],
    '  Müsli mit Banane und Himbeeren  ',
  );

  assert.equal(result.applied, true);
  assert.equal(result.selected, 2);
  assert.equal(result.changed, 2);
  assert.equal(result.name, 'Müsli mit Banane und Himbeeren');
  assert.equal(result.entries[0].food, result.name);
  assert.equal(result.entries[1].food, result.name);
  assert.equal(result.entries[0].carbs, '42');
  assert.equal(result.entries[1].carbs, '39');
  assert.equal(result.entries[2], entries[2]);
  assert.equal(result.entries[3], entries[3]);
  assert.equal(entries[0].food, 'Müsli mit Bananen und Himbeeren', 'input must not be mutated');

  const insufficient = managed.mergeMealEntries(entries, ['a'], 'Müsli');
  assert.equal(insufficient.applied, false);
  assert.equal(insufficient.reason, 'select-at-least-two');
}

testCensoredOverlapIsCompleteButNotPeakComparable();
testComparableMealNamesCanBeMerged();
console.log('Meal management contracts passed');
