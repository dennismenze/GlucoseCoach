'use strict';

const { test, expect } = require('@playwright/test');
const {
  calculateMealMeanGroups,
} = require('../docs/app-meal-page-ui.js');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function diaryEntry(when, id) {
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

function firstCurve(start) {
  const values = [
    [-15, 100], [-10, 100], [-5, 100], [0, 100],
    [5, 102], [10, 106], [15, 112], [20, 120], [25, 130],
    [30, 140], [35, 150], [40, 160], [45, 160], [50, 157],
    [55, 153], [60, 149], [65, 145], [70, 141], [75, 138],
    [80, 135], [85, 132], [90, 130], [95, 128], [100, 126],
    [105, 124], [110, 122], [115, 121], [120, 120],
  ];
  return values.map(([offset, glucose]) => [start + offset, glucose, 0]);
}

function secondCurve(start) {
  const values = [
    [-15, 110], [-10, 110], [-5, 110], [0, 110],
    [5, 112], [10, 114], [15, 116], [20, 120], [25, 127],
    [30, 136], [35, 145], [40, 154], [45, 163], [50, 170],
    [55, 170], [60, 166], [65, 162], [70, 158], [75, 154],
    [80, 150], [85, 146], [90, 142], [95, 138], [100, 135],
    [105, 132], [110, 130], [115, 128], [120, 126],
  ];
  return values.map(([offset, glucose]) => [start + offset, glucose, 0]);
}

test('grouped meal means use only complete events and keep metric-specific n', () => {
  const analyses = [
    {
      entry: { food: 'Hafermilch' }, complete: true,
      minutesToRise: 10,
      peak: 150, peakFromBolus: 40, minutesToPeak: 45,
      turnFromBolus: 50, turnFromMeal: 55,
    },
    {
      entry: { food: 'Hafermilch' }, complete: true,
      minutesToRise: 20,
      peak: 170, peakFromBolus: 60, minutesToPeak: 65,
      turnFromBolus: 70, turnFromMeal: 75,
    },
    {
      entry: { food: 'Hafermilch' }, complete: false,
      minutesToRise: 999,
      peak: 999, peakFromBolus: 999, minutesToPeak: 999,
      turnFromBolus: 999, turnFromMeal: 999,
    },
  ];

  const groups = calculateMealMeanGroups(analyses);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({
    label: 'Hafermilch',
    entries: 3,
    analyzed: 2,
    rise: { n: 2, fromMeal: 15 },
    peak: { n: 2, value: 160, fromBolus: 50, fromMeal: 55 },
    turn: { n: 2, fromBolus: 60, fromMeal: 65 },
  });
});

test('meal explanations are collapsed and food comparisons show arithmetic means', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const first = minute('2026-08-03T08:00:00+02:00');
  const second = minute('2026-08-04T08:00:00+02:00');
  const diary = [
    diaryEntry('2026-08-03T08:00', 'meal-one'),
    diaryEntry('2026-08-04T08:00', 'meal-two'),
  ];
  const clinical = {
    cgm: [...firstCurve(first), ...secondCurve(second)],
    boluses: [
      [first, 20, 1, 100, 'Normal'],
      [second + 5, 20, 1, 110, 'Normal'],
    ],
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

  const method = page.locator('#meal-method-explanation');
  const comparisonExplanation = page.locator('#food-comparison-explanation');
  await expect(method).toBeAttached();
  await expect(comparisonExplanation).toBeAttached();
  expect(await method.evaluate((element) => element.open)).toBe(false);
  expect(await comparisonExplanation.evaluate((element) => element.open)).toBe(false);
  await expect(method.locator('p')).not.toBeVisible();
  await expect(comparisonExplanation.locator('#food-comparison-note')).not.toBeVisible();

  await method.locator(':scope > summary').click();
  expect(await method.evaluate((element) => element.open)).toBe(true);
  await expect(method.locator('p')).toContainText('Mahlzeiten-Peak');
  await method.locator(':scope > summary').click();
  expect(await method.evaluate((element) => element.open)).toBe(false);

  await comparisonExplanation.locator(':scope > summary').click();
  expect(await comparisonExplanation.evaluate((element) => element.open)).toBe(true);
  await expect(comparisonExplanation.locator('#food-comparison-note')).toContainText('Mediane');

  const means = page.locator('#food-comparison-means');
  await expect(means.locator('h3')).toHaveText('Arithmetische Mittelwerte der Einzelangaben');
  const card = means.locator('[data-food-key="hafermilch"]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.meal-comparison-mean-head small')).toHaveText(
    '2 von 2 Einträgen vollständig auswertbar',
  );
  await expect(card.locator('[data-meal-mean="rise"] strong')).toHaveText(
    'Ø 12,5 min nach Essen · n=2',
  );
  await expect(card.locator('[data-meal-mean="peak"] strong')).toHaveText(
    'Ø 165 mg/dl · 42,5 min nach Mahlzeitenbolus · 45 min nach Essen · n=2',
  );
  await expect(card.locator('[data-meal-mean="turn"] strong')).toHaveText(
    'Ø 42,5 min nach Mahlzeitenbolus · 45 min nach Essen · n=2',
  );

  expect(browserErrors).toEqual([]);
});
