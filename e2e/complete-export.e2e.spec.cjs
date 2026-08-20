'use strict';

const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const {
  CSV_SCHEMA,
  CLINICAL_TYPES,
  EXPORT_COLUMNS,
  buildCompleteCsv,
  buildCompleteExportRows,
  parseCompleteCsv,
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
      cgmAdded: 1,
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
      rejected: 2,
    }],
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
  return {
    version: 'v2026.08.20.42-abcdef1',
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

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

test('single canonical CSV preserves every local dataset without redundant rows', () => {
  const payload = completePayload();
  const rows = buildCompleteExportRows(payload);
  const dataRows = rows.filter((row) =>
    ['Klinische Daten', 'Kontextdaten'].includes(row.section),
  );

  expect(dataRows.map((row) => row.dataType)).toEqual(CLINICAL_TYPES.map(([, label]) => label));
  expect(rows.some((row) => row.section === 'Bestand')).toBe(false);
  expect(EXPORT_COLUMNS.map(([, label]) => label)).not.toContain('Rohdaten_JSON');
  expect(EXPORT_COLUMNS.map(([, label]) => label)).not.toContain('Zeitstempel_lokal');
  expect(EXPORT_COLUMNS.map(([, label]) => label).some((label) => /JSON/i.test(label))).toBe(false);

  const csv = buildCompleteCsv(payload);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  const restored = parseCompleteCsv(csv);
  expect(restored.schema).toBe(CSV_SCHEMA);
  expect(restored.version).toBe(payload.version);
  expect(restored.profile).toEqual(payload.profile);
  expect(restored.ui).toEqual(payload.ui);
  expect(restored.diary).toEqual(payload.diary);
  for (const [key] of CLINICAL_TYPES) {
    expect(restored.clinical[key], `round trip for ${key}`).toEqual(payload.clinical[key]);
  }
  expect(restored.clinical.imports).toEqual(payload.clinical.imports);
  expect(restored.clinical.updatedAt).toBe(payload.clinical.updatedAt);
});

test('browser offers only the complete CSV and restores it without JSON controls', async ({ page }) => {
  const payload = completePayload();
  await page.addInitScript((stored) => {
    localStorage.setItem('glucosecoach-profile-v1', JSON.stringify(stored.profile));
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(stored.diary));
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify(stored.clinical));
  }, payload);

  await page.goto('/');
  await expect(page.locator('#import-complete-csv')).toBeAttached();
  await expect(page.locator('#export-all')).toHaveText('Vollständige CSV herunterladen');
  await expect(page.locator('#export-all-json')).toHaveCount(0);
  await expect(page.locator('#export-diary')).toHaveCount(0);
  await expect(page.locator('#import-diary')).toHaveCount(0);
  await expect(page.locator('#import-all')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('JSON');

  await clickTab(page, 'overview');
  await page.locator('#window-days').selectOption('all');
  await clickTab(page, 'import-data');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-all').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^glucosecoach-vollstaendig-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const downloadPath = await download.path();
  const csv = await fs.readFile(downloadPath, 'utf8');
  expect(csv).not.toContain('Rohdaten_JSON');
  expect(csv).not.toContain('Zeitstempel_lokal');
  const parsed = parseCompleteCsv(csv);
  expect(parsed.profile).toEqual(payload.profile);

  await page.evaluate(() => {
    localStorage.removeItem('glucosecoach-profile-v1');
    localStorage.setItem('glucosecoach-diary-v1', '[]');
    localStorage.setItem('glucosecoach-clinical-v1', '{}');
  });
  await page.reload();
  await expect(page.locator('#import-complete-csv')).toBeAttached();
  await page.locator('#import-complete-csv').setInputFiles(downloadPath);
  await expect(page.locator('#import-progress')).toContainText('Vollständige CSV importiert');

  const stored = await page.evaluate(() => ({
    profile: JSON.parse(localStorage.getItem('glucosecoach-profile-v1') || '{}'),
    diary: JSON.parse(localStorage.getItem('glucosecoach-diary-v1') || '[]'),
    clinical: JSON.parse(localStorage.getItem('glucosecoach-clinical-v1') || '{}'),
    windowDays: document.querySelector('#window-days')?.value,
  }));
  expect(stored.profile).toEqual(payload.profile);
  expect(stored.diary).toEqual(payload.diary);
  for (const [key] of CLINICAL_TYPES) {
    expect(stored.clinical[key], `browser restore for ${key}`).toEqual(payload.clinical[key]);
  }
  expect(stored.clinical.imports).toEqual(payload.clinical.imports);
  expect(stored.clinical.updatedAt).toBe(payload.clinical.updatedAt);
  expect(stored.windowDays).toBe('all');
});
