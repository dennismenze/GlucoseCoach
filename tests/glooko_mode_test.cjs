'use strict';

const assert = require('node:assert/strict');
const mode = require('../docs/app-glooko-mode.js');

const minute = (iso) => Math.round(new Date(iso).getTime() / 60_000);
const breakfast = minute('2026-08-17T09:00:00');
const lunch = minute('2026-08-17T13:00:00');

const clinical = {
  foodEvents: [
    [breakfast, 'Haferflocken', 35, 7, 8, 230, 'Schale', 1],
    [breakfast, 'Hafermilch', 10, 2, 1, 60, 'Glas', 1],
  ],
  cgmCarbs: [
    [breakfast, 45],
    [lunch, 30],
  ],
};

const meals = mode.buildGlookoMealEntries(clinical);
assert.equal(meals.length, 2);
assert.equal(meals[0].occasion, 'Frühstück');
assert.equal(meals[0].food, 'Haferflocken + Hafermilch');
assert.equal(meals[0].carbs, 45, 'duplicated cgmCarbs must not be added twice');
assert.equal(meals[0].fat, 9);
assert.equal(meals[0].protein, 9);
assert.equal(meals[0].calories, 290);
assert.equal(meals[0].source, 'glooko');
assert.equal(meals[0].readOnly, true);
assert.equal(meals[1].occasion, 'Mittagessen');
assert.equal(meals[1].food, 'Glooko-Kohlenhydrate');
assert.equal(meals[1].carbs, 30);

const localDiary = [
  {
    id: 'local-meal',
    when: mode.localDateTimeValue(breakfast),
    occasion: 'Frühstück',
    food: 'lokal benannt',
    carbs: '45',
  },
  {
    id: 'local-sport',
    when: mode.localDateTimeValue(breakfast + 180),
    occasion: 'Sport',
    activity: 'Spaziergang',
  },
];

assert.equal(mode.resolveMealSource(localDiary, clinical, null), mode.SOURCE_COMBINED);
assert.equal(mode.resolveMealSource([], clinical, null), mode.SOURCE_COMBINED);
assert.equal(
  mode.resolveMealSource(localDiary, clinical, mode.SOURCE_GLOOKO),
  mode.SOURCE_COMBINED,
);

const additional = mode.buildAdditionalGlookoMealEntries(localDiary, clinical);
assert.equal(additional.length, 1);
assert.equal(additional[0].food, 'Glooko-Kohlenhydrate');
assert(mode.isDuplicateMeal(localDiary[0], meals[0]));

const analysisDiary = mode.buildAnalysisDiary(localDiary, clinical, mode.SOURCE_GLOOKO);
assert.equal(analysisDiary.length, 3);
assert(analysisDiary.some((entry) => entry.id === 'local-meal'));
assert(analysisDiary.some((entry) => entry.id === 'local-sport'));
assert.equal(analysisDiary.filter((entry) => entry.source === 'glooko').length, 1);
assert(!analysisDiary.some((entry) => entry.id === meals[0].id));

const onlyGlooko = mode.buildAnalysisDiary([], clinical, mode.SOURCE_LOCAL);
assert.equal(onlyGlooko.length, 2);
assert.equal(onlyGlooko.filter((entry) => entry.source === 'glooko').length, 2);

assert.equal(mode.MEAL_SOURCE_KEY, 'glucosecoach-meal-source-v1');
assert.equal(mode.GLOOKO_CARBS_ASSOCIATION_MINUTES, 10);
assert.equal(mode.DUPLICATE_MEAL_WINDOW_MINUTES, 10);
console.log('Combined local and Glooko meal contracts passed');
