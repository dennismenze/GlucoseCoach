'use strict';

const assert = require('node:assert/strict');
const {
  analyzeEarlyBolusEffect,
  ONSET_MIN_OFFSET_MINUTES,
  ONSET_MAX_OFFSET_MINUTES,
} = require('../docs/app-early-bolus-effect.js');

const MINUTE_MS = 60_000;
const minute = (iso) => Math.round(new Date(iso).getTime() / MINUTE_MS);

function risingCorrectionCurve(start, effectStart = 20, shift = 0) {
  const rows = [];
  for (let offset = -30; offset <= 75; offset += 5) {
    const baselineAtBolus = 170 + shift;
    let value = baselineAtBolus + offset * 0.5;
    if (offset >= effectStart) value -= (offset - effectStart + 5) * 1.2;
    rows.push([start + offset, Math.round(value), 0]);
  }
  return rows;
}

function fallingCurve(start) {
  const rows = [];
  for (let offset = -30; offset <= 75; offset += 5) {
    rows.push([start + offset, 220 - Math.round((offset + 30) * 0.7), 0]);
  }
  return rows;
}

const first = minute('2026-08-01T20:00:00Z');
const second = minute('2026-08-02T20:00:00Z');
const third = minute('2026-08-03T20:00:00Z');
const meal = minute('2026-08-04T08:00:00Z');
const overlap = minute('2026-08-05T20:00:00Z');
const falling = minute('2026-08-06T20:00:00Z');

const clinical = {
  cgm: [
    ...risingCorrectionCurve(first, 20, 0),
    ...risingCorrectionCurve(second, 20, 5),
    ...risingCorrectionCurve(third, 20, 10),
    ...risingCorrectionCurve(meal, 20, 15),
    ...risingCorrectionCurve(overlap, 20, 20),
    ...fallingCurve(falling),
  ],
  boluses: [
    [first, 0, 0.5, 170, 'Normal'],
    [second, null, 0.6, 175, 'Normal'],
    [third, 0, 0.7, 180, 'Normal'],
    [meal, 35, 1.5, 185, 'Normal'],
    [overlap, 0, 0.5, 190, 'Normal'],
    [overlap + 45, 0, 0.2, 205, 'Normal'],
    [falling, 0, 0.4, 220, 'Normal'],
  ],
};

const result = analyzeEarlyBolusEffect(clinical, []);
assert.equal(result.aggregate.totalBoluses, 7);
assert.equal(result.aggregate.correctionBoluses, 6);
assert.equal(result.aggregate.eligibleCorrections, 3);
assert.equal(result.aggregate.analyzedCorrections, 3);
assert.equal(result.aggregate.sufficient, true);
assert.equal(result.aggregate.onset.n, 3);
assert.equal(result.aggregate.onset.median, 25);
assert.equal(result.aggregate.onset.q1, 25);
assert.equal(result.aggregate.onset.q3, 25);

const mealEvent = result.events.find((event) => event.minute === meal);
assert.equal(mealEvent, undefined, 'positive-carbohydrate bolus is not a correction candidate');
const overlapEvent = result.events.find((event) => event.minute === overlap);
assert.equal(overlapEvent.eligibleEarlyEffect, false);
assert(overlapEvent.earlyEffectExclusionReasons.includes('weiterer Bolus im frühen Isolationsfenster'));
const fallingEvent = result.events.find((event) => event.minute === falling);
assert.equal(fallingEvent.eligibleEarlyEffect, false);
assert(fallingEvent.earlyEffectExclusionReasons.some((reason) => /Ausgangstrend|fällt bereits/.test(reason)));

assert.equal(ONSET_MIN_OFFSET_MINUTES, 15);
assert.equal(ONSET_MAX_OFFSET_MINUTES, 60);
console.log('early bolus effect tests passed');
