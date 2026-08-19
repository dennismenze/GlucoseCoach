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

function cgmCsv(rows) {
  return [
    'Name:Testperson',
    'Zeitstempel,CGM-Glukosewert (mg/dl)',
    ...rows.sort((a, b) => a[0] - b[0]).map((row) => `${exportTimestamp(row[0])},${row[1]}`),
  ].join('\n');
}

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

async function addDiaryEntry(page, entry) {
  await clickTab(page, 'diary');
  await page.locator('#when').fill(entry.when);
  await page.locator('#occasion').selectOption({ label: 'Frühstück' });
  await page.locator('#food').fill('Hafermilch');
  await page.locator('#carbs').fill(entry.carbs);
  await page.locator('#fat').fill('1.4');
  await page.locator('#protein').fill('0.8');
  await page.locator('#fiber').fill('0.9');
  await page.locator('#illness').selectOption('nein');
  await page.locator('#diary-form button[type="submit"]').click();
  await expect(page.locator('#meal-analysis')).toHaveClass(/\bactive\b/);
}

async function gridValue(item, label) {
  return item.locator('.analysis-grid > div').filter({ hasText: label }).locator('strong');
}

test('food comparison uses the highest CGM value only within the first two hours', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

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
    'höchste CGM-Wert in den ersten 120 Minuten',
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
  await expect(headers.nth(4)).toHaveText('Zeit bis 2-h-Peak');

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
  await expect(qualityRow.locator('td').nth(1)).toHaveText('0–120 min');

  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(pageErrors, 'uncaught browser errors').toEqual([]);
});
