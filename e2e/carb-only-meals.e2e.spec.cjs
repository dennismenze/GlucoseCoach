'use strict';

const { test, expect } = require('@playwright/test');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(`${iso}:00`).getTime() / MINUTE_MS);
}

function timestamp(value) {
  const date = new Date(value * MINUTE_MS);
  const two = (number) => String(number).padStart(2, '0');
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}`;
}

function lateMealCurve(when) {
  const start = minute(when);
  const rows = [
    [start - 60, 101],
    [start - 30, 101],
    [start - 15, 102],
    [start - 10, 101],
    [start - 5, 100],
    [start, 100],
  ];
  for (let offset = 5; offset <= 300; offset += 5) {
    const value = offset <= 205
      ? Math.round(100 + (123 * offset) / 205)
      : 223 - Math.round((offset - 205) * 0.8);
    rows.push([start + offset, value]);
  }
  return rows;
}

function cgmCsv(rows) {
  return [
    'Name:Testperson',
    'Zeitstempel,CGM-Glukosewert (mg/dl)',
    ...rows.sort((a, b) => a[0] - b[0]).map((row) => `${timestamp(row[0])},${row[1]}`),
  ].join('\n');
}

function bolusCsv(rows) {
  return [
    'Name:Testperson',
    'Zeitstempel,Kohlenhydrataufnahme (g),Abgegebenes Insulin (E),Blutzuckereingabe (mg/dl),Insulin-Typ',
    ...rows.map((row) => [
      timestamp(row[0]),
      row[1] === null || row[1] === undefined ? '' : `"${String(row[1]).replace('.', ',')}"`,
      row[2] === null || row[2] === undefined ? '' : `"${String(row[2]).replace('.', ',')}"`,
      row[3] ?? '',
      row[4] ?? '',
    ].join(',')),
  ].join('\n');
}

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

async function addMeal(page, entry) {
  await clickTab(page, 'diary');
  await page.locator('#entry-type').selectOption('meal');
  await page.locator('#when').fill(entry.when);
  await page.locator('#occasion').selectOption({ label: entry.occasion || 'Snack' });
  await page.locator('#food').fill(entry.food);
  if (entry.carbs) await page.locator('#carbs').fill(entry.carbs);
  else await page.locator('#carbs').fill('');
  await page.locator('#diary-form button[type="submit"]').click();
  await expect(page.locator('#meal-analysis')).toHaveClass(/\bactive\b/);
}

async function gridCell(item, label) {
  return item.locator('.analysis-grid > div').filter({ hasText: label });
}

test('carbohydrates without meal insulin are analyzed and unusable meal entries are omitted', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const usable = { when: '2026-08-19T07:30', food: 'Apfel', carbs: '18' };
  const noCarbs = { when: '2026-08-20T07:30', food: 'Korrektur ohne KH', carbs: '' };
  const unusable = { when: '2026-08-21T07:30', food: 'Nicht nutzbare Mahlzeit', carbs: '15' };
  const importedCarbsWhen = '2026-08-22T07:30';

  await page.goto('/');
  await addMeal(page, usable);
  await addMeal(page, noCarbs);
  await addMeal(page, unusable);

  const usableStart = minute(usable.when);
  const noCarbsStart = minute(noCarbs.when);
  const unusableStart = minute(unusable.when);
  const importedStart = minute(importedCarbsWhen);
  const cgm = [
    ...lateMealCurve(usable.when),
    [unusableStart - 5, 100],
    [unusableStart + 5, 108],
    [unusableStart + 10, 112],
    ...lateMealCurve(importedCarbsWhen),
  ];
  const boluses = [
    [usableStart + 60, null, 0.6, 150, 'Korrektur'],
    [noCarbsStart + 10, null, 0.8, 160, 'Bolus'],
    [importedStart, 20, null, null, ''],
  ];

  await clickTab(page, 'import-data');
  await page.locator('#csv-files').setInputFiles([
    {
      name: 'cgm_data_carb_only.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(cgmCsv(cgm), 'utf8'),
    },
    {
      name: 'bolus_data_carb_only.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(bolusCsv(boluses), 'utf8'),
    },
  ]);
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('Fertig:');
  await clickTab(page, 'meal-analysis');

  await expect(page.locator('#meal-summary strong')).toHaveText(['2', '2', '0', '2']);
  const items = page.locator('#meal-events .analysis-item');
  await expect(items).toHaveCount(2);

  const imported = items.nth(0);
  await expect(imported.locator('.analysis-head strong')).toHaveText(
    'Frühstück · Glooko-Kohlenhydrate',
  );
  await expect(imported.locator('.status')).toHaveText('vollständig · ohne Mahlzeiteninsulin');
  await expect((await gridCell(imported, 'Peak nach Essen')).locator('strong'))
    .toHaveText('223 mg/dl · 205 min nach Essen');
  await expect((await gridCell(imported, 'maßgeblicher Mahlzeitenbolus')).locator('strong'))
    .toHaveText('kein Insulin zur Mahlzeit abgegeben · 20 g KH erfasst');

  const apple = items.nth(1);
  await expect(apple.locator('.analysis-head strong')).toHaveText('Snack · Apfel');
  await expect(apple.locator('.status')).toHaveText('vollständig · ohne Mahlzeiteninsulin');
  await expect((await gridCell(apple, 'Peak nach Essen')).locator('strong'))
    .toHaveText('223 mg/dl · 205 min nach Essen');
  await expect((await gridCell(apple, 'maßgeblicher Mahlzeitenbolus')).locator('strong'))
    .toHaveText(
      'kein Insulin zur Mahlzeit abgegeben · 18 g KH erfasst · ' +
      '1 Korrekturbolus ohne KH-Angabe im Verlauf',
    );
  await expect((await gridCell(apple, 'Stabil bestätigter Rückgang')).locator('strong'))
    .toHaveText('205 min nach Essen');

  await expect(page.locator('#meal-events')).not.toContainText('Korrektur ohne KH');
  await expect(page.locator('#meal-events')).not.toContainText('Nicht nutzbare Mahlzeit');
  await expect(page.locator('#meal-method-explanation')).toContainText(
    'Wurde zu den Kohlenhydraten kein Insulin abgegeben',
  );
  await expect(page.locator('#meal-method-explanation')).toContainText(
    'Nicht auswertbare Mahlzeiten werden in dieser Ansicht nicht angezeigt',
  );

  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
