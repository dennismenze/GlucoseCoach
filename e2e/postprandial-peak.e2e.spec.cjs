'use strict';

const { test, expect } = require('@playwright/test');

const MINUTE_MS = 60_000;

function localMinute(iso) {
  return Math.round(new Date(`${iso}:00`).getTime() / MINUTE_MS);
}

function exportTimestamp(minute) {
  const date = new Date(minute * MINUTE_MS);
  const two = (value) => String(value).padStart(2, '0');
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function curve(when, valueAtOffset) {
  const start = localMinute(when);
  const rows = [
    [start - 60, 101],
    [start - 30, 101],
    [start - 15, 102],
    [start - 10, 101],
    [start - 5, 100],
    [start, 100],
  ];
  for (let offset = 5; offset <= 300; offset += 5) {
    rows.push([start + offset, valueAtOffset(offset)]);
  }
  return rows;
}

function lateFatCurve(when) {
  return curve(when, (offset) => {
    if (offset <= 205) return Math.round(100 + (123 * offset) / 205);
    return 223 - Math.round((offset - 205) * 0.8);
  });
}

function splitBolusCurve(when) {
  return curve(when, (offset) => {
    if (offset <= 120) return Math.round(100 + (140 * offset) / 120);
    if (offset <= 145) return 240 - Math.round((offset - 120) * 0.8);
    if (offset === 150) return 220;
    if (offset === 155) return 216;
    if (offset === 160) return 212;
    if (offset === 165) return 218;
    if (offset <= 220) return Math.round(218 + (12 * (offset - 165)) / 55);
    return 230 - Math.round((offset - 220) * 0.8);
  });
}

function hysteresisCurve(when) {
  const values = {
    5: 108, 10: 118, 15: 128, 20: 135, 25: 130, 30: 127,
    35: 140, 40: 145, 45: 150, 50: 154, 55: 156, 60: 158,
    65: 159, 70: 160, 75: 161, 80: 158, 85: 155, 90: 151,
    95: 147, 100: 143, 105: 139, 110: 135, 115: 131, 120: 127,
    125: 123, 130: 119, 135: 115, 140: 111, 145: 107, 150: 103,
    155: 99, 160: 95, 165: 91, 170: 87, 175: 83, 180: 79,
  };
  return curve(when, (offset) => values[offset] ?? Math.max(70, 79 - Math.round((offset - 180) * 0.2)));
}

function cgmCsv(rows) {
  return [
    'Name:Testperson',
    'Zeitstempel,CGM-Glukosewert (mg/dl)',
    ...rows.sort((a, b) => a[0] - b[0]).map((row) => `${exportTimestamp(row[0])},${row[1]}`),
  ].join('\n');
}

function bolusCsv(rows) {
  return [
    'Name:Testperson',
    'Zeitstempel,Kohlenhydrataufnahme (g),Abgegebenes Insulin (E),Blutzuckereingabe (mg/dl),Insulin-Typ',
    ...rows.map((row) => [
      exportTimestamp(row[0]),
      `"${String(row[1]).replace('.', ',')}"`,
      `"${String(row[2]).replace('.', ',')}"`,
      row[3],
      row[4],
    ].join(',')),
  ].join('\n');
}

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

async function addDiaryEntry(page, entry) {
  await clickTab(page, 'diary');
  await page.locator('#when').fill(entry.when);
  await page.locator('#occasion').selectOption({ label: entry.occasion || 'Frühstück' });
  await page.locator('#food').fill(entry.food || 'Fettreiches Testessen');
  await page.locator('#carbs').fill(entry.carbs || '40');
  await page.locator('#fat').fill(entry.fat || '25');
  await page.locator('#protein').fill(entry.protein || '15');
  await page.locator('#fiber').fill(entry.fiber || '4');
  await page.locator('#illness').selectOption('nein');
  await page.locator('#diary-form button[type="submit"]').click();
  await expect(page.locator('#meal-analysis')).toHaveClass(/\bactive\b/);
}

async function gridCell(item, label) {
  return item.locator('.analysis-grid > div').filter({ hasText: label });
}

function collectBrowserErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

test('correction boluses do not replace the meal bolus or postpone its peak turn', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const entries = [
    { when: '2026-08-17T07:30', food: 'Fettreiches Testessen' },
    { when: '2026-08-18T07:30', food: 'Fettreiches Testessen' },
  ];
  const firstStart = localMinute(entries[0].when);
  const secondStart = localMinute(entries[1].when);
  const rows = [
    ...lateFatCurve(entries[0].when),
    ...splitBolusCurve(entries[1].when),
  ];
  const boluses = [
    [firstStart + 10, 40, 1.2, 100, 'Bolus'],
    [firstStart + 120, 0, 0.5, 170, 'Korrektur'],
    [secondStart + 10, 40, 1.2, 100, 'Bolus'],
    [secondStart + 90, 0, 0.4, 205, 'Korrektur'],
    [secondStart + 150, 0, 0.6, 220, 'Korrektur'],
  ];

  await page.goto('/');
  const intro = page.locator('#meal-analysis article.card.full p.muted');
  await expect(intro).toContainText('nicht mehr auf zwei Stunden begrenzt');
  await expect(intro).toContainText('Bis zu fünf Stunden');
  await expect(intro).toContainText('mahlzeitennaher positiver Bolus');
  await expect(intro).toContainText('starten den Peak nicht neu');
  await expect(intro).toContainText('mögliche Korrekturen');

  for (const entry of entries) await addDiaryEntry(page, entry);

  await clickTab(page, 'import-data');
  await page.locator('#csv-files').setInputFiles([
    {
      name: 'cgm_data_adaptive_peak.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(cgmCsv(rows), 'utf8'),
    },
    {
      name: 'bolus_data_adaptive_peak.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(bolusCsv(boluses), 'utf8'),
    },
  ]);
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('Fertig:');
  await clickTab(page, 'meal-analysis');

  const items = page.locator('#meal-events .analysis-item');
  await expect(items).toHaveCount(2);
  const newest = items.nth(0);
  const oldest = items.nth(1);

  await expect((await gridCell(newest, 'Peak nach Mahlzeitenbolus')).locator('strong'))
    .toHaveText('240 mg/dl · 110 min nach Mahlzeitenbolus · 120 min nach Essen');
  await expect((await gridCell(newest, 'maßgeblicher Mahlzeitenbolus')).locator('strong'))
    .toHaveText('1,2 E · 10 min nach Essen · 1 spätere Bolusgabe vor dem Wendepunkt als mögliche Korrektur behandelt');
  await expect((await gridCell(newest, 'CGM-Wendepunkt-Proxy')).locator('strong'))
    .toHaveText('110 min nach Mahlzeitenbolus · 120 min nach Essen');
  await expect((await gridCell(newest, '2-h-Wert')).locator('strong')).toHaveText('240 mg/dl');

  await expect((await gridCell(oldest, 'Peak nach Mahlzeitenbolus')).locator('strong'))
    .toHaveText('223 mg/dl · 195 min nach Mahlzeitenbolus · 205 min nach Essen');
  await expect((await gridCell(oldest, 'maßgeblicher Mahlzeitenbolus')).locator('strong'))
    .toHaveText('1,2 E · 10 min nach Essen · 1 spätere Bolusgabe vor dem Wendepunkt als mögliche Korrektur behandelt');
  await expect((await gridCell(oldest, 'CGM-Wendepunkt-Proxy')).locator('strong'))
    .toHaveText('195 min nach Mahlzeitenbolus · 205 min nach Essen');
  await expect((await gridCell(oldest, '2-h-Wert')).locator('strong')).toHaveText('172 mg/dl');

  const headers = page.locator('#food-comparison').locator('xpath=ancestor::table').locator('thead th');
  await expect(headers).toHaveText([
    'Lebensmittel / Mahlzeit', 'Einträge', 'auswertbar', 'Peak-Anstieg',
    'Essen→Peak', 'Mahlzeitenbolus→Peak', '2-h-Änderung',
  ]);

  const comparison = page.locator('#food-comparison tr').filter({ hasText: 'Fettreiches Testessen' });
  await expect(comparison.locator('td')).toHaveText([
    'Fettreiches Testessen', '2', '2', '132 mg/dl', '163 min', '153 min', '106 mg/dl',
  ]);
  await expect(page.locator('#food-comparison-note')).toContainText('mehr als zwei oder drei Stunden');
  await expect(page.locator('#food-comparison-note')).toContainText('ersetzen den zugeordneten Mahlzeitenbolus nicht');

  await clickTab(page, 'recommendations');
  const recommendation = page.locator('#recommendation-list .rec').filter({ hasText: 'Fettreiches Testessen' });
  await expect(recommendation.locator('dd').first()).toContainText('163 min ab Essen');
  await expect(recommendation.locator('dd').first()).toContainText('153 min nach dem Mahlzeitenbolus');

  await clickTab(page, 'quality');
  const qualityRow = page.locator('#quality-body tr').filter({ hasText: 'Mahlzeiten-Peakfenster' });
  await expect(qualityRow.locator('td').nth(1)).toHaveText('Mahlzeitenbolus → Rückgang · max. 5 h');
  await expect(qualityRow.locator('td').nth(2)).toContainText('starten den Peak nicht neu');

  expect(errors.consoleErrors, 'browser console errors').toEqual([]);
  expect(errors.pageErrors, 'uncaught browser errors').toEqual([]);
});

