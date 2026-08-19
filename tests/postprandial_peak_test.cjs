'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const app = require(path.resolve(__dirname, '..', 'docs', 'app-v3.js'));
const minute = (iso) => Math.round(new Date(iso).getTime() / 60_000);

function mealCurve(when, options) {
  const start = minute(when);
  const baseline = options.baseline;
  const rows = [
    [start - 15, baseline + 2, 0],
    [start - 10, baseline + 1, 0],
    [start - 5, baseline, 0],
    [start, baseline, 0],
  ];

  for (let offset = 5; offset <= 180; offset += 5) {
    let value;
    if (offset <= options.peakOffset) {
      value = Math.round(
        baseline + (options.peak - baseline) * (offset / options.peakOffset),
      );
    } else if (offset <= 120) {
      value = Math.round(
        options.peak - (options.peak - options.twoHour) *
          ((offset - options.peakOffset) / (120 - options.peakOffset)),
      );
    } else {
      value = options.twoHour - Math.round((offset - 120) / 10);
    }
    if (offset === options.peakOffset) value = options.peak;
    if (offset === 120) value = options.twoHour;
    if (offset === options.lateOffset) value = options.latePeak;
    rows.push([start + offset, value, 0]);
  }
  return rows;
}

function explicitCurve(when, values) {
  const start = minute(when);
  const rows = [
    [start - 15, 102, 0],
    [start - 10, 101, 0],
    [start - 5, 100, 0],
    [start, 100, 0],
  ];
  for (let offset = 5; offset <= 180; offset += 5) {
    rows.push([start + offset, values[offset] ?? 100, 0]);
  }
  return rows;
}

const entries = [
  {
    id: 'oat-1',
    when: '2026-08-17T07:30',
    occasion: 'Frühstück',
    food: 'Hafermilch',
    illness: 'nein',
  },
  {
    id: 'oat-2',
    when: '2026-08-18T07:30',
    occasion: 'Frühstück',
    food: 'Hafermilch',
    illness: 'nein',
  },
];

const cgm = [
  ...mealCurve(entries[0].when, {
    baseline: 100,
    peak: 170,
    peakOffset: 95,
    twoHour: 150,
    latePeak: 240,
    lateOffset: 175,
  }),
  ...mealCurve(entries[1].when, {
    baseline: 100,
    peak: 160,
    peakOffset: 110,
    twoHour: 145,
    latePeak: 250,
    lateOffset: 180,
  }),
].sort((a, b) => a[0] - b[0]);

const analyses = app.analyzeMeals(entries, cgm, []);
assert.equal(app.GC_POSTPRANDIAL_PEAK_MINUTES, 120);
assert.equal(analyses.length, 2);
assert.equal(analyses[0].complete, true);
assert.equal(analyses[0].peak, 170);
assert.equal(analyses[0].minutesToPeak, 95);
assert.equal(analyses[0].peakDelta, 70);
assert.equal(analyses[0].twoHour, 150);
assert.equal(analyses[1].peak, 160);
assert.equal(analyses[1].minutesToPeak, 110);
assert.equal(analyses[1].peakDelta, 60);
assert.equal(analyses[1].twoHour, 145);
assert(!analyses.some((analysis) => analysis.peak === 240 || analysis.peak === 250));
assert(analyses.every((analysis) => analysis.minutesToPeak <= 120));

const groups = app.buildFoodComparisons(analyses);
assert.equal(groups.length, 1);
assert.equal(groups[0].label, 'Hafermilch');
assert.equal(groups[0].analyzed, 2);
assert.equal(groups[0].medianPeakDelta, 65);
assert.equal(groups[0].medianMinutesToPeak, 103);
assert.equal(groups[0].medianTwoHourDelta, 48);
assert.equal(groups[0].peakWindowMinutes, 120);

