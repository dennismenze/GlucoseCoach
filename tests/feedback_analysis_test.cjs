'use strict';
const assert = require('node:assert/strict');
const {
  buildMealTimingInsights,
  buildNightRiseAnalysis,
  timingBucket,
} = require('../docs/app-feedback-ui.js');

assert.equal(timingBucket(-15).key, 'before');
assert.equal(timingBucket(0).key, 'around');
assert.equal(timingBucket(25).key, 'late');

const mealInsights = buildMealTimingInsights([
  { complete: true, entry: { food: 'Porridge' }, bolusOffset: -15, peakDelta: 24, twoHourDelta: 8 },
  { complete: true, entry: { food: 'porridge ' }, bolusOffset: -12, peakDelta: 28, twoHourDelta: 10 },
  { complete: true, entry: { food: 'Porridge' }, bolusOffset: 0, peakDelta: 52, twoHourDelta: 25 },
  { complete: true, entry: { food: 'Porridge' }, bolusOffset: 3, peakDelta: 48, twoHourDelta: 22 },
]);
assert.equal(mealInsights.length, 1);
assert.equal(mealInsights[0].comparable, true);
assert.equal(mealInsights[0].best.key, 'before');
assert.equal(mealInsights[0].best.medianPeakDelta, 26);

const minute = (value) => Math.round(new Date(value).getTime() / 60000);
const start = minute('2026-08-20T21:00:00');
const cgm = [];
for (let offset = 0; offset < 180; offset += 5) {
  let value = 100;
  if (offset >= 30 && offset <= 75) value = 100 + (offset - 30) * 1.1;
  if (offset > 75 && offset <= 90) value = 150;
  if (offset > 90) value = 150 - (offset - 90) * 0.8;
  cgm.push([start + offset, Math.round(value), 0]);
}
const night = buildNightRiseAnalysis({
  diary: [{ occasion: 'Schlaf', when: '2026-08-20T21:00' }],
  clinical: {
    cgm,
    boluses: [[start + 80, null, 1.2, null, 'Korrektur']],
  },
});
assert.equal(night.eligibleNights, 1);
assert.equal(night.rises.length, 1);
assert.equal(night.correctedRises, 1);
assert.equal(night.declinesAfterCorrection, 1);
assert.equal(night.medianCorrectionUnitsUntilDecline, 1.2);

const excluded = buildNightRiseAnalysis({
  diary: [{ occasion: 'Abendessen', when: '2026-08-20T20:00' }],
  clinical: { cgm, boluses: [[start - 60, 40, 3, null, 'Bolus']] },
});
assert.equal(excluded.eligibleNights, 0);
assert.equal(excluded.excludedForMeal, 1);

console.log('feedback analysis tests passed');
