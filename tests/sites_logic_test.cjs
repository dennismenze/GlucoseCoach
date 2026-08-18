'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
const js = ['app-core.js', 'app-analysis.js', 'app-render.js', 'app-events.js'].map((name) => fs.readFileSync(path.join(root, 'docs', name), 'utf8')).join('\n');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glucosecoach-sites-'));
const scriptPath = path.join(tempDir, 'app.cjs');
fs.writeFileSync(scriptPath, js);
const analytics = require(scriptPath);

function minute(value) {
  const result = analytics.parseDateTime(value);
  assert.notEqual(result, null, `date should parse: ${value}`);
  return result;
}

function buildCurve(day, peakAdjustment = 0) {
  const start = minute(`${day} 08:45`);
  const meal = minute(`${day} 09:00`);
  const values = [100, 102, 101, 100];
  const post = [102, 107, 114, 123, 132, 142, 151, 160, 168, 174, 178, 180, 176, 170, 164, 158, 152, 146, 140, 136, 133, 130, 128, 126, 124, 122, 120, 119, 118, 117, 116, 115, 114, 113, 112, 111];
  const rows = values.map((value, index) => [start + index * 5, value, 0]);
  post.forEach((value, index) => rows.push([meal + (index + 1) * 5, value + peakAdjustment, 0]));
  return { rows, meal };
}

assert.equal(analytics.DIARY_KEY, 'glucosecoach-diary-v1', 'old diary storage key must remain stable');
assert.equal(analytics.parseLocaleNumber('46,2'), 46.2);
assert.equal(analytics.parseLocaleNumber('1.234,5'), 1234.5);
assert.equal(analytics.parseLocaleNumber('1,234.5'), 1234.5);

const cgmCsv = [
  'Name: must be discarded',
  'Zeitstempel,CGM-Glukosewert (mg/dl)',
  '17.08.2026 09:00,100',
  '17.08.2026 09:05,2001',
  '17.08.2026 09:10,1',
].join('\n');
const parsedCgm = analytics.parseClinicalCsv(cgmCsv);
assert.equal(parsedCgm.kind, 'cgm');
assert.deepEqual(parsedCgm.cgm.map((row) => row.slice(1)), [[100, 0], [null, 1], [null, -1]]);
assert.equal(parsedCgm.metadataRowsDiscarded, 1);

const bolusCsv = [
  'Metadata',
  'Zeitstempel,Kohlenhydrataufnahme (g),Abgegebenes Insulin (E),Blutzuckereingabe (mg/dl),Insulin-Typ',
  '17.08.2026 08:50,"46,2","3,25",100,Bolus',
].join('\n');
const parsedBolus = analytics.parseClinicalCsv(bolusCsv);
assert.equal(parsedBolus.kind, 'bolus');
assert.equal(parsedBolus.boluses[0][1], 46.2);
assert.equal(parsedBolus.boluses[0][2], 3.25);

const metrics = analytics.calculateMetrics([
  [minute('17.08.2026 10:00'), 100, 0],
  [minute('17.08.2026 10:05'), null, -1],
  [minute('17.08.2026 10:10'), null, 1],
]);
assert.equal(metrics.mean, 100);
assert.equal(metrics.exactSamples, 1);
assert.equal(metrics.inRange, 33.33);
assert.equal(metrics.veryLow, 33.33);
assert.equal(metrics.veryHigh, 33.33);

const first = buildCurve('17.08.2026');
const second = buildCurve('18.08.2026', -5);
const cgm = [...first.rows, ...second.rows];
const boluses = [
  [minute('17.08.2026 08:50'), 46.2, 3.25, 100, 'Bolus'],
  [minute('18.08.2026 08:50'), 46.0, 3.10, 105, 'Bolus'],
];
const diary = [
  { id: 'a', when: '2026-08-17T09:00', occasion: 'Frühstück', food: 'Testmahlzeit', carbs: '5.4', illness: 'nein' },
  { id: 'b', when: '2026-08-18T09:00', occasion: 'Frühstück', food: 'Testmahlzeit', carbs: '5.9', illness: 'nein' },
];
const analyses = analytics.analyzeMeals(diary, cgm, boluses);
assert.equal(analyses.length, 2);
assert(analyses.every((item) => item.complete), 'both meal curves should be complete');
assert.equal(analyses[0].baseline, 100);
assert.equal(analyses[0].minutesToRise, 10);
assert.equal(analyses[0].peak, 180);
assert.equal(analyses[0].minutesToPeak, 60);
assert.equal(analyses[0].twoHour, 126);
assert.equal(analyses[0].bolusOffset, -10);
assert.equal(analyses[0].turnFromBolus, 70);

const groups = analytics.buildFoodComparisons(analyses);
assert.equal(groups.length, 1);
assert.equal(groups[0].entries, 2);
assert.equal(groups[0].analyzed, 2);
assert.equal(groups[0].medianMinutesToPeak, 60);

const recommendationCards = analytics.buildRecommendations({
  diary,
  analyses,
  foodGroups: groups,
  cgmRows: cgm,
  metrics: analytics.calculateMetrics(cgm),
});
assert(recommendationCards.some((card) => card.title.includes('Testmahlzeit')));
assert(recommendationCards.every((card) => card.boundary), 'every recommendation needs an explicit boundary');

const merged = analytics.mergeClinical({ schema: analytics.CLINICAL_KEY, cgm: [cgm[0]], boluses: [boluses[0]], imports: [], updatedAt: null }, [
  { kind: 'cgm', cgm: [cgm[0], cgm[1]], boluses: [], rejected: 0, metadataRowsDiscarded: 1 },
  { kind: 'bolus', cgm: [], boluses: [boluses[0], boluses[1]], rejected: 0, metadataRowsDiscarded: 1 },
]);
assert.equal(merged.clinical.cgm.length, 2, 'overlapping CGM rows must deduplicate');
assert.equal(merged.clinical.boluses.length, 2, 'overlapping boluses must deduplicate');
assert.equal(merged.summary.cgmAdded, 1);
assert.equal(merged.summary.bolusesAdded, 1);

console.log('GlucoseCoach Sites v2 logic tests passed');
