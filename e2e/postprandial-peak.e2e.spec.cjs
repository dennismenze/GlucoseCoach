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

function curve(when, { baseline, peak, peakOffset, twoHour, latePeak, lateOffset }) {
  const start = localMinute(when);
  const rows = [
    [start - 15, baseline + 2],
    [start - 10, baseline + 1],
    [start - 5, baseline],
    [start, baseline],
  ];

  for (let offset = 5; offset <= 180; offset += 5) {
    let value;
    if (offset <= peakOffset) {
      value = Math.round(baseline + (peak - baseline) * (offset / peakOffset));
    } else if (offset <= 120) {
      value = Math.round(
        peak - (peak - twoHour) * ((offset - peakOffset) / (120 - peakOffset)),
      );
    } else {
      value = twoHour - Math.round((offset - 120) / 10);
    }
    if (offset === peakOffset) value = peak;
    if (offset === 120) value = twoHour;
    if (offset === lateOffset) value = latePeak;
    rows.push([start + offset, value]);
  }
  return rows;
}

function explicitCurve(when, values) {
  const start = localMinute(when);
  const rows = [
    [start - 15, 102],
    [start - 10, 101],
    [start - 5, 100],
    [start, 100],
  ];
  for (let offset = 5; offset <= 180; offset += 5) {
    rows.push([start + offset, values[offset] ?? 100]);
  }
  return rows;
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
  await page.locator('#food').fill(entry.food || 'Hafermilch');
  await page.locator('#carbs').fill(entry.carbs || '5.9');
  await page.locator('#fat').fill('1.4');
  await page.locator('#protein').fill('0.8');
  await page.locator('#fiber').fill('0.9');
  await page.locator('#illness').selectOption('nein');
  await page.locator('#diary-form button[type="submit"]').click();
  await expect(page.locator('#meal-analysis')).toHaveClass(/\bactive\b/);
}

async function gridCell(item, label) {
  return item.locator('.analysis-grid > div').filter({ hasText: label });
}

async function gridValue(item, label) {
  return (await gridCell(item, label)).locator('strong');
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

test('food comparison uses the highest CGM value only within the first two hours', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const entries = [
    { when: '2026-08-17T07:30', carbs: '5.4' },
    { when: '2026-08-18T07:30', carbs: '5.9' },
  ];
  const rows = [
    ...curve(entries[0].when, {
      baseline: 100,
      peak: 170,
      peakOffset: 95,
      twoHour: 150,
      latePeak: 240,
      lateOffset: 175,
    }),
    ...curve(entries[1].when, {
      baseline: 100,
      peak: 160,
      peakOffset: 110,
      twoHour: 145,
      latePeak: 250,
      lateOffset: 180,
    }),
  ];

  await page.goto('/');
  await expect(page.locator('#meal-analysis article.card.full p.muted')).toContainText(
    'ab dem protokollierten Essensbeginn',
  );
  await expect(page.locator('#meal-analysis article.card.full p.muted')).toContainText(
    'nicht ab der Bolusabgabe',
  );

  for (const entry of entries) await addDiaryEntry(page, entry);

  await clickTab(page, 'import-data');
  await page.locator('#csv-files').setInputFiles({
    name: 'cgm_data_two_hour_peak.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(cgmCsv(rows), 'utf8'),
  });
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('Fertig:');
  await expect(page.locator('#overview')).toHaveClass(/\bactive\b/);

  await clickTab(page, 'meal-analysis');
  await expect(page.locator('#meal-events .analysis-item')).toHaveCount(2);
  await expect(page.locator('#meal-events .analysis-grid span').filter({ hasText: '2-h-Peak' })).toHaveCount(2);

  const newest = page.locator('#meal-events .analysis-item').nth(0);
  const oldest = page.locator('#meal-events .analysis-item').nth(1);
  await expect(await gridValue(newest, '2-h-Peak')).toHaveText('160 mg/dl · 110 min');
  await expect(await gridValue(oldest, '2-h-Peak')).toHaveText('170 mg/dl · 95 min');
  await expect(page.locator('#meal-events')).not.toContainText('240 mg/dl');
  await expect(page.locator('#meal-events')).not.toContainText('250 mg/dl');

  const headers = page.locator('#food-comparison').locator('xpath=ancestor::table').locator('thead th');
  await expect(headers.nth(3)).toHaveText('2-h-Peak-Anstieg');
  await expect(headers.nth(4)).toHaveText('Zeit bis 2-h-Peak ab Essen');

  const comparison = page.locator('#food-comparison tr').filter({ hasText: 'Hafermilch' });
  await expect(comparison.locator('td')).toHaveText([
    'Hafermilch',
    '2',
    '2',
    '65 mg/dl',
    '103 min',
    '48 mg/dl',
  ]);
  await expect(page.locator('#food-comparison-note')).toContainText('0–120 Minuten');
  await expect(page.locator('#food-comparison-note')).toContainText('nicht bewiesen');

  await clickTab(page, 'recommendations');
  const recommendation = page.locator('#recommendation-list .rec').filter({ hasText: 'Hafermilch' });
  await expect(recommendation.locator('dd').first()).toContainText('2-h-Peak-Anstieg');
  await expect(recommendation.locator('dd').first()).toContainText('ersten 120 Minuten');

  await clickTab(page, 'quality');
  const qualityRow = page.locator('#quality-body tr').filter({ hasText: 'Mahlzeiten-Peakfenster' });
  await expect(qualityRow.locator('td').nth(1)).toHaveText('0–120 min ab Essen');

  expect(errors.consoleErrors, 'browser console errors').toEqual([]);
  expect(errors.pageErrors, 'uncaught browser errors').toEqual([]);
});

