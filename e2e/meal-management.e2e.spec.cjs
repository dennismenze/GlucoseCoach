'use strict';

const { test, expect } = require('@playwright/test');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function diaryEntry(id, when, food, occasion = 'Frühstück') {
  return {
    id,
    when,
    occasion,
    food,
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

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('local meals with variant names can be merged while unusable comparisons stay hidden', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const diary = [
    diaryEntry(
      'muesli-one',
      '2026-08-03T08:00',
      'Müsli mit Bananen und Himbeeren',
    ),
    diaryEntry(
      'muesli-two',
      '2026-08-04T08:00',
      'Müsli mit Himbeer und Banane',
    ),
  ];

  await page.addInitScript((storedDiary) => {
    if (!localStorage.getItem('glucosecoach-diary-v1')) {
      localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(storedDiary));
    }
    if (!localStorage.getItem('glucosecoach-clinical-v1')) {
      localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify({
        cgm: [], boluses: [], imports: [], updatedAt: null,
      }));
    }
  }, diary);

  await page.goto('/');
  await clickTab(page, 'diary');
  await expect(page.locator('#meal-merge-controls')).toBeVisible();

  const disclosure = page.locator('#diary-entries-disclosure');
  if (!(await disclosure.evaluate((element) => element.open))) {
    await disclosure.locator(':scope > summary').click();
  }
  const choices = page.locator('#entries .meal-merge-checkbox');
  await expect(choices).toHaveCount(2);
  await choices.nth(0).check();
  await choices.nth(1).check();

  const canonical = 'Müsli mit Banane und Himbeeren';
  await page.locator('#meal-merge-name').fill(canonical);
  const mergeButton = page.locator('#merge-selected-meals');
  await expect(mergeButton).toBeEnabled();
  await mergeButton.click();
  await expect(page.locator('#meal-merge-status')).toHaveText(
    `2 Mahlzeiten als „${canonical}“ zusammengelegt und neu berechnet.`,
  );

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('glucosecoach-diary-v1') || '[]'),
  );
  expect(stored).toHaveLength(2);
  expect(stored.map((entry) => entry.food)).toEqual([canonical, canonical]);
  expect(stored.map((entry) => entry.id)).toEqual(['muesli-one', 'muesli-two']);

  await page.reload();
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('glucosecoach-diary-v1') || '[]'),
  );
  expect(persisted.map((entry) => entry.food)).toEqual([canonical, canonical]);

  await clickTab(page, 'meal-analysis');
  const comparison = page.locator('#food-comparison tr').filter({ hasText: canonical });
  await expect(comparison).toHaveCount(0);
  await expect(page.locator('#meal-events .analysis-item')).toHaveCount(0);
  await expect(page.locator('#meal-events')).toContainText(
    'Keine Mahlzeit mit positiven Kohlenhydraten und vollständig auswertbarem CGM-Verlauf',
  );
  expect(browserErrors).toEqual([]);
});

test('a censored window remains available internally but is omitted from the usable meal list', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const meal = minute('2026-08-05T08:00:00+02:00');
  const values = new Map([
    [-15, 88], [-10, 88], [-5, 88], [0, 88], [5, 89], [10, 94],
    [15, 99], [20, 104], [25, 109], [30, 113], [35, 117], [40, 120],
    [45, 122], [50, 124], [55, 126], [60, 127], [65, 128], [70, 129],
    [75, 130], [80, 131], [85, 131], [90, 132],
  ]);
  const clinical = {
    cgm: [...values.entries()].map(([offset, value]) => [meal + offset, value, 0]),
    boluses: [
      [meal - 1, 20, 0.15, 88, 'Normal'],
      [meal + 91, 35, 2.5, 132, 'Normal'],
    ],
    imports: [],
    updatedAt: '2026-08-05T10:00:00.000Z',
  };
  const diary = [diaryEntry('banana-censored', '2026-08-05T08:00', 'Banane', 'Snack')];

  await page.addInitScript(({ storedDiary, storedClinical }) => {
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(storedDiary));
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify(storedClinical));
  }, { storedDiary: diary, storedClinical: clinical });

  await page.goto('/');
  await clickTab(page, 'meal-analysis');

  const item = page.locator('#meal-events .analysis-item').filter({ hasText: 'Banane' });
  await expect(item).toHaveCount(0);
  await expect(page.locator('#meal-summary strong')).toHaveText(['0', '0', '0', '0']);

  const analysis = await page.evaluate(() => {
    const result = GlucoseCoachV3.analyzeMealAdaptivePeak(
      gcState.diary[0],
      gcState.clinical.cgm,
      gcState.clinical.boluses,
      null,
    );
    return {
      complete: result.complete,
      peakComplete: result.peakComplete,
      comparisonEligible: result.comparisonEligible,
      status: result.status,
      usableForMealAnalysis: result.usableForMealAnalysis,
    };
  });
  expect(analysis).toEqual({
    complete: true,
    peakComplete: false,
    comparisonEligible: false,
    status: 'complete-overlap-censored',
    usableForMealAnalysis: false,
  });
  expect(browserErrors).toEqual([]);
});
