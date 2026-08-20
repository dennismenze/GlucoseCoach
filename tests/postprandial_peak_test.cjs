'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const app = require(path.resolve(__dirname, '..', 'docs', 'app-meal-window.js'));
const minute = (iso) => Math.round(new Date(iso).getTime() / 60_000);

function curve(when, valueAtOffset) {
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
    rows.push([start + offset, valueAtOffset(offset), 0]);
  }
  return rows;
}

function lateFatCurve(when) {
  return curve(when, (offset) => {
    if (offset <= 205) return Math.round(100 + (123 * offset) / 205);
    return 223 - Math.round((offset - 205) * 0.8);
  });
}

function splitBolusCurve(when) {
  return curve(when, (offset) => {
    if (offset <= 120) return Math.round(100 + (140 * offset) / 120);
    if (offset <= 145) return 240 - Math.round((offset - 120) * 0.8);
    if (offset === 150) return 220;
    if (offset === 155) return 216;
    if (offset === 160) return 212;
    if (offset === 165) return 218;
    if (offset <= 220) return Math.round(218 + (12 * (offset - 165)) / 55);
    return 230 - Math.round((offset - 220) * 0.8);
  });
}

const entries = [
  {
    id: 'fat-1',
    when: '2026-08-17T07:30',
    occasion: 'Frühstück',
    food: 'Fettreiches Testessen',
    carbs: '40',
    illness: 'nein',
  },
  {
    id: 'fat-2',
    when: '2026-08-18T07:30',
    occasion: 'Frühstück',
    food: 'Fettreiches Testessen',
    carbs: '40',
    illness: 'nein',
  },
];

const firstStart = minute(entries[0].when);
const secondStart = minute(entries[1].when);
const cgm = [
  ...lateFatCurve(entries[0].when),
  ...splitBolusCurve(entries[1].when),
].sort((a, b) => a[0] - b[0]);
const boluses = [
  [firstStart + 10, 40, 1.2, 100, 'Bolus'],
  [firstStart + 120, 0, 0.5, 170, 'Korrektur'],
  [secondStart + 10, 40, 1.2, 100, 'Bolus'],
  [secondStart + 90, 0, 0.4, 205, 'Korrektur'],
  [secondStart + 150, 0, 0.6, 220, 'Korrektur'],
];

const analyses = app.analyzeMeals(entries, cgm, boluses);
assert.equal(app.GC_TWO_HOUR_REFERENCE_MINUTES, 120);
assert.equal(app.GC_MEAL_CONTEXT_MINUTES, 300);
assert.equal(app.GC_MEAL_BOLUS_ASSOCIATION_MINUTES, 60);
assert.equal(app.GC_DECLINE_CONFIRMATION_MINUTES, 20);
assert.equal(app.GC_DECLINE_DROP_MGDL, 8);
assert.equal(app.GC_DECLINE_REBOUND_TOLERANCE_MGDL, 3);
assert.equal(analyses.length, 2);

const late = analyses[0];
assert.equal(late.complete, true);
assert.equal(late.bolus[0], firstStart + 10, 'meal bolus remains authoritative');
assert.equal(late.bolusCountBeforeTurn, 2);
assert.equal(late.ignoredBolusCountBeforeTurn, 1);
assert.equal(late.peak, 223);
assert.equal(late.minutesToPeak, 205, 'peak may occur after three hours');
assert.equal(late.peakFromBolus, 195);
assert.equal(late.turnFromMeal, 205);
assert.equal(late.turnFromBolus, 195);
assert.equal(late.twoHour, 172);
assert.equal(late.turnAfterPeak, true);

const split = analyses[1];
assert.equal(split.complete, true);
assert.equal(split.bolus[0], secondStart + 10, 'later correction boluses must not replace meal bolus');
assert.equal(split.bolusCountBeforeTurn, 2);
assert.equal(split.ignoredBolusCountBeforeTurn, 1);
assert.equal(split.peak, 240, 'the actual meal peak before a later correction must be retained');
assert.equal(split.minutesToPeak, 120);
assert.equal(split.peakFromBolus, 110);
assert.equal(split.turnFromMeal, 120, 'a later correction must not postpone decline search');
assert.equal(split.turnFromBolus, 110);
assert.equal(split.turnAfterPeak, true);

