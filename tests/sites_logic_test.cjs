'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'docs', 'app-v3.js'), 'utf8');
const analytics = require(path.join(root, 'docs', 'app-v3.js'));

const minute = (iso) => Math.round(new Date(iso).getTime() / 60000);

assert.equal(analytics.GC_DIARY_KEY, 'glucosecoach-diary-v1');
assert.equal(analytics.GC_CLINICAL_KEY, 'glucosecoach-clinical-v1');
assert.equal(analytics.GC_PROFILE_KEY, 'glucosecoach-profile-v1');

for (const forbidden of ['25.382', '25382', '138.5', '6.62', '82.22', '16.55', 'Veröffentlichter Ausgangsstand', 'STATIC_BASELINE']) {
  assert(!html.includes(forbidden), `HTML contains published patient baseline: ${forbidden}`);
  assert(!js.includes(forbidden), `JS contains published patient baseline: ${forbidden}`);
}

const cgmCsv = [
  'Name: discarded metadata',
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
  [minute('2026-08-17T10:00:00'), 100, 0],
  [minute('2026-08-17T10:05:00'), null, -1],
  [minute('2026-08-17T10:10:00'), null, 1],
]);
assert.equal(metrics.mean, 100);
assert.equal(metrics.inRange, 33.33);
assert.equal(metrics.veryLow, 33.33);
assert.equal(metrics.veryHigh, 33.33);

const mealMinute = minute('2026-08-17T09:00:00');
const start = mealMinute - 15;
const values = [100, 101, 100, 100];
const post = [102, 107, 114, 123, 132, 142, 151, 160, 168, 174, 178, 180, 176, 170, 164, 158, 152, 146, 140, 136, 133, 130, 128, 126, 124, 122, 120, 119, 118, 117, 116, 115, 114, 113, 112, 111];
const cgm = values.map((value, index) => [start + index * 5, value, 0]);
post.forEach((value, index) => cgm.push([mealMinute + (index + 1) * 5, value, 0]));
const diary = [{ id: 'a', when: '2026-08-17T09:00', occasion: 'Frühstück', food: 'Testmahlzeit', illness: 'nein' }];
const boluses = [[mealMinute - 10, 46.2, 3.25, 100, 'Bolus']];
const analyses = analytics.analyzeMeals(diary, cgm, boluses);
assert.equal(analyses.length, 1);
assert.equal(analyses[0].complete, true);
assert.equal(analyses[0].baseline, 100);
assert.equal(analyses[0].peak, 180);
assert.equal(analyses[0].minutesToPeak, 60);
assert.equal(analyses[0].bolusOffset, -10);

const emptyCards = analytics.buildRecommendations({ diary: [], analyses: [], foodGroups: [], cgmRows: [], metrics: null });
assert.equal(emptyCards[0].title, 'Noch keine persönlichen Daten gespeichert');
assert(emptyCards[0].boundary.includes('keine Beispielwerte'));

const merged = analytics.mergeClinical(
  { cgm: [], boluses: [], imports: [], updatedAt: null },
  [
    { kind: 'cgm', cgm: [cgm[0], cgm[0], cgm[1]], boluses: [], rejected: 0, metadataRowsDiscarded: 1 },
    { kind: 'bolus', cgm: [], boluses: [boluses[0], boluses[0]], rejected: 0, metadataRowsDiscarded: 1 },
  ],
);
assert.equal(merged.clinical.cgm.length, 2);
assert.equal(merged.clinical.boluses.length, 1);

console.log('GlucoseCoach personal-local logic tests passed');
