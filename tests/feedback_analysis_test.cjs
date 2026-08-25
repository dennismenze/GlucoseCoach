'use strict';
const assert = require('node:assert/strict');
const {
  buildMealTimingInsights,
  timingBucket,
} = require('../docs/app-feedback-ui.js');
const {
  allCorrectionBoluses,
  buildCombinedAnalysisDiary,
  buildNightRiseAnalysis,
  EVENING_START_HOUR,
  MEAL_CONTEXT_START_HOUR,
} = require('../docs/app-feedback-glooko.js');

assert.equal(EVENING_START_HOUR, 20);
assert.equal(MEAL_CONTEXT_START_HOUR, 18);
assert.equal(timingBucket(-15).key, 'before');
assert.equal(timingBucket(0).key, 'around');
assert.equal(timingBucket(25).key, 'late');

const combinedDiary = buildCombinedAnalysisDiary(
  [{ id: 'local' }],
  { foodEvents: [[1, 'Import']] },
  {
    buildAnalysisDiary(local, clinical) {
      assert.equal(local[0].id, 'local');
      assert.equal(clinical.foodEvents[0][1], 'Import');
      return [...local, { id: 'glooko' }];
    },
  },
);
assert.deepEqual(combinedDiary.map((entry) => entry.id), ['local', 'glooko']);

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
function risingCgm(start) {
  const cgm = [];
  for (let offset = 0; offset < 240; offset += 5) {
    let value = 100;
    if (offset >= 60 && offset <= 105) value = 100 + (offset - 60) * 1.1;
    if (offset > 105 && offset <= 120) value = 150;
    if (offset > 120) value = 150 - (offset - 120) * 0.8;
    cgm.push([start + offset, Math.round(value), 0]);
  }
  return cgm;
}
function flatCgm(start) {
  const cgm = [];
  for (let offset = 0; offset < 240; offset += 5) {
    cgm.push([start + offset, 120 - Math.floor(offset / 60), 0]);
  }
  return cgm;
}

const start = minute('2026-08-20T20:00:00');
const cgm = risingCgm(start);
const night = buildNightRiseAnalysis({
  diary: [{ occasion: 'Schlaf', when: '2026-08-20T21:00' }],
  clinical: {
    cgm,
    boluses: [[start + 140, null, 1.2, null, 'Korrektur']],
  },
});
assert.equal(night.nightsWithCgm, 1);
assert.equal(night.eligibleNights, 1);
assert.equal(night.rises.length, 1);
assert.equal(night.correctedRises, 1);
assert.equal(night.correctedEvenings, 1);
assert.equal(night.declinesAfterCorrection, 1);
assert.equal(night.medianEveningCorrectionUnits, 1.2);
assert.equal(night.medianCorrectionUnitsUntilDecline, 1.2);

const excluded = buildNightRiseAnalysis({
  diary: [{ occasion: 'Abendessen', when: '2026-08-20T20:00' }],
  clinical: { cgm, boluses: [[start, 40, 3, null, 'Bolus']] },
});
assert.equal(excluded.eligibleNights, 0);
assert.equal(excluded.excludedForMeal, 1);
assert.equal(excluded.correctedEvenings, 0);

const classified = allCorrectionBoluses({
  boluses: [
    [start + 15, 0, 0.9, null, 'Normal'],
    [start + 20, null, 0.6, null, 'Mahlzeit'],
    [start + 25, 12, 1.5, null, 'Korrektur'],
  ],
  manualInsulin: [[start + 30, 'Schnell wirksam', 0.4]],
});
assert.deepEqual(
  classified.map((event) => [event.minute, event.units, event.source]),
  [
    [start + 15, 0.9, 'Pumpe'],
    [start + 20, 0.6, 'Pumpe'],
    [start + 30, 0.4, 'manuell'],
  ],
);

const beforeRise = buildNightRiseAnalysis({
  clinical: {
    cgm,
    boluses: [
      [start + 15, 0, 0.9, null, 'Normal'],
      [start + 135, 0, 0.6, null, 'Normal'],
    ],
  },
});
assert.equal(beforeRise.rises.length, 1);
assert.equal(beforeRise.correctedRises, 1);
assert.equal(beforeRise.correctedEvenings, 1);
assert.equal(beforeRise.events[0].correctionCount, 2);
assert.equal(beforeRise.events[0].correctionUnits, 1.5);
assert.equal(beforeRise.events[0].firstCorrectionMinute, start + 15);
assert.equal(beforeRise.medianEveningCorrectionUnits, 1.5);

const mealContextDoesNotReclassifyCorrections = buildNightRiseAnalysis({
  clinical: {
    cgm,
    boluses: [
      [minute('2026-08-20T18:30:00'), 45, 1.4, null, 'Normal'],
      [start + 15, 0, 0.9, null, 'Normal'],
      [start + 135, 0, 0.6, null, 'Normal'],
    ],
  },
});
assert.equal(mealContextDoesNotReclassifyCorrections.eligibleNights, 0);
assert.equal(mealContextDoesNotReclassifyCorrections.excludedForMeal, 1);
assert.equal(mealContextDoesNotReclassifyCorrections.rises.length, 0);
assert.equal(mealContextDoesNotReclassifyCorrections.correctedEvenings, 1);
assert.equal(mealContextDoesNotReclassifyCorrections.events.length, 1);
assert.equal(mealContextDoesNotReclassifyCorrections.events[0].mealContext, true);
assert.equal(mealContextDoesNotReclassifyCorrections.events[0].correctionUnits, 1.5);
assert.equal(mealContextDoesNotReclassifyCorrections.medianEveningCorrectionUnits, 1.5);

const correctionWithoutRise = buildNightRiseAnalysis({
  clinical: {
    cgm: flatCgm(start),
    boluses: [
      [start + 10, 0, 1.0, null, 'Normal'],
      [start + 68, 0, 0.15, null, 'Normal'],
    ],
  },
});
assert.equal(correctionWithoutRise.rises.length, 0);
assert.equal(correctionWithoutRise.correctedEvenings, 1);
assert.equal(correctionWithoutRise.events.length, 1);
assert.equal(correctionWithoutRise.events[0].correctionUnits, 1.15);
assert.equal(correctionWithoutRise.medianEveningCorrectionUnits, 1.15);

const positiveCarbsAreNotCorrection = buildNightRiseAnalysis({
  clinical: {
    cgm: flatCgm(start),
    boluses: [[start + 30, 10, 1.0, null, 'Korrektur']],
  },
});
assert.equal(positiveCarbsAreNotCorrection.excludedForMeal, 1);
assert.equal(positiveCarbsAreNotCorrection.correctedEvenings, 0);
assert.equal(positiveCarbsAreNotCorrection.events.length, 0);

console.log('feedback analysis tests passed');
