'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const app = require(path.resolve(__dirname, '..', 'docs', 'app-meal-window.js'));
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
assert(foodCard.boundary.includes('nicht'));

console.log('Two-hour postprandial peak contract passed');
