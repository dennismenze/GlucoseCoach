'use strict';

const assert = require('node:assert/strict');
const {
  analyzeAllBolusPhases,
  GC_ALL_BOLUS_PHASE_WINDOW_MINUTES,
} = require('../docs/app-all-bolus-phases.js');

function curve(start, delay = 0, shift = 0) {
  const shape = [
    [-30, 100], [-25, 100], [-20, 100], [-15, 100], [-10, 100], [-5, 100],
    [0, 100], [5, 104], [10, 108], [15, 112], [20, 116], [25, 120],
    [30, 124], [35, 127], [40, 130], [45, 132], [50, 134], [55, 135],
    [60, 136], [65, 136], [70, 136], [75, 136], [80, 135], [85, 132],
    [90, 128], [95, 124], [100, 121], [105, 119], [110, 118], [115, 117],
    [120, 116],
  ];
  const rows = [];
  for (let offset = -30; offset < delay; offset += 5) {
    rows.push([start + offset, 100 + shift, 0]);
  }
  for (const [offset, value] of shape) {
    if (offset < 0) continue;
    rows.push([start + offset + delay, value + shift, 0]);
  }
  return rows;
}

function testArithmeticMeansAcrossAllBoluses() {
  const clinical = {
    cgm: [...curve(1_000), ...curve(1_400, 10, 5)],
    boluses: [
      [1_000, 40, 2, 100, 'Normal'],
      [1_400, 30, 1.5, 105, 'Normal'],
    ],
    manualInsulin: [],
  };

  const result = analyzeAllBolusPhases(clinical);
  assert.equal(GC_ALL_BOLUS_PHASE_WINDOW_MINUTES, 180);
  assert.equal(result.aggregate.totalBoluses, 2);
  assert.equal(result.aggregate.cgmUsableBoluses, 2);
  assert.equal(result.aggregate.completePhaseEvents, 2);
  assert.deepEqual(
    result.events.map((event) => [
      event.riseSlowdown,
      event.turnPoint,
      event.significantDecline,
    ]),
    [[50, 70, 85], [60, 80, 95]],
  );
  assert.deepEqual(
    {
      slowdown: result.aggregate.slowdown,
      turn: result.aggregate.turn,
      decline: result.aggregate.decline,
    },
    {
      slowdown: { n: 2, mean: 55, median: 55, q1: 52.5, q3: 57.5 },
      turn: { n: 2, mean: 75, median: 75, q1: 72.5, q3: 77.5 },
      decline: { n: 2, mean: 90, median: 90, q1: 87.5, q3: 92.5 },
    },
  );
}

function testNextBolusEndsAttributionWindow() {
  const clinical = {
    cgm: curve(2_000),
    boluses: [
      [2_000, 40, 2, 100, 'Normal'],
      [2_040, 0, 0.5, 130, 'Korrektur'],
    ],
    manualInsulin: [],
  };

  const result = analyzeAllBolusPhases(clinical);
  const first = result.events[0];
  assert.equal(first.phaseTruncatedByNextBolus, true);
  assert.equal(first.phaseWindowMinutes, 39);
  assert.equal(first.turnPoint, null);
  assert.equal(first.significantDecline, null);
  assert.equal(result.aggregate.truncatedByNextBolus, 1);
}

testArithmeticMeansAcrossAllBoluses();
testNextBolusEndsAttributionWindow();
console.log('All-bolus three-phase timing contracts passed');
