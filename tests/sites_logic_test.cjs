'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core = require(path.join(root, 'docs', 'app-v3-core.js'));
const meal = require(path.join(root, 'docs', 'app-meal-window.js'));
const importers = require(path.join(root, 'docs', 'app-importers.js'));
const contextImporters = require(path.join(root, 'docs', 'app-importers-context.js'));
const app = { ...core, ...meal, ...importers, ...contextImporters };

const minute = (iso) => Math.round(new Date(iso).getTime() / 60_000);

assert.equal(core.GC_DIARY_KEY, 'glucosecoach-diary-v1');
assert.equal(core.GC_CLINICAL_KEY, 'glucosecoach-clinical-v1');
assert.equal(core.GC_PROFILE_KEY, 'glucosecoach-profile-v1');
assert.equal(typeof app.parseClinicalCsv, 'function');
assert.equal(typeof app.mergeClinical, 'function');

const cgmCsv = [
  'Name: discarded metadata',
  'Zeitstempel,CGM-Glukosewert (mg/dl)',
  '17.08.2026 09:00,100',
  '17.08.2026 09:05,2001',
  '17.08.2026 09:10,1',
].join('\n');
const parsedCgm = app.parseClinicalCsv(cgmCsv, 'cgm_data_1.csv');
assert.equal(parsedCgm.kind, 'cgm');
assert.deepEqual(parsedCgm.cgm.map((row) => row.slice(1)), [[100, 0], [null, 1], [null, -1]]);
assert.equal(parsedCgm.metadataRowsDiscarded, 1);

const bolusCsv = [
  'Metadata',
  'Zeitstempel,Kohlenhydrataufnahme (g),Abgegebenes Insulin (E),Blutzuckereingabe (mg/dl),Insulin-Typ,Anfängliche Abgabe (E),Verzögerte Abgabe (E)',
  '17.08.2026 08:50,"46,2","3,25",100,Bolus,"3,25",0',
].join('\n');
const parsedBolus = app.parseClinicalCsv(bolusCsv, 'bolus_data_1.csv');
assert.equal(parsedBolus.kind, 'bolus');
assert.equal(parsedBolus.boluses[0][1], 46.2);
assert.equal(parsedBolus.boluses[0][2], 3.25);

const insulinCsv = [
  'Metadata',
  'Zeitstempel,Bolus gesamt (U),Insulin gesamt (U),Basal gesamt (U)',
  '17.08.2026 23:59,"12,5","31,2","18,7"',
].join('\n');
const parsedInsulin = app.parseClinicalCsv(insulinCsv, 'insulin_data_1.csv');
assert.equal(parsedInsulin.kind, 'dailyInsulin');
assert.deepEqual(parsedInsulin.dailyInsulin[0].slice(1), [12.5, 31.2, 18.7]);

const basalCsv = [
  'Metadata',
  'Zeitstempel,Insulin-Typ,Dauer (Minuten),Prozentsatz (%),Rate,Abgegebenes Insulin (E)',
  '17.08.2026 08:00,Basal,30,100,"0,8","0,4"',
].join('\n');
const parsedBasal = app.parseClinicalCsv(basalCsv, 'basal_data_1.csv');
assert.equal(parsedBasal.kind, 'basal');
assert.equal(parsedBasal.basalEvents.length, 1);
assert.equal(parsedBasal.boluses.length, 0, 'basal rows must never be classified as boluses');

const bgCsv = [
  'Metadata',
  'Zeitstempel,Glukosewert (mg/dl),Manuelles Lesen',
  '17.08.2026 08:05,123,Ja',
].join('\n');
const parsedBg = app.parseClinicalCsv(bgCsv, 'bg_data_1.csv');
assert.equal(parsedBg.kind, 'bg');
assert.deepEqual(parsedBg.manualGlucose[0].slice(1), [123, 'Ja']);

const alarmCsv = [
  'Metadata',
  'Zeitstempel,Alarm/Ereignis',
  '17.08.2026 08:10,Pod abgelaufen',
].join('\n');
const parsedAlarm = app.parseClinicalCsv(alarmCsv, 'alarms_data_1.csv');
assert.equal(parsedAlarm.kind, 'alarm');
assert.equal(parsedAlarm.alarms[0][1], 'Pod abgelaufen');

