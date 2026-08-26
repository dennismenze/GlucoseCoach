'use strict';

const assert = require('node:assert/strict');
const {
  buildMealBolusAlignmentInsights,
  aggregateInsulinOnset,
  formatBolusTiming,
  formatBolusTimingRange,
  renderAlignmentInsight,
} = require('../docs/app-meal-bolus-alignment.js');

assert.equal(formatBolusTiming(-14), '14 Min. vor dem Essen');
assert.equal(formatBolusTiming(0), 'zum Essensbeginn');
assert.equal(formatBolusTiming(6), '6 Min. nach Essensbeginn');
assert.equal(formatBolusTimingRange(-18, -9), '9–18 Min. vor dem Essen');
assert.equal(formatBolusTimingRange(-4, 3), '4 Min. vorher bis 3 Min. danach');

const analyses = [
  {
    complete: true,
    entry: { food: 'Käsespätzle' },
    minute: 1000,
    bolusOffset: -16,
    minutesToRise: 10,
    peakDelta: 28,
    twoHourDelta: 8,
  },
  {
    complete: true,
    entry: { food: 'käsespätzle ' },
    minute: 2000,
    bolusOffset: -13,
    minutesToRise: 11,
    peakDelta: 24,
    twoHourDelta: 6,
  },
  {
    complete: true,
    entry: { food: 'Käsespätzle' },
    minute: 3000,
    bolusOffset: 0,
    minutesToRise: 11,
    peakDelta: 47,
    twoHourDelta: 19,
  },
  {
    complete: true,
    entry: { food: 'Käsespätzle' },
    minute: 4000,
    bolusOffset: 3,
    minutesToRise: 12,
    peakDelta: 51,
    twoHourDelta: 22,
  },
];

const insulinAction = {
  aggregate: {
    sufficient: true,
    confidence: 'mittel',
    onset: { n: 7, median: 25, q1: 22, q3: 28 },
  },
};

const insights = buildMealBolusAlignmentInsights(analyses, insulinAction);
assert.equal(insights.length, 1);
assert.equal(insights[0].label, 'Käsespätzle');
assert.equal(insights[0].alignment.available, true);
assert.equal(insights[0].alignment.rise.median, 11);
assert.equal(insights[0].alignment.onset.median, 25);
assert.equal(insights[0].alignment.offsetMinutes, -14);
assert.equal(insights[0].alignment.label, '14 Min. vor dem Essen');
assert.equal(insights[0].alignment.observedConsistent, true);
assert.equal(insights[0].best.key, 'before');
assert.equal(insights[0].best.medianPeakDelta, 26);
const rendered = renderAlignmentInsight(insights[0]);
assert.match(
  rendered,
  /Geschätzter günstiger Boluszeitpunkt: 14 Min\. vor dem Essen\./,
);
assert.match(rendered, /geschätzte Wirkeintritt rechnerisch ungefähr/);

const insufficientOnset = buildMealBolusAlignmentInsights(analyses, {
  aggregate: {
    sufficient: false,
    confidence: 'nicht ausreichend',
    onset: { n: 2, median: 25, q1: 20, q3: 30 },
  },
});
assert.equal(insufficientOnset[0].alignment.available, false);
assert.equal(insufficientOnset[0].alignment.reason, 'insulin-onset-unavailable');

const parsedOnset = aggregateInsulinOnset(insulinAction);
assert.deepEqual(parsedOnset, {
  sufficient: true,
  n: 7,
  median: 25,
  q1: 22,
  q3: 28,
  confidence: 'mittel',
});

console.log('meal bolus alignment tests passed');