const groups = app.buildFoodComparisons(analyses);
assert.equal(groups.length, 1);
assert.equal(groups[0].label, 'Fettreiches Testessen');
assert.equal(groups[0].analyzed, 2);
assert.equal(groups[0].medianPeakDelta, 132);
assert.equal(groups[0].medianMinutesToPeak, 163);
assert.equal(groups[0].medianMinutesBolusToPeak, 153);
assert.equal(groups[0].medianTwoHourDelta, 106);
assert.equal(groups[0].peakContextMinutes, 300);

const cards = app.buildRecommendations({
  diary: entries,
  analyses,
  foodGroups: groups,
  cgmRows: cgm,
  metrics: app.calculateMetrics(cgm),
});
const foodCard = cards.find((card) => card.title.includes('Fettreiches Testessen'));
assert(foodCard, 'expected repeated food comparison recommendation');
assert(foodCard.finding.includes('163 min ab Essen'));
assert(foodCard.finding.includes('153 min nach dem Mahlzeitenbolus'));
assert(foodCard.boundary.includes('starten den Peak nicht neu'));
assert(foodCard.boundary.includes('mögliche Korrekturen'));
assert(foodCard.boundary.includes('keine Dosisempfehlung'));

const noBolusEntry = {
  id: 'no-bolus',
  when: '2026-08-19T07:30',
  occasion: 'Frühstück',
  food: 'Ohne Bolus',
  carbs: '40',
  illness: 'nein',
};
const noBolus = app.analyzeMeals([noBolusEntry], lateFatCurve(noBolusEntry.when), [])[0];
assert.equal(noBolus.complete, false);
assert.equal(noBolus.status, 'missing-bolus');
assert.equal(noBolus.peak, null);

const correctionOnlyStart = minute(noBolusEntry.when);
const correctionOnly = app.analyzeMeals(
  [noBolusEntry],
  lateFatCurve(noBolusEntry.when),
  [[correctionOnlyStart + 20, 0, 0.6, 150, 'Korrektur']],
)[0];
assert.equal(correctionOnly.complete, false);
assert.equal(correctionOnly.status, 'missing-meal-bolus');
assert.equal(correctionOnly.bolus, null);
assert.equal(correctionOnly.peak, null);

const lateBolusOnly = app.analyzeMeals(
  [noBolusEntry],
  lateFatCurve(noBolusEntry.when),
  [[correctionOnlyStart + 120, 0, 0.6, 170, 'Bolus']],
)[0];
assert.equal(lateBolusOnly.complete, false);
assert.equal(lateBolusOnly.status, 'missing-meal-bolus');
assert.equal(lateBolusOnly.bolus, null);

const overlapEntries = [
  {
    id: 'overlap-1',
    when: '2026-08-20T07:30',
    occasion: 'Frühstück',
    food: 'Erste Mahlzeit',
    carbs: '40',
    illness: 'nein',
  },
  {
    id: 'overlap-2',
    when: '2026-08-20T10:30',
    occasion: 'Snack',
    food: 'Neue Mahlzeit',
    carbs: '20',
    illness: 'nein',
  },
];
const overlapStart = minute(overlapEntries[0].when);
const overlap = app.analyzeMeals(
  overlapEntries,
  lateFatCurve(overlapEntries[0].when),
  [[overlapStart + 10, 40, 1.2, 100, 'Bolus']],
)[0];
assert.equal(overlap.complete, false);
assert.equal(overlap.status, 'overlapping-meal');
assert.equal(overlap.truncatedByNextMeal, true);

console.log('Adaptive postprandial peak and correction-bolus contracts passed');