const contextCases = [
  ['cgm_carbs_data_1.csv', 'Zeitstempel,KH (g)', '17.08.2026 08:00,"12,5"', 'cgmCarbs', 'cgmCarbs'],
  ['exercise_data_1.csv', 'Zeitstempel,Name,Intensität,Dauer (Minuten),Verbrannte Kalorien', '17.08.2026 08:00,Spaziergang,Mittel,30,120', 'exercise', 'exerciseEvents'],
  ['food_data_1.csv', 'Zeitstempel,Name,KH (g),Fett (g),Eiweiß (g),Kalorien,Portionen,Anzahl der Portionen', '17.08.2026 08:00,Hafermilch,"5,9","1,4","0,8",45,Glas,1', 'food', 'foodEvents'],
  ['manual_insulin_data_1.csv', 'Zeitstempel,Name,Wert,Insulin-Typ', '17.08.2026 08:00,Korrektur,"0,5",Schnell', 'manualInsulin', 'manualInsulin'],
  ['medication_data_1.csv', 'Zeitstempel,Name,Wert,Medikamententyp', '17.08.2026 08:00,Test,100 mg,Sonstiges', 'medication', 'medications'],
  ['notes_data_1.csv', 'Zeitstempel,Wert', '17.08.2026 08:00,"synthetische Notiz, korrekt quotiert"', 'note', 'notes'],
];
for (const [filename, headers, row, kind, property] of contextCases) {
  const parsed = app.parseClinicalCsv(['Metadata', headers, row].join('\n'), filename);
  assert.equal(parsed.kind, kind, filename);
  assert.equal(parsed[property].length, 1, filename);
}

const metrics = core.calculateMetrics([
  [minute('2026-08-17T10:00:00'), 100, 0],
  [minute('2026-08-17T10:05:00'), null, -1],
  [minute('2026-08-17T10:10:00'), null, 1],
]);
assert.equal(metrics.mean, 100);
assert.equal(metrics.inRange, 33.33);
assert.equal(metrics.veryLow, 33.33);
assert.equal(metrics.veryHigh, 33.33);

const mealMinute = minute('2026-08-17T09:00:00');
const cgm = [];
for (let offset = -15; offset <= 180; offset += 5) {
  let value = 100;
  if (offset > 0 && offset <= 60) value = 100 + Math.round(offset * 1.3);
  else if (offset > 60) value = 178 - Math.round((offset - 60) * 0.4);
  cgm.push([mealMinute + offset, value, 0]);
}
// A later value outside the two-hour peak window must not replace the meal peak.
cgm.find((row) => row[0] === mealMinute + 175)[1] = 250;
const diary = [{
  id: 'a',
  when: '2026-08-17T09:00',
  occasion: 'Frühstück',
  food: 'Testmahlzeit',
  illness: 'nein',
}];
const analyses = meal.analyzeMeals(diary, cgm, [[mealMinute - 10, 46.2, 3.25, 100, 'Bolus']]);
assert.equal(analyses.length, 1);
assert.equal(analyses[0].complete, true);
assert.equal(analyses[0].baseline, 100);
assert.equal(analyses[0].peak, 178);
assert.equal(analyses[0].minutesToPeak, 60);
assert(analyses[0].turnMinute === null || analyses[0].turnMinute >= analyses[0].minute + analyses[0].minutesToPeak);

const emptyCards = core.buildRecommendations({
  diary: [], analyses: [], foodGroups: [], cgmRows: [], metrics: null,
});
assert.equal(emptyCards[0].title, 'Noch keine persönlichen Daten gespeichert');
assert(emptyCards[0].boundary.includes('keine Beispielwerte'));

const merged = app.mergeClinical(
  { cgm: [], boluses: [], imports: [], updatedAt: null },
  [parsedCgm, parsedBolus, parsedInsulin, parsedBasal, parsedBg, parsedAlarm],
);
assert.equal(merged.clinical.cgm.length, 3);
assert.equal(merged.clinical.boluses.length, 1);
assert.equal(merged.clinical.dailyInsulin.length, 1);
assert.equal(merged.clinical.basalEvents.length, 1);
assert.equal(merged.clinical.manualGlucose.length, 1);
assert.equal(merged.clinical.alarms.length, 1);

console.log('GlucoseCoach personal-local importer and meal contracts passed');
