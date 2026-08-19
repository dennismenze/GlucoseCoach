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
    illness: 'nein',
  },
  {
    id: 'fat-2',
    when: '2026-08-18T07:30',
    occasion: 'Frühstück',
    food: 'Fettreiches Testessen',
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
  [secondStart + 10, 40, 1.2, 100, 'Bolus'],
  [secondStart + 150, 0, 0.6, 220, 'Korrektur'],
];

const analyses = app.analyzeMeals(entries, cgm, boluses);
assert.equal(app.GC_TWO_HOUR_REFERENCE_MINUTES, 120);
assert.equal(app.GC_MEAL_CONTEXT_MINUTES, 300);
assert.equal(app.GC_DECLINE_CONFIRMATION_MINUTES, 20);
assert.equal(app.GC_DECLINE_DROP_MGDL, 8);
assert.equal(app.GC_DECLINE_REBOUND_TOLERANCE_MGDL, 3);
assert.equal(analyses.length, 2);

const late = analyses[0];
assert.equal(late.complete, true);
assert.equal(late.peak, 223);
assert.equal(late.minutesToPeak, 205, 'peak may occur after three hours');
assert.equal(late.peakFromBolus, 195);
assert.equal(late.turnFromMeal, 205);
assert.equal(late.turnFromBolus, 195);
assert.equal(late.bolus[0], firstStart + 10);
assert.equal(late.twoHour, 172);
assert.equal(late.turnAfterPeak, true);

const split = analyses[1];
assert.equal(split.complete, true);
assert.equal(split.bolusCountBeforeTurn, 2);
assert.equal(split.bolus[0], secondStart + 150, 'latest bolus before decline is authoritative');
assert.equal(split.peak, 230, 'earlier higher peak before the last bolus must be ignored');
assert.equal(split.minutesToPeak, 220);
assert.equal(split.peakFromBolus, 70);
assert.equal(split.turnFromMeal, 220);
assert.equal(split.turnFromBolus, 70);
assert.equal(split.turnAfterPeak, true);

const groups = app.buildFoodComparisons(analyses);
assert.equal(groups.length, 1);
assert.equal(groups[0].label, 'Fettreiches Testessen');
assert.equal(groups[0].analyzed, 2);
assert.equal(groups[0].medianPeakDelta, 127);
assert.equal(groups[0].medianMinutesToPeak, 213);
assert.equal(groups[0].medianMinutesBolusToPeak, 133);
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
assert(foodCard.finding.includes('213 min ab Essen'));
assert(foodCard.finding.includes('133 min nach dem letzten Bolus'));
assert(foodCard.boundary.includes('Weitere Boli setzen den Peak-Start neu'));
assert(foodCard.boundary.includes('keine Dosisempfehlung'));

const noBolusEntry = {
  id: 'no-bolus',
  when: '2026-08-19T07:30',
  occasion: 'Frühstück',
  food: 'Ohne Bolus',
  illness: 'nein',
};
const noBolus = app.analyzeMeals([noBolusEntry], lateFatCurve(noBolusEntry.when), [])[0];
assert.equal(noBolus.complete, false);
assert.equal(noBolus.status, 'missing-bolus');
assert.equal(noBolus.peak, null);

const overlapEntries = [
  {
    id: 'overlap-1',
    when: '2026-08-20T07:30',
    occasion: 'Frühstück',
    food: 'Erste Mahlzeit',
    illness: 'nein',
  },
  {
    id: 'overlap-2',
    when: '2026-08-20T10:30',
    occasion: 'Snack',
    food: 'Neue Mahlzeit',
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

console.log('Adaptive postprandial peak and sustained-decline contracts passed');
