'use strict';

const { test, expect } = require('@playwright/test');

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

test('meal analysis omits unusable entries while the diary stays compact and versioned', async ({ page }) => {
  const diary = [
    {
      id: 'meal-1',
      when: '2026-08-18T08:00',
      occasion: 'Frühstück',
      food: 'Hafermilch',
      carbs: '15',
      fat: '3',
      protein: '2',
      fiber: '1',
      activity: '',
      sleep: '8',
      stress: '2',
      illness: 'nein',
      notes: '',
    },
    {
      id: 'meal-2',
      when: '2026-08-18T13:00',
      occasion: 'Mittagessen',
      food: 'Nudeln',
      carbs: '60',
      fat: '10',
      protein: '15',
      fiber: '4',
      activity: '',
      sleep: '8',
      stress: '2',
      illness: 'nein',
      notes: '',
    },
    {
      id: 'meal-3',
      when: '2026-08-18T19:00',
      occasion: 'Abendessen',
      food: 'Brot',
      carbs: '40',
      fat: '8',
      protein: '12',
      fiber: '5',
      activity: '',
      sleep: '8',
      stress: '2',
      illness: 'nein',
      notes: '',
    },
  ];

  await page.addInitScript((entries) => {
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(entries));
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify({
      cgm: [],
      boluses: [],
      imports: [],
      updatedAt: null,
    }));
  }, diary);

  await page.goto('/');

  const version = page.locator('#app-version');
  await expect(version).toHaveText(
    /^Version v\d{4}\.\d{2}\.\d{2}\.\d+-[0-9a-z]+$/,
  );
  await expect(version).toHaveAttribute(
    'data-version',
    /^v\d{4}\.\d{2}\.\d{2}\.\d+-[0-9a-z]+$/,
  );

  await clickTab(page, 'meal-analysis');
  const mealDisclosure = page.locator('#meal-events-disclosure');
  await expect(mealDisclosure).toBeAttached();
  expect(await mealDisclosure.evaluate((element) => element.open)).toBe(true);
  await expect(page.locator('#meal-events > details.analysis-item')).toHaveCount(0);
  await expect(mealDisclosure.locator(':scope > summary')).toHaveText('Keine auswertbaren Mahlzeiten');
  await expect(page.locator('#meal-events')).toContainText(
    'Keine Mahlzeit mit positiven Kohlenhydraten und vollständig auswertbarem CGM-Verlauf',
  );

  await clickTab(page, 'diary');
  const diaryDisclosure = page.locator('#diary-entries-disclosure');
  await expect(diaryDisclosure).toBeAttached();
  expect(await diaryDisclosure.evaluate((element) => element.open)).toBe(false);
  await expect(page.locator('#entries > details.entry')).toHaveCount(diary.length);
  await diaryDisclosure.locator(':scope > summary').click();
  const firstDiary = page.locator('#entries > details.entry').first();
  expect(await firstDiary.evaluate((element) => element.open)).toBe(false);
  await firstDiary.locator(':scope > summary').click();
  expect(await firstDiary.evaluate((element) => element.open)).toBe(true);
});
