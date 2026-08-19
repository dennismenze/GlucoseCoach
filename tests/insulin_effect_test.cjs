'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const core = require(path.resolve(__dirname, '..', 'docs', 'app-insulin-core.js'));
const modelApi = require(path.resolve(__dirname, '..', 'docs', 'app-insulin-model.js'));

const minute = (iso) => Math.round(new Date(iso).getTime() / 60_000);

function responseCurve(at, {
  onset = 30,
  maximumEffect = 80,
  end = 230,
  baseline = 190,
  actionWindow = 300,
  preSlope = 0.05,
} = {}) {
  const rows = [];
  for (let offset = -30; offset <= actionWindow; offset += 5) {
    let value;
    if (offset <= 0) {
      value = baseline + offset * preSlope;
    } else if (offset < onset) {
      value = baseline + offset * 0.10;
    } else if (offset < maximumEffect) {
      value = baseline + onset * 0.10 - (offset - onset) * 0.60;
    } else if (offset < end) {
      value = baseline + onset * 0.10
        - (maximumEffect - onset) * 0.60
        - (offset - maximumEffect) * 0.25;
    } else {
      const endValue = baseline + onset * 0.10
        - (maximumEffect - onset) * 0.60
        - (end - maximumEffect) * 0.25;
      value = endValue + (offset - end) * 0.02;
    }
    rows.push([at + offset, Math.round(value), 0]);
  }
  return rows;
}

function baseClinical() {
  return {
    cgm: [],
    boluses: [],
    manualInsulin: [],
    basalEvents: [],
    cgmCarbs: [],
    exerciseEvents: [],
    foodEvents: [],
    alarms: [],
  };
}

const clinical = baseClinical();
const isolatedSpecs = [
  { onset: 25, maximumEffect: 70, end: 215, dose: 0.4, hour: 6 },
  { onset: 25, maximumEffect: 75, end: 220, dose: 0.5, hour: 7 },
  { onset: 30, maximumEffect: 75, end: 225, dose: 0.6, hour: 12 },
  { onset: 30, maximumEffect: 80, end: 230, dose: 0.7, hour: 13 },
  { onset: 30, maximumEffect: 80, end: 230, dose: 0.8, hour: 18 },
  { onset: 35, maximumEffect: 85, end: 235, dose: 0.9, hour: 19 },
  { onset: 35, maximumEffect: 85, end: 240, dose: 1.1, hour: 23 },
  { onset: 40, maximumEffect: 90, end: 245, dose: 1.2, hour: 0 },
];

for (let index = 0; index < isolatedSpecs.length; index += 1) {
  const spec = isolatedSpecs[index];
  const day = String(index + 1 + (spec.hour === 0 ? 1 : 0)).padStart(2, '0');
  const hour = String(spec.hour).padStart(2, '0');
  const at = minute(`2026-07-${day}T${hour}:00:00`);
  clinical.cgm.push(...responseCurve(at, {
    onset: spec.onset,
    maximumEffect: spec.maximumEffect,
    end: spec.end,
    baseline: 185 + index,
  }));
  clinical.boluses.push([at, 0, spec.dose, null, 'Normal']);
}

const manualAt = minute('2026-07-10T14:00:00');
clinical.cgm.push(...responseCurve(manualAt, {
  onset: 30,
  maximumEffect: 80,
  end: 230,
  baseline: 198,
}));
clinical.manualInsulin.push([manualAt, 'manuelle Korrektur', 0.75, 'Schnell']);

const mealAt = minute('2026-07-12T12:00:00');
clinical.cgm.push(...responseCurve(mealAt));
clinical.boluses.push([mealAt, 42, 2.4, 180, 'Normal']);

const stackAt = minute('2026-07-14T12:00:00');
clinical.cgm.push(...responseCurve(stackAt));
clinical.boluses.push([stackAt - 60, 0, 0.3, null, 'Normal']);
clinical.boluses.push([stackAt, 0, 0.6, null, 'Normal']);

const exerciseAt = minute('2026-07-16T12:00:00');
clinical.cgm.push(...responseCurve(exerciseAt));
clinical.boluses.push([exerciseAt, 0, 0.7, null, 'Normal']);
clinical.exerciseEvents.push([exerciseAt + 30, 'Spaziergang', 'Mittel', 35, 140]);

