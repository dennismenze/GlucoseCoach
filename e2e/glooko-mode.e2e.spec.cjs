'use strict';

const { test, expect } = require('@playwright/test');
const zip = require('../docs/app-zip-core.js');

function quote(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function csv(metadata, headers, rows) {
  return [metadata, headers.map(quote).join(','), ...rows.map((row) => row.map(quote).join(','))].join('\r\n');
}

function clock(offsetMinutes) {
  const total = 9 * 60 + offsetMinutes;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `17.08.2026 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function glucoseAt(offset) {
  if (offset <= 0) return 100;
  if (offset <= 90) return Math.round(100 + (100 * offset) / 90);
  return Math.max(80, 200 - Math.round((offset - 90) * 0.4));
}

async function nativeGlookoZip() {
  const cgmRows = [];
  for (let offset = -60; offset <= 300; offset += 5) {
    cgmRows.push([clock(offset), glucoseAt(offset)]);
  }

  const files = [
    {
      name: 'Messdaten/cgm_data_1.csv',
      text: csv('Glooko Export', ['Zeitstempel', 'CGM-Glukosewert (mg/dl)'], cgmRows),
    },
    {
      name: 'Messdaten/bolus_data_1.csv',
      text: csv(
        'Glooko Export',
        [
          'Zeitstempel', 'Insulin-Typ', 'Blutzuckereingabe (mg/dl)',
          'Kohlenhydrataufnahme (g)', 'Abgegebenes Insulin (E)',
          'Anfängliche Abgabe (E)', 'Verzögerte Abgabe (E)',
        ],
        [[clock(-5), 'Bolus', 100, 45, 3, 3, 0]],
      ),
    },
    {
      name: 'Tagebuch/food_data_1.csv',
      text: csv(
        'Glooko Export',
        [
          'Zeitstempel', 'Name', 'KH (g)', 'Fett (g)', 'Eiweiß (g)',
          'Kalorien', 'Portionen', 'Anzahl der Portionen',
        ],
        [
          [clock(0), 'Haferflocken', 35, 7, 8, 230, 'Schale', 1],
          [clock(0), 'Hafermilch', 10, 2, 1, 60, 'Glas', 1],
        ],
      ),
    },
    {
      name: 'Tagebuch/cgm_carbs_data_1.csv',
      text: csv('Glooko Export', ['Zeitstempel', 'KH (g)'], [[clock(0), 45]]),
    },
  ];
  return Buffer.from(await zip.createZip(files, {
    compress: false,
    date: new Date('2026-08-17T12:00:00Z'),
  }));
}

test('native Glooko ZIP augments the still-editable local diary', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#glooko-source-control')).toHaveCount(1);
  await expect(page.locator('#glooko-meal-source')).toHaveCount(0);
  await page.locator('nav button[data-panel="diary"]').click();
  await expect(page.locator('#diary')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#diary-form')).toBeVisible();

  await page.locator('nav button[data-panel="import-data"]').click();
  await expect(page.locator('#glooko-workflow')).toContainText(
    'Alternativ oder ergänzend können Mahlzeiten weiterhin direkt',
  );
  await expect(page.locator('.import-drop p').first()).toContainText('Glooko-Webexport');

  const buffer = await nativeGlookoZip();
  await page.locator('#csv-files').setInputFiles({
    name: 'export_Testperson.zip',
    mimeType: 'application/zip',
    buffer,
  });
  await expect(page.locator('#selected-files')).toHaveText('1 Datei(en) ausgewählt (1 ZIP).');
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('Fertig:');
  await expect(page.locator('#overview')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#source-pill')).toHaveText(
    'Glooko-Export + lokales Tagebuch · lokal ausgewertet',
  );

  const storedAfterImport = await page.evaluate(() => ({
    diary: JSON.parse(localStorage.getItem('glucosecoach-diary-v1') || '[]'),
    clinical: JSON.parse(localStorage.getItem('glucosecoach-clinical-v1') || '{}'),
  }));
  expect(storedAfterImport.diary).toEqual([]);
  expect(storedAfterImport.clinical.foodEvents).toHaveLength(2);
  expect(storedAfterImport.clinical.cgmCarbs).toHaveLength(1);

  await page.locator('nav button[data-panel="meal-analysis"]').click();
  await expect(page.locator('#meal-summary strong')).toHaveText(['1', '1', '1', '1']);
  const meal = page.locator('#meal-events .analysis-item').first();
  await expect(meal.locator('.analysis-head strong')).toHaveText(
    'Frühstück · Haferflocken + Hafermilch',
  );
  await expect(meal.locator('.status')).toHaveText('vollständig');

  await page.locator('nav button[data-panel="diary"]').click();
  await expect(page.locator('#diary-form')).toBeVisible();
  await expect(page.locator('#glooko-source-control')).toContainText(
    'Beide Quellen fließen gemeinsam in die Auswertung ein',
  );
  const glookoEntry = page.locator('#entries .entry[data-source="glooko"]');
  await expect(glookoEntry).toHaveCount(1);
  await expect(glookoEntry).toContainText('Glooko · nur lesbar');
  await expect(glookoEntry.locator('.remove-entry')).toHaveCount(0);

  await page.locator('#when').fill('2026-08-17T16:00');
  await page.locator('#occasion').selectOption({ label: 'Snack' });
  await page.locator('#food').fill('Lokaler Testsnack');
  await page.locator('#carbs').fill('12');
  await page.locator('#diary-form button[type="submit"]').click();

  await expect(page.locator('#meal-analysis')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#meal-summary strong')).toHaveText(['2', '1', '1', '1']);

  const storedAfterLocalEntry = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('glucosecoach-diary-v1') || '[]'),
  );
  expect(storedAfterLocalEntry).toHaveLength(1);
  expect(storedAfterLocalEntry[0].food).toBe('Lokaler Testsnack');

  await page.locator('nav button[data-panel="diary"]').click();
  await expect(page.locator('#entries .entry[data-source="glooko"]')).toHaveCount(1);
  await expect(page.locator('#entries .entry[data-source="local"]')).toHaveCount(1);
  await expect(page.locator('#entries .remove-entry')).toHaveCount(1);
  await expect(page.locator('#entries')).toContainText('Lokaler Testsnack');

  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