const cards = app.buildRecommendations({
  diary: entries,
  analyses,
  foodGroups: groups,
  cgmRows: cgm,
  metrics: app.calculateMetrics(cgm),
});
const foodCard = cards.find((card) => card.title.includes('Hafermilch'));
assert(foodCard, 'expected a Hafermilch comparison recommendation');
assert(foodCard.finding.includes('2-h-Peak-Anstieg'));
assert(foodCard.finding.includes('ersten 120 Minuten'));
assert(foodCard.boundary.includes('zeitlich'));
assert(foodCard.boundary.includes('keine Dosisempfehlung'));

const turnEntry = {
  id: 'turn-1',
  when: '2026-08-19T07:30',
  occasion: 'Frühstück',
  food: 'Hafermilch mit lokalem Dip',
  illness: 'nein',
};
const turnStart = minute(turnEntry.when);
const turnValues = {
  5: 108, 10: 118, 15: 128, 20: 135, 25: 130, 30: 127,
  35: 140, 40: 145, 45: 150, 50: 154, 55: 156, 60: 158,
  65: 159, 70: 160, 75: 161, 80: 158, 85: 155, 90: 151,
  95: 147, 100: 143, 105: 139, 110: 135, 115: 131, 120: 127,
  125: 123, 130: 119, 135: 115, 140: 111, 145: 107, 150: 103,
  155: 99, 160: 95, 165: 91, 170: 87, 175: 83, 180: 79,
};
const turnAnalysis = app.analyzeMeals(
  [turnEntry],
  explicitCurve(turnEntry.when, turnValues),
  [[turnStart + 19, 5.9, 0.2, 125, 'Bolus']],
)[0];
assert.equal(app.GC_DECLINE_CONFIRMATION_MINUTES, 20);
assert.equal(app.GC_DECLINE_DROP_MGDL, 8);
assert.equal(app.GC_DECLINE_REBOUND_TOLERANCE_MGDL, 3);
assert.equal(turnAnalysis.minutesToPeak, 75);
assert.equal(turnAnalysis.turnFromMeal, 75);
assert.equal(turnAnalysis.turnFromBolus, 56);
assert.equal(turnAnalysis.turnAfterPeak, true);
assert(turnAnalysis.turnMinute >= turnStart + turnAnalysis.minutesToPeak);
assert.equal(app.formatOffset(turnAnalysis.turnFromMeal, 'Essen'), '75 min nach Essen');
assert.equal(app.formatOffset(turnAnalysis.turnFromBolus, 'Bolus'), '56 min nach Bolus');

const reboundEntry = {
  id: 'turn-2',
  when: '2026-08-20T07:30',
  occasion: 'Frühstück',
  food: 'Hafermilch mit spätem Rebound',
  illness: 'nein',
};
const reboundValues = {
  ...turnValues,
  130: 166, 135: 162, 140: 158, 145: 154, 150: 150,
  155: 146, 160: 142, 165: 138, 170: 134, 175: 130, 180: 126,
};
const reboundAnalysis = app.analyzeMeals(
  [reboundEntry],
  explicitCurve(reboundEntry.when, reboundValues),
  [],
)[0];
assert.equal(reboundAnalysis.minutesToPeak, 75);
assert.equal(reboundAnalysis.turnFromMeal, 130);
assert.equal(reboundAnalysis.turnAfterPeak, true);

const overlappingEntries = [
  { ...turnEntry, id: 'overlap-1', when: '2026-08-21T07:30' },
  { ...turnEntry, id: 'overlap-2', when: '2026-08-21T09:00', occasion: 'Snack' },
];
const overlapCgm = explicitCurve(overlappingEntries[0].when, turnValues);
const overlapAnalysis = app.analyzeMeals(overlappingEntries, overlapCgm, [])[0];
assert.equal(overlapAnalysis.complete, false);
assert.equal(overlapAnalysis.status, 'overlapping-meal');
assert.equal(overlapAnalysis.truncatedByNextMeal, true);

console.log('Two-hour postprandial peak and sustained-decline contract passed');
