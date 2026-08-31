'use strict';

const { test, expect } = require('@playwright/test');

const MINUTE_MS = 60_000;
const ENTRY_COUNT = 220;

function localDateTime(minute) {
  return new Date(minute * MINUTE_MS).toISOString().slice(0, 16);
}

function largeCarbohydrateDataset() {
  const start = Math.round(Date.UTC(2026, 0, 1, 8, 0) / MINUTE_MS);
  const diary = [];
  const boluses = [];

  for (let index = 0; index < ENTRY_COUNT; index += 1) {
    const minute = start + index * 240;
    diary.push({
      id: `performance-meal-${index}`,
      when: localDateTime(minute),
      occasion: 'Snack',
      food: `Wiederholte Testmahlzeit ${index % 4}`,
      carbs: '20',
      fat: '',
      protein: '',
      fiber: '',
      activity: '',
      sleep: '',
      stress: '',
      illness: 'nein',
      notes: '',
    });
    boluses.push([minute - 10, 20, 0.2, 110, 'Normal']);
  }

  return {
    diary,
    clinical: {
      cgm: [],
      boluses,
      imports: [],
      updatedAt: '2026-02-07T00:00:00.000Z',
    },
  };
}

test('a large carbohydrate history finishes bootstrapping and leaves navigation clickable', async ({ page }) => {
  test.setTimeout(20_000);
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const dataset = largeCarbohydrateDataset();
  await page.addInitScript(({ diary, clinical }) => {
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(diary));
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify(clinical));
  }, dataset);

  const started = Date.now();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean(globalThis.GlucoseCoachCarbOnlyMealAssociation),
    null,
    { timeout: 12_000 },
  );

  const mealNavigation = page.locator('nav button[data-panel="meal-analysis"]');
  await mealNavigation.click({ timeout: 2_000 });
  await expect(page.locator('#meal-analysis')).toHaveClass(/\bactive\b/, { timeout: 2_000 });
  expect(Date.now() - started).toBeLessThan(12_000);
  expect(browserErrors).toEqual([]);
});