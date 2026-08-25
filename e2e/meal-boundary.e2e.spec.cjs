'use strict';

const { test, expect } = require('@playwright/test');
const base = require('../docs/app-meal-management.js');
const app = require('../docs/app-v3.js');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function diaryEntry(id, when, occasion, food, carbs) {
  return {
    id,
    when,
    occasion,
    food,
    carbs: String(carbs),
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

function lateMealBoundaryFixture() {
  const meal = minute('2026-08-21T14:45:00+02:00');
  const entry = diaryEntry(
    'late-boundary-lunch',
    '2026-08-21T14:45',
    'Mittagessen',
    'Synthetisches Mittagessen',
    20.3,
  );
  const values = new Map([
    [-15, 100], [-10, 100], [-5, 100], [0, 100],
    [5, 104], [10, 110], [15, 118], [20, 126], [25, 134],
    [30, 140], [35, 145], [40, 149], [45, 152], [50, 154],
    [55, 156], [60, 158], [65, 159], [70, 160], [75, 161],
    [80, 162], [85, 163], [90, 164], [95, 165], [100, 166],
    [105, 167], [110, 168], [115, 169], [120, 170], [125, 171],
    [130, 172], [135, 171], [140, 168], [145, 164], [150, 159],
    [155, 154], [160, 149], [165, 145], [170, 142],
    [180, 145], [185, 150], [190, 156], [195, 162], [200, 168],
    [205, 174], [210, 180], [215, 186], [220, 192], [225, 198],
    [230, 204], [235, 210], [240, 214], [245, 218], [250, 222],
    [255, 225], [260, 228], [265, 231], [270, 234], [275, 237],
    [280, 240], [285, 243], [290, 246], [295, 249], [300, 252],
  ]);
  const cgm = [...values.entries()]
    .map(([offset, glucose]) => [meal + offset, glucose, 0])
    .sort((a, b) => a[0] - b[0]);
  const boluses = [
    [meal - 2, 20.3, 0.65, 100, 'Normal'],
    [meal + 175, 39.1, 0.9, 142, 'Normal'],
  ];
  return { meal, entry, cgm, boluses };
}

function observedWithoutTurnFixture() {
  const meal = minute('2026-08-24T08:00:00+02:00');
  const entry = diaryEntry(
    'observed-no-turn',
    '2026-08-24T08:00',
    'Frühstück',
    'Synthetisches Frühstück',
    25,
  );
  const cgm = [];
  for (let offset = -15; offset <= 300; offset += 5) {
    const glucose = offset <= 0 ? 100 : 100 + Math.round(offset / 5);
    cgm.push([meal + offset, glucose, 0]);
  }
  const boluses = [[meal - 5, 25, 1, 100, 'Normal']];
  return { entry, cgm, boluses };
}

test('a meal bolus after two hours terminates the earlier meal before its rebound', () => {
  const data = lateMealBoundaryFixture();
  const nodeEntry = { ...data.entry, when: '2026-08-21T14:45:00+02:00' };
  const oldResult = base.analyzeMealAdaptivePeak(
    nodeEntry,
    data.cgm,
    data.boluses,
    null,
  );
  expect(oldResult.complete).toBe(false);
  expect(oldResult.status).toBe('no-stable-decline');

  const result = app.analyzeMealAdaptivePeak(
    nodeEntry,
    data.cgm,
    data.boluses,
    null,
  );
  expect(result.complete).toBe(true);
  expect(result.peakComplete).toBe(true);
  expect(result.comparisonEligible).toBe(true);
  expect(result.status).toBe('complete-before-following-meal-bolus');
  expect(result.nextMealBolusFromMeal).toBe(175);
  expect(result.peak).toBe(172);
  expect(result.minutesToPeak).toBe(130);
  expect(result.peakFromBolus).toBe(132);
  expect(result.twoHour).toBe(170);
});

test('a fully observed meal without a stable turn is complete but not peak comparable', () => {
  const data = observedWithoutTurnFixture();
  const nodeEntry = { ...data.entry, when: '2026-08-24T08:00:00+02:00' };
  const oldResult = base.analyzeMealAdaptivePeak(
    nodeEntry,
    data.cgm,
    data.boluses,
    null,
  );
  expect(oldResult.complete).toBe(false);
  expect(oldResult.status).toBe('no-stable-decline');
  expect(oldResult.twoHourAvailable).toBe(true);

  const result = app.analyzeMealAdaptivePeak(
    nodeEntry,
    data.cgm,
    data.boluses,
    null,
  );
  expect(result.complete).toBe(true);
  expect(result.peakComplete).toBe(false);
  expect(result.comparisonEligible).toBe(false);
  expect(result.status).toBe('complete-observed-window');
  expect(result.twoHourAvailable).toBe(true);
});

test('the browser shows the late meal boundary as a completed lunch', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const data = lateMealBoundaryFixture();
  const clinical = {
    cgm: data.cgm,
    boluses: data.boluses,
    imports: [],
    updatedAt: '2026-08-21T18:00:00.000Z',
  };

  await page.addInitScript(({ diary, storedClinical }) => {
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(diary));
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify(storedClinical));
  }, { diary: [data.entry], storedClinical: clinical });

  await page.goto('/');
  await page.locator('nav button[data-panel="meal-analysis"]').click();
  await expect(page.locator('#meal-analysis')).toHaveClass(/\bactive\b/);

  const item = page.locator('#meal-events .analysis-item').filter({
    hasText: 'Synthetisches Mittagessen',
  });
  await expect(item).toHaveCount(1);
  await expect(item.locator('.status')).toHaveText('vollständig');
  await expect(item.locator('.status')).toHaveClass(/\bok\b/);
  await expect(item).toHaveAttribute(
    'data-analysis-status',
    'complete-before-following-meal-bolus',
  );

  const peak = item.locator('.analysis-grid > div').filter({
    hasText: 'Peak nach Mahlzeitenbolus',
  });
  await expect(peak.locator('strong')).toContainText('172 mg/dl');
  await expect(peak.locator('strong')).toContainText('130 min nach Essen');

  const analysis = await page.evaluate(() => {
    const result = GlucoseCoachV3.analyzeMeals(
      gcState.diary,
      gcState.clinical.cgm,
      gcState.clinical.boluses,
    )[0];
    return {
      complete: result.complete,
      peakComplete: result.peakComplete,
      comparisonEligible: result.comparisonEligible,
      status: result.status,
      nextMealBolusFromMeal: result.nextMealBolusFromMeal,
    };
  });
  expect(analysis).toEqual({
    complete: true,
    peakComplete: true,
    comparisonEligible: true,
    status: 'complete-before-following-meal-bolus',
    nextMealBolusFromMeal: 175,
  });
  expect(browserErrors).toEqual([]);
});
