'use strict';

const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const {
  CSV_FORMAT,
  CLINICAL_TYPES,
  EXPORT_COLUMNS,
  buildCompleteCsv,
  buildCompleteExportRows,
  parseCompleteCsv,
  parseDelimited,
} = require('../docs/app-export-core.js');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function completePayload() {
  const start = minute('2026-08-01T08:00:00+02:00');
  const clinical = {
    cgm: [[start, 123, 0], [start + 1, null, -1], [start + 2, null, 1]],
    boluses: [[start + 3, 25, 2.25, 130, 'Bolus']],
    dailyInsulin: [[start + 4, 10, 20, 10]],
    basalEvents: [[start + 5, 'Temporär', 30, 80, 0.75, 0.4]],
    manualGlucose: [[start + 6, 129, 'manuell']],
    alarms: [[start + 7, 'Pod-Wechsel']],
    cgmCarbs: [[start + 8, 15]],
    exerciseEvents: [[start + 9, 'Gehen', 'mittel', 30, 120]],
    foodEvents: [[start + 10, 'Hafermilch', 12.5, 3, 2, 90, 'Glas', 1]],
    manualInsulin: [[start + 11, 'Korrektur', 1.5, 'schnell']],
    medications: [[start + 12, 'Ibuprofen', '400 mg', 'Tablette']],
    notes: [[start + 13, 'Notiz; "vollständig"']],
    imports: [{
      at: '2026-08-01T10:00:00.000Z',
      files: 12,
      kinds: ['cgm', 'bolus', 'dailyInsulin', 'basal', 'bg', 'alarm'],
      rejected: 2,
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
      notes: '=SUM(A1:A2); "quoted"\nzweite Zeile',
    }],
    clinical,
  };
}

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

function expectRestoredPayload(restored, payload) {
  expect(restored.format).toBe(CSV_FORMAT);
  expect(restored.profile).toEqual(payload.profile);
  expect(restored.ui).toEqual(payload.ui);
  expect(restored.diary).toEqual(payload.diary);
  for (const [key] of CLINICAL_TYPES) {
    expect(restored.clinical[key], key).toEqual(payload.clinical[key]);
  }
  expect(restored.clinical.imports).toEqual(payload.clinical.imports);
  expect(restored.clinical.updatedAt).toBe(payload.clinical.updatedAt);
}

test('one non-redundant CSV round-trips every local dataset', () => {
  const payload = completePayload();
  const rows = buildCompleteExportRows(payload);
  const dataRows = rows.filter((row) => CLINICAL_TYPES.some(([, label]) => label === row.dataType));

  expect(dataRows.map((row) => row.dataType)).toEqual([
    'CGM', 'CGM', 'CGM', ...CLINICAL_TYPES.slice(1).map(([, label]) => label),
  ]);
  expect(rows.some((row) => row.dataType === 'Tagebucheintrag')).toBe(true);
  expect(rows.some((row) => row.dataType === 'Importvorgang')).toBe(true);
  expect(rows.some((row) => row.dataType === 'Bestand')).toBe(false);

  const csv = buildCompleteCsv(payload);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).not.toContain('Rohdaten_JSON');
  expect(csv).not.toContain('Zeitstempel_lokal');
  expect(csv).not.toContain('Zeitstempel_ISO');
  expect(csv).not.toContain('{"id":"diary-complete-export"');

  const parsed = parseDelimited(csv);
  expect(parsed[0]).toEqual(EXPORT_COLUMNS.map(([, label]) => label));
  for (const row of parsed) expect(row).toHaveLength(EXPORT_COLUMNS.length);

  const restored = parseCompleteCsv(csv);
  expectRestoredPayload(restored, payload);
});

test('browser exposes only CSV, downloads it and restores the complete local state', async ({ page }) => {
  const payload = completePayload();
  await page.addInitScript((stored) => {
    localStorage.setItem('glucosecoach-profile-v1', JSON.stringify(stored.profile));
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(stored.diary));
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify(stored.clinical));
  }, payload);
  await page.goto('/');
  await expect(page.locator('#export-all')).toHaveText('Vollständige CSV herunterladen');
  await expect(page.locator('#app-version')).toHaveText(/^Version \d{4}\.\d{2}\.\d{2}\.\d+ · [a-z0-9-]{7}$/i);
  await expect(page.getByText(/JSON/i)).toHaveCount(0);
  for (const selector of ['#export-all-json', '#export-diary', '#import-diary', '#import-all']) {
    await expect(page.locator(selector)).toHaveCount(0);
  }

  await clickTab(page, 'overview');
  await page.locator('#window-days').selectOption('all');
  await clickTab(page, 'import-data');

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-all').click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/^glucosecoach-vollstaendig-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await fs.readFile(await csvDownload.path(), 'utf8');
  expectRestoredPayload(parseCompleteCsv(csv), payload);

  await page.evaluate(() => {
    localStorage.removeItem('glucosecoach-profile-v1');
    localStorage.removeItem('glucosecoach-diary-v1');
    localStorage.removeItem('glucosecoach-clinical-v1');
  });
  await page.reload();
  await clickTab(page, 'import-data');
  await page.locator('#import-complete-csv').setInputFiles({
    name: 'glucosecoach-vollstaendig.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await expect(page.locator('#complete-csv-progress')).toContainText('Wiederhergestellt:');
  await expect(page.locator('#overview')).toHaveClass(/\bactive\b/);

  const stored = await page.evaluate(() => ({
    profile: JSON.parse(localStorage.getItem('glucosecoach-profile-v1') || 'null'),
    diary: JSON.parse(localStorage.getItem('glucosecoach-diary-v1') || '[]'),
    clinical: JSON.parse(localStorage.getItem('glucosecoach-clinical-v1') || '{}'),
    window: document.querySelector('#window-days')?.value,
  }));
  expect(stored.profile).toEqual(payload.profile);
  expect(stored.diary).toEqual(payload.diary);
  for (const [key] of CLINICAL_TYPES) expect(stored.clinical[key]).toEqual(payload.clinical[key]);
  expect(stored.clinical.imports).toEqual(payload.clinical.imports);
  expect(stored.window).toBe('all');
});