test('sustained decline cannot precede the peak and exposes both timer origins', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const entry = { when: '2026-08-19T07:30', carbs: '5.9', food: 'Hafermilch' };
  const start = localMinute(entry.when);
  const values = {
    5: 108, 10: 118, 15: 128, 20: 135, 25: 130, 30: 127,
    35: 140, 40: 145, 45: 150, 50: 154, 55: 156, 60: 158,
    65: 159, 70: 160, 75: 161, 80: 158, 85: 155, 90: 151,
    95: 147, 100: 143, 105: 139, 110: 135, 115: 131, 120: 127,
    125: 123, 130: 119, 135: 115, 140: 111, 145: 107, 150: 103,
    155: 99, 160: 95, 165: 91, 170: 87, 175: 83, 180: 79,
  };

  await page.goto('/');
  await addDiaryEntry(page, entry);
  await clickTab(page, 'import-data');
  await page.locator('#csv-files').setInputFiles([
    {
      name: 'cgm_data_turn_hysteresis.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(cgmCsv(explicitCurve(entry.when, values)), 'utf8'),
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
  const peakCell = await gridCell(item, '2-h-Peak');
  await expect(peakCell.locator('span')).toHaveText('2-h-Peak (ab Essen)');
  await expect(peakCell.locator('strong')).toHaveText('161 mg/dl · 75 min');

  const bolusCell = await gridCell(item, 'Boluszuordnung');
  await expect(bolusCell.locator('span')).toHaveText('Boluszuordnung · 19 min nach Essen');
  await expect(bolusCell.locator('strong')).toHaveText('0,2 E');

  const turnCell = await gridCell(item, 'CGM-Wendepunkt-Proxy');
  await expect(turnCell.locator('span')).toHaveText(
    'CGM-Wendepunkt-Proxy (anhaltender Rückgang) · 75 min nach Essen',
  );
  await expect(turnCell.locator('strong')).toHaveText('56 min nach Bolus');
  await expect(turnCell).not.toContainText('25 min nach Essen');

  const intro = page.locator('#meal-analysis article.card.full p.muted');
  await expect(intro).toContainText('vier weitere zusammenhängende Messwerte');
  await expect(intro).toContainText('mindestens 8 mg/dl');
  await expect(intro).toContainText('Rebound von mehr als 3 mg/dl');
  await expect(intro).toContainText('beweist keinen Insulin-Wirkbeginn');

  await clickTab(page, 'quality');
  const declineRow = page.locator('#quality-body tr').filter({ hasText: 'Anhaltender Rückgangs-Proxy' });
  await expect(declineRow.locator('td').nth(1)).toHaveText('nach 2-h-Peak · 20 min Hysterese');
  await expect(declineRow.locator('td').nth(2)).toContainText('späterer Rebound');

  expect(errors.consoleErrors, 'browser console errors').toEqual([]);
  expect(errors.pageErrors, 'uncaught browser errors').toEqual([]);
});
