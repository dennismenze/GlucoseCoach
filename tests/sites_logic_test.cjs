'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'docs', 'app-v3.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'docs', 'app-v3-core.js'), 'utf8');
const importers = fs.readFileSync(path.join(root, 'docs', 'app-importers.js'), 'utf8');
const contextImporters = fs.readFileSync(path.join(root, 'docs', 'app-importers-context.js'), 'utf8');
const analytics = require(path.join(root, 'docs', 'app-v3.js'));

const minute = (iso) => Math.round(new Date(iso).getTime() / 60000);

assert.equal(analytics.GC_DIARY_KEY, 'glucosecoach-diary-v1');
assert.equal(analytics.GC_CLINICAL_KEY, 'glucosecoach-clinical-v1');
assert.equal(analytics.GC_PROFILE_KEY, 'glucosecoach-profile-v1');
assert(loader.includes('app-v3-core.js'));
assert(loader.includes('app-importers.js'));
assert(loader.includes('app-importers-context.js'));

for (const forbidden of [
  '25.382', '25382', '138.5', '6.62', '82.22', '16.55',
  'Veröffentlichter Ausgangsstand', 'STATIC_BASELINE',
]) {
  for (const [name, text] of [['HTML', html], ['core', core], ['importers', importers], ['context importers', contextImporters]]) {
    assert(!text.includes(forbidden), `${name} contains published patient baseline: ${forbidden}`);
  }
}

const cgmCsv = [
  'Name: discarded metadata',
  'Zeitstempel,CGM-Glukosewert (mg/dl)',
  '17.08.2026 09:00,100',
  '17.08.2026 09:05,2001',
  '17.08.2026 09:10,1',
].join('\n');
const parsedCgm = analytics.parseClinicalCsv(cgmCsv, 'cgm_data_1.csv');
assert.equal(parsedCgm.kind, 'cgm');
assert.deepEqual(parsedCgm.cgm.map((row) => row.slice(1)), [[100, 0], [null, 1], [null, -1]]);
assert.equal(parsedCgm.metadataRowsDiscarded, 1);

const bolusCsv = [
  'Metadata',
  'Zeitstempel,Kohlenhydrataufnahme (g),Abgegebenes Insulin (E),Blutzuckereingabe (mg/dl),Insulin-Typ,Anfängliche Abgabe (E),Verzögerte Abgabe (E)',
  '17.08.2026 08:50,"46,2","3,25",100,Bolus,"3,25",0',
].join('\n');
const parsedBolus = analytics.parseClinicalCsv(bolusCsv, 'bolus_data_1.csv');
assert.equal(parsedBolus.kind, 'bolus');
assert.equal(parsedBolus.boluses[0][1], 46.2);
assert.equal(parsedBolus.boluses[0][2], 3.25);

const insulinCsv = [
  'Metadata',
  'Zeitstempel,Bolus gesamt (U),Insulin gesamt (U),Basal gesamt (U)',
  '17.08.2026 23:59,"12,5","31,2","18,7"',
].join('\n');
const parsedInsulin = analytics.parseClinicalCsv(insulinCsv, 'insulin_data_1.csv');
assert.equal(parsedInsulin.kind, 'dailyInsulin');
assert.deepEqual(parsedInsulin.dailyInsulin[0].slice(1), [12.5, 31.2, 18.7]);

const basalCsv = [
  'Metadata',
  'Zeitstempel,Insulin-Typ,Dauer (Minuten),Prozentsatz (%),Rate,Abgegebenes Insulin (E)',
  '17.08.2026 08:00,Basal,30,100,"0,8","0,4"',
].join('\n');
const parsedBasal = analytics.parseClinicalCsv(basalCsv, 'basal_data_1.csv');
assert.equal(parsedBasal.kind, 'basal');
assert.equal(parsedBasal.basalEvents.length, 1);
assert.equal(parsedBasal.boluses.length, 0, 'basal rows must never be misclassified as boluses');

const bgCsv = [
  'Metadata',
  'Zeitstempel,Glukosewert (mg/dl),Manuelles Lesen',
  '17.08.2026 08:05,123,M',
].join('\n');
const parsedBg = analytics.parseClinicalCsv(bgCsv, 'bg_data_1.csv');
assert.equal(parsedBg.kind, 'bg');
assert.deepEqual(parsedBg.manualGlucose[0].slice(1), [123, 'M']);

