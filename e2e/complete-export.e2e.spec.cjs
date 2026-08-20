'use strict';

const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const exportCore = require('../docs/app-export-core.js');
const zipExchange = require('../docs/app-zip-core.js');

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

async function clearLocalData(page) {
  await page.evaluate(() => {
    localStorage.removeItem('glucosecoach-profile-v1');
    localStorage.setItem('glucosecoach-diary-v1', '[]');
    localStorage.setItem('glucosecoach-clinical-v1', '{}');
  });
  await page.reload();
  await expect(page.locator('#export-all')).toHaveText('CSV-ZIP herunterladen');
}

async function storedState(page) {
  return page.evaluate(() => ({
    profile: JSON.parse(localStorage.getItem('glucosecoach-profile-v1') || '{}'),
    diary: JSON.parse(localStorage.getItem('glucosecoach-diary-v1') || '[]'),
    clinical: JSON.parse(localStorage.getItem('glucosecoach-clinical-v1') || '{}'),
    windowDays: document.querySelector('#window-days')?.value,
  }));
}

function expectStoredPayload(stored, payload) {
  expect(stored.profile).toEqual(payload.profile);
  expect(stored.diary).toEqual(payload.diary);
  for (const [key] of exportCore.CLINICAL_TYPES) {
    expect(stored.clinical[key], `browser restore for ${key}`).toEqual(payload.clinical[key]);
  }
  expect(stored.clinical.imports).toEqual(payload.clinical.imports);
  expect(stored.clinical.updatedAt).toBe(payload.clinical.updatedAt);
  expect(stored.windowDays).toBe('all');
}

test('ZIP contract contains import-compatible CSV files without duplicated clinical rows', async () => {
  const payload = completePayload();
  const files = zipExchange.buildExchangeFiles(payload, exportCore);
  expect(files.map((file) => file.name)).toEqual([
    ...zipExchange.IMPORT_FILE_DEFINITIONS.map((definition) => definition.filename),
    zipExchange.COMPANION_FILENAME,
  ]);

  for (const definition of zipExchange.IMPORT_FILE_DEFINITIONS) {
    const file = files.find((candidate) => candidate.name === definition.filename);
    const header = file.text.replace(/^\uFEFF/, '').split(/\r?\n/)[1];
    expect(header).toBe(definition.headers.map((value) => `"${value}"`).join(','));
  }

  const companionFile = files.find((file) => file.name === zipExchange.COMPANION_FILENAME);
  expect(companionFile.text).not.toContain('"Klinische Daten"');
  expect(companionFile.text).not.toContain('"Kontextdaten"');
  const companion = exportCore.parseCompleteCsv(companionFile.text);
  expect(companion.profile).toEqual(payload.profile);
  expect(companion.diary).toEqual(payload.diary);
  expect(companion.clinical.imports).toEqual(payload.clinical.imports);
  for (const [key] of exportCore.CLINICAL_TYPES) expect(companion.clinical[key]).toEqual([]);

  const archive = await zipExchange.buildExchangeZip(payload, exportCore, { compress: true });
  const entries = await zipExchange.extractZip(archive);
  expect(entries.map((entry) => entry.name)).toEqual(files.map((file) => file.name));
});

test('browser exports, selects and drops the complete CSV ZIP round-trip', async ({ page }) => {
  const payload = completePayload();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.addInitScript((stored) => {
    localStorage.setItem('glucosecoach-profile-v1', JSON.stringify(stored.profile));
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(stored.diary));
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify(stored.clinical));
  }, payload);

  await page.goto('/');
  await expect(page.locator('#export-all')).toHaveText('CSV-ZIP herunterladen');
  await expect(page.locator('#import-complete-csv-label')).toHaveCount(0);
  await expect(page.locator('#csv-files')).toHaveAttribute('accept', /\.zip/);
  await expect(page.locator('#import-csv')).toContainText('CSV/ZIP');
  await expect(page.locator('body')).not.toContainText('JSON');

  await clickTab(page, 'overview');
  await page.locator('#window-days').selectOption('all');
  await clickTab(page, 'import-data');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-all').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^glucosecoach-csv-export-\d{4}-\d{2}-\d{2}\.zip$/,
  );
  const downloadPath = await download.path();
  const archive = await fs.readFile(downloadPath);
  const entries = await zipExchange.extractZip(archive);
  expect(entries.map((entry) => entry.name)).toEqual([
    ...zipExchange.IMPORT_FILE_DEFINITIONS.map((definition) => definition.filename),
    zipExchange.COMPANION_FILENAME,
  ]);
  for (const definition of zipExchange.IMPORT_FILE_DEFINITIONS) {
    const entry = entries.find((candidate) => candidate.name === definition.filename);
    const source = new TextDecoder().decode(entry.bytes);
    expect(source.split(/\r?\n/)[1]).toBe(
      definition.headers.map((value) => `"${value}"`).join(','),
    );
  }
  const companionEntry = entries.find((entry) => entry.name === zipExchange.COMPANION_FILENAME);
  const companionSource = new TextDecoder().decode(companionEntry.bytes);
  expect(companionSource).not.toContain('"Klinische Daten"');
  expect(companionSource).not.toContain('"Kontextdaten"');

  await clearLocalData(page);
  await page.locator('#csv-files').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: archive,
  });
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('CSV-ZIP vollständig importiert');
  expectStoredPayload(await storedState(page), payload);

  await clearLocalData(page);
  await page.evaluate((base64) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const file = new File([bytes], 'omnipod-export.zip', { type: 'application/zip' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document.querySelector('.import-drop').dispatchEvent(new DragEvent('dragenter', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
    document.querySelector('.import-drop').dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
  }, archive.toString('base64'));
  await expect(page.locator('#import-progress')).toContainText('CSV-ZIP vollständig importiert');
  expectStoredPayload(await storedState(page), payload);
  expect(browserErrors).toEqual([]);
});