test('local CGM dip is rejected until the sustained post-meal-bolus decline is confirmed', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const entry = { when: '2026-08-19T07:30', food: 'Hafermilch', carbs: '5.9', fat: '1.4', protein: '0.8', fiber: '0.9' };
  const start = localMinute(entry.when);

  await page.goto('/');
  await addDiaryEntry(page, entry);
  await clickTab(page, 'import-data');
  await page.locator('#csv-files').setInputFiles([
    {
      name: 'cgm_data_turn_hysteresis.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(cgmCsv(hysteresisCurve(entry.when)), 'utf8'),
    },
    {
      name: 'bolus_data_turn_hysteresis.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(bolusCsv([[start + 19, 5.9, 0.2, 125, 'Bolus']]), 'utf8'),
    },
  ]);
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('Fertig:');
  await clickTab(page, 'meal-analysis');

  const item = page.locator('#meal-events .analysis-item').first();
  await expect((await gridCell(item, 'Peak nach Mahlzeitenbolus')).locator('strong'))
    .toHaveText('161 mg/dl · 56 min nach Mahlzeitenbolus · 75 min nach Essen');
  await expect((await gridCell(item, 'maßgeblicher Mahlzeitenbolus')).locator('strong'))
    .toHaveText('0,2 E · 19 min nach Essen');
  await expect((await gridCell(item, 'CGM-Wendepunkt-Proxy')).locator('strong'))
    .toHaveText('56 min nach Mahlzeitenbolus · 75 min nach Essen');

  const intro = page.locator('#meal-analysis article.card.full p.muted');
  await expect(intro).toContainText('20 Minuten Hysterese');
  await expect(intro).toContainText('mindestens 8 mg/dl');
  await expect(intro).toContainText('maximal 3 mg/dl späterem Rebound');
  await expect(intro).toContainText('kein Nachweis eines pharmakologischen Insulin-Wirkbeginns');

  await clickTab(page, 'quality');
  const declineRow = page.locator('#quality-body tr').filter({ hasText: 'Anhaltender Rückgangs-Proxy' });
  await expect(declineRow.locator('td').nth(1)).toHaveText('20 min Hysterese');
  await expect(declineRow.locator('td').nth(2)).toContainText('späterer Rebound');

  expect(errors.consoleErrors, 'browser console errors').toEqual([]);
  expect(errors.pageErrors, 'uncaught browser errors').toEqual([]);
});