const alarmCsv = [
  'Metadata',
  'Zeitstempel,Alarm/Ereignis',
  '17.08.2026 08:10,Pod abgelaufen',
].join('\n');
const parsedAlarm = analytics.parseClinicalCsv(alarmCsv, 'alarms_data_1.csv');
assert.equal(parsedAlarm.kind, 'alarm');
assert.equal(parsedAlarm.alarms[0][1], 'Pod abgelaufen');

const emptyCgmCarbs = analytics.parseClinicalCsv(
  'Metadata\nZeitstempel,KH (g)\n',
  'cgm_carbs_data_1.csv',
);
assert.equal(emptyCgmCarbs.kind, 'cgmCarbs');
assert.equal(emptyCgmCarbs.cgmCarbs.length, 0, 'empty cgm_carbs export must be accepted');
assert.equal(emptyCgmCarbs.rejected, 0);

const parsedCgmCarbs = analytics.parseClinicalCsv(
  'Metadata\nZeitstempel,KH (g)\n17.08.2026 08:45,"12,5"\n',
  'cgm_carbs_data_1.csv',
);
assert.deepEqual(parsedCgmCarbs.cgmCarbs[0].slice(1), [12.5]);

const parsedExercise = analytics.parseClinicalCsv(
  'Metadata\nZeitstempel,Name,Intensität,Dauer (Minuten),Verbrannte Kalorien\n17.08.2026 18:00,Spaziergang,Mittel,30,120\n',
  'exercise_data_1.csv',
);
assert.equal(parsedExercise.kind, 'exercise');
assert.equal(parsedExercise.exerciseEvents.length, 1);

const parsedFood = analytics.parseClinicalCsv(
  'Metadata\nZeitstempel,Name,KH (g),Fett,Eiweiß,Kalorien,Portionen,Anzahl der Portionen\n17.08.2026 09:00,Frühstück,"46,2","7,9","9,7",300,Schale,1\n',
  'food_data_1.csv',
);
assert.equal(parsedFood.kind, 'food');
assert.equal(parsedFood.foodEvents[0][2], 46.2);

const parsedManualInsulin = analytics.parseClinicalCsv(
  'Metadata\nZeitstempel,Name,Wert,Insulin-Typ\n17.08.2026 11:00,Korrektur,"1,5",Schnell\n',
  'manual_insulin_data_1.csv',
);
assert.equal(parsedManualInsulin.kind, 'manualInsulin');
assert.equal(parsedManualInsulin.manualInsulin[0][2], 1.5);

const parsedMedication = analytics.parseClinicalCsv(
  'Metadata\nZeitstempel,Name,Wert,Medikamententyp\n17.08.2026 12:00,Beispiel,1,Tablette\n',
  'medication_data_1.csv',
);
assert.equal(parsedMedication.kind, 'medication');
assert.equal(parsedMedication.medications.length, 1);

const parsedNote = analytics.parseClinicalCsv(
  'Metadata\nZeitstempel,Wert\n17.08.2026 13:00,Testnotiz\n',
  'notes_data_1.csv',
);
assert.equal(parsedNote.kind, 'note');
assert.equal(parsedNote.notes[0][1], 'Testnotiz');

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

const emptyCards = analytics.buildRecommendations({
  diary: [], analyses: [], foodGroups: [], cgmRows: [], metrics: null,
});
assert.equal(emptyCards[0].title, 'Noch keine persönlichen Daten gespeichert');
assert(emptyCards[0].boundary.includes('keine Beispielwerte'));

const merged = analytics.mergeClinical(
  { cgm: [], boluses: [], imports: [], updatedAt: null },
  [
    parsedCgm, parsedBolus, parsedInsulin, parsedBasal, parsedBg, parsedAlarm,
    parsedCgmCarbs, parsedExercise, parsedFood, parsedManualInsulin, parsedMedication, parsedNote,
  ],
);
assert.equal(merged.clinical.cgm.length, 3);
assert.equal(merged.clinical.boluses.length, 1);
assert.equal(merged.clinical.dailyInsulin.length, 1);
assert.equal(merged.clinical.basalEvents.length, 1);
assert.equal(merged.clinical.manualGlucose.length, 1);
assert.equal(merged.clinical.alarms.length, 1);
assert.equal(merged.clinical.cgmCarbs.length, 1);
assert.equal(merged.clinical.exerciseEvents.length, 1);
assert.equal(merged.clinical.foodEvents.length, 1);
assert.equal(merged.clinical.manualInsulin.length, 1);
assert.equal(merged.clinical.medications.length, 1);
assert.equal(merged.clinical.notes.length, 1);
assert.equal(merged.summary.files, 12);

console.log('GlucoseCoach personal-local + complete Omnipod importer tests passed');
