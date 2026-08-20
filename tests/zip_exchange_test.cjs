'use strict';

const assert = require('node:assert/strict');
const app = require('../docs/app-v3.js');
const zip = require('../docs/app-zip-core.js');
const exportCore = require('../docs/app-export-core.js');

const MINUTE_MS = 60_000;

function localMinute(year, monthIndex, day, hour, minute) {
  return Math.round(new Date(year, monthIndex, day, hour, minute).getTime() / MINUTE_MS);
}

function payload() {
  const start = localMinute(2026, 7, 1, 8, 0);
  return {
    version: 'v2026.08.20.77-abcdef1',
    exportedAt: new Date(2026, 7, 20, 12, 0).toISOString(),
    profile: { id: 'zip-profile', createdAt: new Date(2026, 6, 1).toISOString() },
    ui: { windowDays: 'all' },
    diary: [{
      id: 'zip-diary',
      when: '2026-08-01T08:15',
      occasion: 'Frühstück',
      food: 'Hafermilch; "Bar"',
      carbs: '12.5',
      fat: '3',
      protein: '2',
      fiber: '1',
      activity: 'Spaziergang',
      sleep: '8',
      stress: '2',
      illness: 'nein',
      notes: '=SUM(A1:A2)',
    }],
    clinical: {
      cgm: [[start, 123, 0], [start + 5, null, -1], [start + 10, null, 1]],
      boluses: [[start + 1, 25, 2.25, 130, 'Bolus']],
      dailyInsulin: [[start + 2, 10, 20, 10]],
      basalEvents: [[start + 3, 'Temporär', 30, 80, 0.75, 0.4]],
      manualGlucose: [[start + 4, 129, 'manuell']],
      alarms: [[start + 5, '=Pod-Wechsel']],
      cgmCarbs: [[start + 6, 15]],
      exerciseEvents: [[start + 7, 'Gehen', 'mittel', 30, 120]],
      foodEvents: [[start + 8, 'Hafermilch', 12.5, 3, 2, 90, 'Glas', 1]],
      manualInsulin: [[start + 9, 'Korrektur', 1.5, 'schnell']],
      medications: [[start + 10, 'Ibuprofen', '400 mg', 'Tablette']],
      notes: [[start + 11, '=HYPERLINK("https://invalid.example")']],
      imports: [{
        at: new Date(2026, 7, 1, 10, 0).toISOString(),
        files: 12,
        kinds: ['cgm', 'bolus', 'dailyInsulin', 'basal', 'bg', 'alarm'],
        cgmAdded: 3,
        bolusesAdded: 1,
        dailyInsulinAdded: 1,
        basalEventsAdded: 1,
        manualGlucoseAdded: 1,
        alarmsAdded: 1,
        cgmCarbsAdded: 1,
        exerciseAdded: 1,
        foodAdded: 1,
        manualInsulinAdded: 1,
        medicationsAdded: 1,
        notesAdded: 1,
        rejected: 0,
      }],
      updatedAt: new Date(2026, 7, 1, 10, 0).toISOString(),
    },
  };
}

async function main() {
  const source = payload();
  const files = zip.buildExchangeFiles(source, exportCore);
  assert.deepEqual(
    files.map((file) => file.name),
    [...zip.IMPORT_FILE_DEFINITIONS.map((definition) => definition.filename), zip.COMPANION_FILENAME],
  );

  for (const definition of zip.IMPORT_FILE_DEFINITIONS) {
    const file = files.find((candidate) => candidate.name === definition.filename);
    assert.ok(file, `missing ${definition.filename}`);
    const header = file.text.replace(/^\uFEFF/, '').split(/\r?\n/)[1];
    assert.equal(header, definition.headers.map((value) => `"${value}"`).join(','));
  }

  const companionFile = files.find((file) => file.name === zip.COMPANION_FILENAME);
  const companionRows = exportCore.buildCompleteExportRows(source)
    .filter((row) => !['Klinische Daten', 'Kontextdaten'].includes(row.section));
  assert.ok(companionRows.length > 0);
  assert.equal(companionFile.text.includes('"Klinische Daten"'), false);
  assert.equal(companionFile.text.includes('"Kontextdaten"'), false);
  const companion = exportCore.parseCompleteCsv(companionFile.text);
  assert.deepEqual(companion.profile, source.profile);
  assert.deepEqual(companion.ui, source.ui);
  assert.deepEqual(companion.diary, source.diary);
  assert.deepEqual(companion.clinical.imports, source.clinical.imports);
  assert.equal(companion.clinical.updatedAt, source.clinical.updatedAt);
  for (const [key] of exportCore.CLINICAL_TYPES) assert.deepEqual(companion.clinical[key], []);

  const parsedItems = files
    .filter((file) => file.name !== zip.COMPANION_FILENAME)
    .map((file) => app.parseClinicalCsv(zip.unprotectGeneratedCsv(file.text), file.name));
  const restored = app.mergeClinical({}, parsedItems).clinical;
  for (const definition of zip.IMPORT_FILE_DEFINITIONS) {
    assert.deepEqual(restored[definition.key], source.clinical[definition.key], definition.key);
  }

  const archive = await zip.createZip(
    files.map((file) => ({ ...file, name: `Omnipod-Export/${file.name}` })),
    { date: new Date(2026, 7, 20, 12, 0), compress: true },
  );
  const entries = await zip.extractZip(archive);
  assert.equal(entries.length, files.length);
  assert.deepEqual(entries.map((entry) => entry.name), files.map((file) => file.name));
  const expanded = await zip.expandInputFile({
    name: 'omnipod-export.zip',
    type: 'application/zip',
    arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
  });
  assert.equal(expanded.length, files.length);
  assert.deepEqual(expanded.map((entry) => entry.name), files.map((file) => file.name));

  console.log('ZIP/CSV round-trip verified');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
