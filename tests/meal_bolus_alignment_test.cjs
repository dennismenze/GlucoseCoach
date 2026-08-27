'use strict';

const assert = require('node:assert/strict');
const {
  buildMealBolusAlignmentInsights,
  aggregateEarlyEffect,
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

const earlyEffect = {
  aggregate: {
    sufficient: true,
    confidence: 'hoch',
    onset: { n: 33, median: 24, q1: 18, q3: 36 },
  },
};

const insights = buildMealBolusAlignmentInsights(analyses, earlyEffect);
assert.equal(insights.length, 1);
assert.equal(insights[0].label, 'Käsespätzle');
assert.equal(insights[0].alignment.available, true);
assert.equal(insights[0].alignment.rise.median, 11);
assert.equal(insights[0].alignment.earlyEffect.median, 24);
assert.equal(insights[0].alignment.offsetMinutes, -13);
assert.equal(insights[0].alignment.label, '13 Min. vor dem Essen');
assert.equal(insights[0].alignment.observedConsistent, true);
assert.equal(insights[0].best.key, 'before');
assert.equal(insights[0].best.medianPeakDelta, 26);
const rendered = renderAlignmentInsight(insights[0]);
assert.match(
  rendered,
  /Geschätzter Mahlzeitenbolus: 13 Min\. vor dem Essen\./,
);
assert.match(rendered, /früheste erkennbare Nettoeffekt/);
assert.doesNotMatch(rendered, /spätere Abflachung|65 Min|isolierte Korrekturverläufe/);

const insufficientEffect = buildMealBolusAlignmentInsights(analyses, {
  aggregate: {
    sufficient: false,
    confidence: 'nicht ausreichend',
    onset: { n: 2, median: 24, q1: 20, q3: 28 },
  },
});
assert.equal(insufficientEffect[0].alignment.available, false);
assert.equal(insufficientEffect[0].alignment.reason, 'early-effect-unavailable');
const insufficientRendered = renderAlignmentInsight(insufficientEffect[0]);
assert.match(insufficientRendered, /bis 75 Minuten nach dem Bolus/);
assert.doesNotMatch(insufficientRendered, /fünfstündige Isolation/);

const parsedEffect = aggregateEarlyEffect(earlyEffect);
assert.deepEqual(parsedEffect, {
  sufficient: true,
  n: 33,
  median: 24,
  q1: 18,
  q3: 36,
  confidence: 'hoch',
});

const lateSlowdownMustNotBeUsed = buildMealBolusAlignmentInsights(analyses, {
  aggregate: {
    sufficient: true,
    confidence: 'hoch',
    onset: { n: 12, median: 24, q1: 18, q3: 36 },
    slowdown: { n: 292, median: 65, q1: 45, q3: 84 },
  },
});
assert.equal(lateSlowdownMustNotBeUsed[0].alignment.offsetMinutes, -13);

console.log('meal bolus alignment tests passed');
