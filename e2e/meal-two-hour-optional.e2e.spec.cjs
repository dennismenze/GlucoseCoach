'use strict';

const { test, expect } = require('@playwright/test');
const app = require('../docs/app-v3.js');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function curve(start, includeTwoHourReference) {
  const values = [
    [-15, 116], [-10, 116], [-5, 116], [0, 116],
    [5, 119], [10, 123], [15, 130], [20, 139], [25, 148],
    [30, 155], [35, 158], [40, 158], [45, 156], [50, 153],
    [55, 149], [60, 145], [65, 141], [70, 138], [75, 135],
    [80, 132], [85, 130], [90, 128], [95, 126], [100, 124],
  ];
  if (includeTwoHourReference) {
    values.push([105, 122], [110, 120], [115, 119], [120, 118]);
  }
  return values.map(([offset, glucose]) => [start + offset, glucose, 0]);
}

function entry(when, id) {
  return {
    id,
    when,
    occasion: 'Frühstück',
    food: 'Hafermilch',
    carbs: '20',
    fat: '',
    protein: '',
    fiber: '',
    activity: '',
    sleep: '',
    stress: '',
    illness: 'nein',
    notes: '',
  };
}

function bolus(start) {
  return [start + 3, 20, 0.2, 116, 'Normal'];
}

test('a missing two-hour reference does not invalidate a completed meal peak', () => {
  const first = minute('2026-08-03T08:00:00+02:00');
  const second = minute('2026-08-04T08:00:00+02:00');
  const missingReference = app.analyzeMealAdaptivePeak(
    entry('2026-08-03T08:00', 'missing-two-hour'),
    curve(first, false),
    [bolus(first)],
  );
  const completeReference = app.analyzeMealAdaptivePeak(
    entry('2026-08-04T08:00', 'with-two-hour'),
    curve(second, true),
    [bolus(second)],
  );

  expect(missingReference.complete).toBe(true);
  expect(missingReference.status).toBe('complete-missing-two-hour');
  expect(missingReference.peakComplete).toBe(true);
  expect(missingReference.twoHourAvailable).toBe(false);
  expect(missingReference.peak).toBe(158);
  expect(missingReference.turnMinute).not.toBeNull();
  expect(missingReference.twoHour).toBeNull();

  const groups = app.buildFoodComparisons([missingReference, completeReference]);
  expect(groups).toHaveLength(1);
  expect(groups[0].entries).toBe(2);
  expect(groups[0].analyzed).toBe(2);
  expect(groups[0].medianTwoHourDelta).toBe(completeReference.twoHourDelta);
});

test('the UI marks only the two-hour value as missing and keeps the event in comparisons', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const first = minute('2026-08-03T08:00:00+02:00');
  const second = minute('2026-08-04T08:00:00+02:00');
  const diary = [
    entry('2026-08-03T08:00', 'missing-two-hour'),
    entry('2026-08-04T08:00', 'with-two-hour'),
  ];
  const clinical = {
    cgm: [...curve(first, false), ...curve(second, true)],
    boluses: [bolus(first), bolus(second)],
    imports: [],
    updatedAt: '2026-08-04T10:00:00.000Z',
  };

  await page.addInitScript(({ storedDiary, storedClinical }) => {
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(storedDiary));
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify(storedClinical));
  }, { storedDiary: diary, storedClinical: clinical });

  await page.goto('/');
  await page.locator('nav button[data-panel="meal-analysis"]').click();
  await expect(page.locator('#meal-analysis')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#meal-events .analysis-item')).toHaveCount(2);

  const missingCard = page.locator('#meal-events .analysis-item').filter({
    has: page.locator('.status', { hasText: '2-h-Wert fehlt' }),
  });
  await expect(missingCard).toHaveCount(1);
  await expect(missingCard.locator('.status')).toHaveText('vollständig · 2-h-Wert fehlt');
  await expect(missingCard.locator('.status')).toHaveClass(/\bok\b/);

  const peak = missingCard.locator('.analysis-grid > div').filter({
    hasText: 'Peak nach Mahlzeitenbolus',
  });
  await expect(peak.locator('strong')).toContainText('158 mg/dl');

  const twoHour = missingCard.locator('.analysis-grid > div').filter({ hasText: '2-h-Wert' });
  await expect(twoHour.locator('strong')).toHaveText('–');

  const turn = missingCard.locator('.analysis-grid > div').filter({
    hasText: 'CGM-Wendepunkt-Proxy',
  });
  await expect(turn.locator('strong')).not.toHaveText('nicht stabil erkennbar');

  const comparison = page.locator('#food-comparison tr').filter({ hasText: 'Hafermilch' });
  await expect(comparison).toHaveCount(1);
  await expect(comparison.locator('td').nth(1)).toHaveText('2');
  await expect(comparison.locator('td').nth(2)).toHaveText('2');
  await expect(comparison.locator('td').nth(6)).toHaveText('2 mg/dl');
  expect(browserErrors).toEqual([]);
});
