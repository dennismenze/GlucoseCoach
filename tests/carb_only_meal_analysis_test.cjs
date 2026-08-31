'use strict';

process.env.TZ = 'Europe/Berlin';

const assert = require('node:assert/strict');
const app = require('../docs/app-v3.js');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function meal(id, when, food = 'Apfel', carbs = '18') {
  return {
    id,
    when,
    occasion: 'Snack',
    food,
    carbs,
    fat: '',
    protein: '',
    fiber: '',
    activity: '',
    sleep: '',
    stress: '',
    illness: 'nein',
    notes: '',
  };
}

function lateMealCurve(when) {
  const start = minute(when);
  const rows = [
    [start - 60, 101, 0],
    [start - 30, 101, 0],
    [start - 15, 102, 0],
    [start - 10, 101, 0],
    [start - 5, 100, 0],
    [start, 100, 0],
  ];
  for (let offset = 5; offset <= 300; offset += 5) {
    const value = offset <= 205
      ? Math.round(100 + (123 * offset) / 205)
      : 223 - Math.round((offset - 205) * 0.8);
    rows.push([start + offset, value, 0]);
  }
  return rows;
}

const entry = meal('carb-only', '2026-08-19T07:30');
const start = minute(entry.when);
const correction = [start + 60, null, 0.6, 150, 'Korrektur'];
const carbOnly = app.analyzeMeals([entry], lateMealCurve(entry.when), [correction]);

assert.equal(carbOnly.length, 1);
assert.equal(carbOnly[0].complete, true);
assert.equal(carbOnly[0].peakComplete, true);
assert.equal(carbOnly[0].withoutMealInsulin, true);
assert.equal(carbOnly[0].bolus, null);
assert.equal(carbOnly[0].mealBolus, null);
assert.equal(carbOnly[0].peak, 223);
assert.equal(carbOnly[0].minutesToPeak, 205);
assert.equal(carbOnly[0].turnFromMeal, 205);
assert.equal(carbOnly[0].twoHour, 172);
assert.equal(carbOnly[0].correctionBolusCountBeforeTurn, 1);

const correctionOnly = app.analyzeMeals(
  [meal('no-carbs', '2026-08-20T07:30', 'ohne Bezeichnung', '')],
  lateMealCurve('2026-08-20T07:30'),
  [[minute('2026-08-20T07:30') + 10, null, 0.8, 160, 'Bolus']],
);
assert.deepEqual(correctionOnly, []);

const insufficientCgm = app.analyzeMeals(
  [meal('short', '2026-08-21T07:30')],
  [
    [minute('2026-08-21T07:30') - 5, 100, 0],
    [minute('2026-08-21T07:30') + 5, 108, 0],
    [minute('2026-08-21T07:30') + 10, 112, 0],
  ],
  [],
);
assert.deepEqual(insufficientCgm, []);

const importedStart = minute('2026-08-22T07:30');
const importedCarbs = app.analyzeMeals(
  [],
  lateMealCurve('2026-08-22T07:30'),
  [[importedStart, 20, null, null, '']],
);
assert.equal(importedCarbs.length, 1);
assert.equal(importedCarbs[0].entry.food, 'Glooko-Kohlenhydrate');
assert.equal(Number(importedCarbs[0].entry.carbs), 20);
assert.equal(importedCarbs[0].withoutMealInsulin, true);

const enrichedDirect = app.analyzeMealAdaptivePeak(
  meal('enriched-direct', '2026-08-22T07:30', 'Direkte KH-Zuordnung', ''),
  lateMealCurve('2026-08-22T07:30'),
  [[importedStart, 20, null, null, '']],
  null,
);
assert.equal(enrichedDirect.usableForMealAnalysis, true);
assert.equal(Number(enrichedDirect.entry.carbs), 20);
assert.equal(enrichedDirect.withoutMealInsulin, true);

const bolusedEntry = meal('bolused', '2026-08-23T07:30');
const bolusedStart = minute(bolusedEntry.when);
const mealBolus = [bolusedStart - 10, 18, 1.2, 100, 'Normal'];
const bolused = app.analyzeMeals([bolusedEntry], lateMealCurve(bolusedEntry.when), [mealBolus]);
assert.equal(bolused.length, 1);
assert.equal(bolused[0].withoutMealInsulin, false);
assert.equal(bolused[0].bolus[0], bolusedStart - 10);
assert.equal(bolused[0].bolus[2], 1.2);

const risingEntry = meal('no-turn', '2026-08-24T07:30');
const risingStart = minute(risingEntry.when);
const risingCgm = [];
for (let offset = -15; offset <= 300; offset += 5) {
  risingCgm.push([risingStart + offset, offset <= 0 ? 100 : 100 + Math.round(offset / 5), 0]);
}
const direct = app.analyzeMealAdaptivePeak(risingEntry, risingCgm, [], null);
assert.equal(direct.eligibleForMealAnalysis, true);
assert.equal(direct.usableForMealAnalysis, false);
assert.equal(direct.peakComplete, false);

const filteredGroups = app.buildFoodComparisons([
  carbOnly[0],
  {
    ...carbOnly[0],
    entry: { ...carbOnly[0].entry, id: 'carb-only-copy', food: 'Apfel' },
  },
  { ...direct, entry: { ...direct.entry, food: 'Apfel' } },
]);
assert.equal(filteredGroups.length, 1);
assert.equal(filteredGroups[0].entries, 2);
assert.equal(filteredGroups[0].analyzed, 2);

console.log('Carbohydrate-only meal and usable-list contracts passed');
