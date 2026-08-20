'use strict';

const { test, expect } = require('@playwright/test');

function diaryFixture() {
  const base = [
    ['m1', '2026-08-01T08:00', 'Frühstück', 'Haferflocken'],
    ['m2', '2026-08-01T13:00', 'Mittagessen', 'Nudeln'],
    ['m3', '2026-08-02T09:00', 'Frühstück', 'Brot'],
    ['m4', '2026-08-02T18:30', 'Abendessen', 'Reis'],
    ['s1', '2026-08-02T16:00', 'Sport', 'Spaziergang'],
  ];
  return base.map(([id, when, occasion, food]) => ({
    id,
    when,
    occasion,
    food,
    carbs: occasion === 'Sport' ? '' : '30',
    fat: '5',
    protein: '10',
    fiber: '3',
    activity: occasion === 'Sport' ? '30 Minuten' : '',
    sleep: '8',
    stress: '2',
    illness: 'nein',
    notes: '',
  }));
}

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

test('meal analysis and diary entries start compact and remain date-filterable', async ({ page }) => {
  const diary = diaryFixture();
  await page.addInitScript((entries) => {
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify(entries));
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify({
      cgm: [], boluses: [], imports: [], updatedAt: null,
    }));
  }, diary);

  await page.goto('/');
  await clickTab(page, 'meal-analysis');

  const mealDisclosure = page.locator('#meal-events-compact');
  await expect(mealDisclosure).toHaveJSProperty('open', false);
  await expect(page.locator('#meal-events .meal-event')).toHaveCount(4);
  await expect(page.locator('#meal-events .meal-event[open]')).toHaveCount(0);
  await expect(page.locator('#meal-events-compact-summary')).toHaveText('4 Mahlzeiten für alle Tage anzeigen');

  await page.locator('#meal-event-date').selectOption('2026-08-02');
  await expect(page.locator('#meal-events-compact-summary')).toHaveText('2 Mahlzeiten für 02.08.2026 anzeigen');
  await expect(page.locator('#meal-events .meal-event:not([hidden])')).toHaveCount(2);
  await expect(page.locator('#meal-events .meal-event[hidden]')).toHaveCount(2);

  await mealDisclosure.locator(':scope > summary').click();
  await mealDisclosure.locator('.compact-expand').click();
  await expect(page.locator('#meal-events .meal-event:not([hidden])[open]')).toHaveCount(2);
  await mealDisclosure.locator('.compact-collapse').click();
  await expect(page.locator('#meal-events .meal-event[open]')).toHaveCount(0);

  await clickTab(page, 'diary');
  const diaryDisclosure = page.locator('#diary-entries-compact');
  await expect(diaryDisclosure).toHaveJSProperty('open', false);
  await expect(page.locator('#entries .diary-entry')).toHaveCount(5);
  await expect(page.locator('#diary-entries-compact-summary')).toHaveText('5 Tagebucheinträge für alle Tage anzeigen');

  await page.locator('#diary-entry-date').selectOption('2026-08-02');
  await expect(page.locator('#entries .diary-entry:not([hidden])')).toHaveCount(3);
  await expect(page.locator('#diary-entries-compact-summary')).toHaveText('3 Tagebucheinträge für 02.08.2026 anzeigen');

  await diaryDisclosure.locator(':scope > summary').click();
  const firstVisible = page.locator('#entries .diary-entry:not([hidden])').first();
  await firstVisible.locator(':scope > summary').click();
  await firstVisible.locator('.remove-entry').click();
  await expect(page.locator('#entries .diary-entry')).toHaveCount(4);
  await expect(page.locator('#diary-entries-compact-summary')).toHaveText('2 Tagebucheinträge für 02.08.2026 anzeigen');
});
