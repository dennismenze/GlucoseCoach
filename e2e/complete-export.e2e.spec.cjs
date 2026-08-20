'use strict';

const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const {
  BACKUP_SCHEMA,
  CLINICAL_TYPES,
  EXPORT_COLUMNS,
  buildBackupPayload,
  buildCompleteCsv,
  buildCompleteExportRows,
} = require('../docs/app-export-core.js');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function completePayload() {
  const start = minute('2026-08-01T08:00:00+02:00');
  const clinical = {
    cgm: [[start, 123, 0]],
    boluses: [[start + 1, 25, 2.25, 130, 'Bolus']],
    dailyInsulin: [[start + 2, 10, 20, 10]],
    basalEvents: [[start + 3, 'Temporär', 30, 80, 0.75, 0.4]],
    manualGlucose: [[start + 4, 129, 'manuell']],
    alarms: [[start + 5, 'Pod-Wechsel']],
    cgmCarbs: [[start + 6, 15]],
    exerciseEvents: [[start + 7, 'Gehen', 'mittel', 30, 120]],
    foodEvents: [[start + 8, 'Hafermilch', 12.5, 3, 2, 90, 'Glas', 1]],
    manualInsulin: [[start + 9, 'Korrektur', 1.5, 'schnell']],
    medications: [[start + 10, 'Ibuprofen', '400 mg', 'Tablette']],
    notes: [[start + 11, 'Notiz; "vollständig"']],
    imports: [{
      at: '2026-08-01T10:00:00.000Z',
      files: 12,
      kinds: ['cgm', 'bolus', 'dailyInsulin', 'basal', 'bg', 'alarm'],
      rejected: 2,
    }],
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
  return {
    exportedAt: '2026-08-20T10:00:00.000Z',
    profile: { id: 'profile-complete-export', createdAt: '2026-07-01T00:00:00.000Z' },
    ui: { windowDays: 'all' },
    diary: [{
      id: 'diary-complete-export',
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
      notes: '=SUM(A1:A2); "quoted"',
    }],
    clinical,
  };
}

function parseSemicolonCsv(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const text = String(source).replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && character === ';') {
      row.push(field);
      field = '';
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  row.push(field);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

test('complete CSV and JSON builders preserve every local dataset', () => {
  const payload = completePayload();
  const rows = buildCompleteExportRows(payload);
  const dataRows = rows.filter((row) => ['Klinische Daten', 'Kontextdaten'].includes(row.section));

  expect(dataRows.map((row) => row.dataType)).toEqual(CLINICAL_TYPES.map(([, label]) => label));
  for (const [key, label] of CLINICAL_TYPES) {
    const inventory = rows.find((row) => row.section === 'Bestand' && row.dataType === label);
    expect(inventory?.value, `inventory count for ${key}`).toBe(1);
    const data = dataRows.find((row) => row.dataType === label);
    expect(JSON.parse(data.rawJson), `raw JSON for ${key}`).toEqual(payload.clinical[key][0]);
  }

  const csv = buildCompleteCsv(payload);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  const parsed = parseSemicolonCsv(csv);
  expect(parsed[0]).toEqual(EXPORT_COLUMNS.map(([, label]) => label));
  for (const row of parsed) expect(row).toHaveLength(EXPORT_COLUMNS.length);

  const sectionIndex = parsed[0].indexOf('Bereich');
  const typeIndex = parsed[0].indexOf('Datentyp');
  const noteIndex = parsed[0].indexOf('Notiz');
  const rawIndex = parsed[0].indexOf('Rohdaten_JSON');
  const diaryRow = parsed.find((row) => row[sectionIndex] === 'Tagebuch');
  expect(diaryRow[noteIndex]).toBe('\'=SUM(A1:A2); "quoted"');
  expect(JSON.parse(diaryRow[rawIndex])).toEqual(payload.diary[0]);
  for (const [, label] of CLINICAL_TYPES) {
    expect(parsed.some((row) => row[typeIndex] === label)).toBe(true);
  }

  const backup = buildBackupPayload(payload);
  expect(backup.schema).toBe(BACKUP_SCHEMA);
  expect(backup.profile).toEqual(payload.profile);
  expect(backup.ui).toEqual(payload.ui);
  expect(backup.diary).toEqual(payload.diary);
  expect(backup.clinical).toEqual(payload.clinical);
});

test('browser downloads complete CSV and complete JSON backup', async ({ page }) => {
  const payload = completePayload();
  await page.addInitScript((stored) => {
    localStorage.setItem('glucosecoach-profile-v1', JSON.stringify(stored.profile));
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(stored.diary));
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify(stored.clinical));
  }, payload);
  await page.goto('/');
  await expect(page.locator('#export-all')).toHaveText('Vollständige CSV herunterladen');
  await clickTab(page, 'overview');
  await page.locator('#window-days').selectOption('all');
  await clickTab(page, 'import-data');

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-all').click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/^glucosecoach-vollstaendig-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await fs.readFile(await csvDownload.path(), 'utf8');
  const parsed = parseSemicolonCsv(csv);
  const typeIndex = parsed[0].indexOf('Datentyp');
  for (const [, label] of CLINICAL_TYPES) {
    expect(parsed.some((row) => row[typeIndex] === label), `browser CSV contains ${label}`).toBe(true);
  }
  expect(csv).toContain('profile-complete-export');
  expect(csv).toContain('diary-complete-export');
  expect(csv).toContain('Importvorgang');

  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-all-json').click(),
  ]);
  expect(jsonDownload.suggestedFilename()).toMatch(/^glucosecoach-gesamtsicherung-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(await fs.readFile(await jsonDownload.path(), 'utf8'));
  expect(backup.schema).toBe(BACKUP_SCHEMA);
  expect(backup.profile).toEqual(payload.profile);
  expect(backup.ui.windowDays).toBe('all');
  expect(backup.diary).toEqual(payload.diary);
  for (const [key] of CLINICAL_TYPES) expect(backup.clinical[key]).toEqual(payload.clinical[key]);
});
