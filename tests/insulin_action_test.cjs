'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const insulin = require(path.resolve(__dirname, '..', 'docs', 'app-insulin-action.js'));
const minute = (iso) => Math.round(new Date(iso).getTime() / 60_000);

function correctionCurve(when, variant = 0) {
  const start = minute(when);
  const baseline = 220 + variant;
  const rows = [];
  for (let offset = -30; offset <= 300; offset += 5) {
    let value = baseline;
    if (offset > 15 && offset <= 120) {
      value = baseline - ((offset - 15) / 105) * (100 + variant * 0.2);
    } else if (offset > 120 && offset <= 235) {
      const nadir = baseline - (100 + variant * 0.2);
      value = nadir + ((offset - 120) / 115) * 92;
    } else if (offset > 235) {
      value = baseline - 8 + Math.min(3, Math.floor((offset - 235) / 15));
    }
    rows.push([start + offset, Math.round(value), 0]);
  }
  return rows;
}

const correctionTimes = [
  '2026-08-01T08:00',
  '2026-08-02T08:00',
  '2026-08-03T12:00',
  '2026-08-04T18:00',
];
const clinical = {
  cgm: correctionTimes.flatMap((when, index) => correctionCurve(when, index * 2)),
  boluses: correctionTimes.map((when, index) => [
    minute(when),
    0,
    1 + index * 0.2,
    220 + index * 2,
    'Korrektur',
  ]),
  basalEvents: [],
  exerciseEvents: [],
  foodEvents: [],
  cgmCarbs: [],
  manualInsulin: [],
  alarms: [],
};

const result = insulin.analyzeInsulinAction(clinical, []);
assert.equal(insulin.GC_INSULIN_ACTION_WINDOW_MINUTES, 300);
assert.equal(insulin.GC_INSULIN_MIN_AGGREGATE_EVENTS, 3);
assert.equal(result.events.length, 4);
assert.equal(result.aggregate.totalBoluses, 4);
assert.equal(result.aggregate.correctionCandidates, 4);
assert.equal(result.aggregate.eligibleCorrections, 4);
assert.equal(result.aggregate.analyzedCorrections, 4);
assert.equal(result.aggregate.sufficient, true);
assert.equal(result.aggregate.confidence, 'niedrig');
assert(result.aggregate.onset.median >= 15 && result.aggregate.onset.median <= 30);
assert(result.aggregate.maxEffectTime.median >= 100 && result.aggregate.maxEffectTime.median <= 135);
assert(result.aggregate.actionEnd.median >= 225 && result.aggregate.actionEnd.median <= 250);
assert(result.aggregate.duration.median > 180);
assert(result.aggregate.profile.length >= 15);
assert(result.aggregate.profile.some((bin) => bin.offset === 120 && bin.median >= 90));
assert(result.aggregate.profile.some((bin) => bin.offset >= 240 && bin.median <= 15));
assert(result.aggregate.byTimeOfDay.some((group) => group.label.includes('Morgen')));
assert(result.aggregate.byBolusSize.some((group) => group.label.includes('mittel')));

for (const event of result.events) {
  assert.equal(event.correctionCandidate, true);
  assert.equal(event.eligibleCorrection, true);
  assert.equal(event.detectable, true);
  assert.equal(event.exclusionReasons.length, 0);
  assert(event.effectOnset >= 15 && event.effectOnset <= 30);
  assert(event.maxDropRate < 0);
  assert(event.maxDropRateTime >= event.effectOnset);
  assert(event.nadir < event.baseline - 80);
  assert(event.nadirTime >= 105 && event.nadirTime <= 135);
  assert(event.stableTime >= 225);
  assert(event.actionEnd >= 225 && event.actionEnd <= 250);
  assert.equal(event.actionEndCensored, false);
  assert(event.effectiveDuration > 180);
  assert(event.effectAuc > 100);
  assert(event.cgmCoverage >= 99);
  assert.equal(event.quality, 'hoch');
}

const mealTime = '2026-08-10T08:00';
const mealClinical = {
  ...clinical,
  cgm: correctionCurve(mealTime),
  boluses: [[minute(mealTime), 45, 3.2, 220, 'Mahlzeit']],
};
const mealResult = insulin.analyzeInsulinAction(mealClinical, [{
  when: mealTime,
  occasion: 'Frühstück',
  food: 'Haferfrühstück',
  illness: 'nein',
}]);
assert.equal(mealResult.events.length, 1);
assert.equal(mealResult.events[0].classification, 'Mahlzeiten-/Kontextbolus');
assert.equal(mealResult.events[0].correctionCandidate, false);
assert.equal(mealResult.events[0].eligibleCorrection, false);
assert(mealResult.events[0].exclusionReasons.some((reason) => reason.includes('Kohlenhydrate')));
assert.equal(mealResult.aggregate.analyzedCorrections, 0);
assert.equal(mealResult.aggregate.sufficient, false);

const exerciseTime = '2026-08-11T08:00';
const exerciseClinical = {
  ...clinical,
  cgm: correctionCurve(exerciseTime),
  boluses: [[minute(exerciseTime), 0, 1.2, 220, 'Korrektur']],
  exerciseEvents: [[minute(exerciseTime) + 45, 'Spaziergang', 'Mittel', 30, 100]],
};
const exerciseResult = insulin.analyzeInsulinAction(exerciseClinical, []);
assert.equal(exerciseResult.events[0].correctionCandidate, true);
assert.equal(exerciseResult.events[0].eligibleCorrection, false);
assert(exerciseResult.events[0].exclusionReasons.some((reason) => reason.includes('Sport')));

const overlapTime = '2026-08-12T08:00';
const overlapClinical = {
  ...clinical,
  cgm: correctionCurve(overlapTime),
  boluses: [
    [minute(overlapTime), 0, 1.2, 220, 'Korrektur'],
    [minute(overlapTime) + 90, 0, 0.5, 180, 'Korrektur'],
  ],
};
const overlapResult = insulin.analyzeInsulinAction(overlapClinical, []);
assert(overlapResult.events.every((event) => event.eligibleCorrection === false));
assert(overlapResult.events.every((event) =>
  event.exclusionReasons.some((reason) => reason.includes('weiterer Bolus')),
));

console.log('Personal insulin-action estimation contracts passed');