const fallingAt = minute('2026-07-18T12:00:00');
clinical.cgm.push(...responseCurve(fallingAt, { preSlope: -0.7 }));
clinical.boluses.push([fallingAt, 0, 0.7, null, 'Normal']);

clinical.cgm.sort((a, b) => a[0] - b[0]);
clinical.boluses.sort((a, b) => a[0] - b[0]);

const settings = { preparation: 'Testinsulin', actionWindowMinutes: 300 };
const events = core.analyzeBolusEvents(clinical, [], settings);
assert.equal(events.length, 14);
assert.equal(events.filter((event) => event.correctionLike).length, 13);
assert.equal(events.filter((event) => event.modelEligible).length, 9);
assert.equal(events.filter((event) => event.source === 'manuell').length, 1);
assert.equal(events.find((event) => event.source === 'manuell').modelEligible, true);

const mealEvent = events.find((event) => event.minute === mealAt);
assert.equal(mealEvent.correctionLike, false);
assert.equal(mealEvent.modelEligible, false);
assert(mealEvent.reasons.some((reason) => reason.code === 'meal-bolus'));

const stacked = events.find((event) => event.minute === stackAt);
assert.equal(stacked.modelEligible, false);
assert(stacked.reasons.some((reason) => reason.code === 'previous-insulin'));

const exercise = events.find((event) => event.minute === exerciseAt);
assert.equal(exercise.modelEligible, false);
assert(exercise.reasons.some((reason) => reason.code === 'exercise'));

const falling = events.find((event) => event.minute === fallingAt);
assert.equal(falling.modelEligible, false);
assert(falling.reasons.some((reason) => reason.code === 'already-falling'));

const model = modelApi.buildInsulinEffectModel(events, settings);
assert.equal(model.totalBoluses, 14);
assert.equal(model.correctionBoluses, 13);
assert.equal(model.eligibleEvents, 9);
assert.equal(model.sufficient, true);
assert.equal(model.confidence, 'mittel');
assert.deepEqual(model.onset, { n: 9, median: 30, q1: 30, q3: 35 });
assert.deepEqual(model.peak, { n: 9, median: 45, q1: 45, q3: 55 });
assert.deepEqual(model.end, { n: 9, median: 230, q1: 225, q3: 240 });
assert.equal(model.endCensoredPercent, 0);
assert.equal(model.curve.length, 11);
assert.deepEqual(
  model.curve.map((point) => point.offset),
  [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300],
);
assert(model.curve.some((point) => point.median === 100));

const subgroups = modelApi.buildInsulinSubgroups(events);
assert.deepEqual(subgroups.timeOfDay.map((group) => group.label), [
  'Abend (17–23)',
  'Morgen (05–11)',
  'Nacht (23–05)',
  'Tag (11–17)',
]);
assert.deepEqual(
  subgroups.doseBand.map((group) => group.label),
  ['<0,5 E', '>1,0 E', '0,5–1,0 E'],
);
assert.equal(subgroups.timeOfDay.reduce((sum, group) => sum + group.events, 0), 9);
assert.equal(subgroups.doseBand.reduce((sum, group) => sum + group.events, 0), 9);

assert.deepEqual(core.normalizeSettings({ actionWindowMinutes: 240, preparation: ' Fiasp ' }), {
  preparation: 'Fiasp',
  actionWindowMinutes: 240,
});
assert.equal(core.normalizeSettings({ actionWindowMinutes: 999 }).actionWindowMinutes, 300);
assert.equal(core.normalizeSettings({ actionWindowMinutes: 360 }).actionWindowMinutes, 360);

const shortWindowEvents = core.analyzeBolusEvents(clinical, [], { actionWindowMinutes: 240 });
const shortModel = modelApi.buildInsulinEffectModel(
  shortWindowEvents,
  { actionWindowMinutes: 240 },
);
assert.equal(shortModel.settings.actionWindowMinutes, 240);
assert.equal(shortModel.curve.at(-1).offset, 240);

console.log('Personal insulin-effect analysis contract passed');
