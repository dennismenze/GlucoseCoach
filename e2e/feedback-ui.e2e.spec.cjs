'use strict';

const { test, expect } = require('@playwright/test');

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

test('feedback cleanup, diary sections and food favorites work together', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page.locator('header .eyebrow')).not.toBeVisible();
  await expect(page.locator('header .lead')).not.toBeVisible();
  await expect(page.locator('#range-note')).not.toBeVisible();
  await expect(page.locator('body footer')).not.toBeVisible();

  await clickTab(page, 'recommendations');
  await expect(page.locator('#recommendations > .notice')).not.toBeVisible();
  const boundary = page.locator('#recommendation-list .rec').first().locator('details.feedback-boundary');
  await expect(boundary).toHaveCount(1);
  await expect(boundary).not.toHaveAttribute('open', '');
  await expect(boundary.locator('summary')).toHaveText('Grenze anzeigen');

  await clickTab(page, 'diary');
  await expect(page.locator('#diary-local-help')).toHaveCount(1);
  await expect(page.locator('#diary-local-help')).not.toHaveAttribute('open', '');
  await expect(page.locator('#entry-type')).toHaveValue('meal');
  await expect(page.locator('#diary-meal-fields')).toBeVisible();
  await expect(page.locator('#diary-activity-fields')).not.toBeVisible();

  await page.locator('#entry-type').selectOption('activity');
  await expect(page.locator('#diary-activity-fields')).toBeVisible();
  await expect(page.locator('#diary-meal-fields')).not.toBeVisible();
  await page.locator('#when').fill('2026-08-20T18:00');
  await page.locator('#activity').fill('Spaziergang 35 Min.');
  await page.locator('#steps').fill('4200');
  await page.locator('#diary-form button[type="submit"]').click();
  await expect(page.locator('#diary')).toHaveClass(/\bactive\b/);

  let storedDiary = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('glucosecoach-diary-v1') || '[]'),
  );
  expect(storedDiary).toHaveLength(1);
  expect(storedDiary[0].occasion).toBe('Sport');
  expect(storedDiary[0].activity).toContain('4.200 Schritte');
  expect(storedDiary[0].food).toBe('');

  await page.locator('#entry-type').selectOption('sleep');
  await page.locator('#when').fill('2026-08-20T21:15');
  await page.locator('#sleep').fill('8');
  await page.locator('#diary-form button[type="submit"]').click();
  storedDiary = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('glucosecoach-diary-v1') || '[]'),
  );
  expect(storedDiary).toHaveLength(2);
  expect(storedDiary[1].occasion).toBe('Schlaf');
  expect(storedDiary[1].sleep).toBe('8');
  expect(storedDiary[1].carbs).toBe('');

  await page.locator('#entry-type').selectOption('meal');
  await page.locator('#food').fill('Haferflocken');
  await page.locator('#food-weight').fill('100');
  await page.locator('#carbs').fill('60');
  await page.locator('#fat').fill('8');
  await page.locator('#protein').fill('13');
  await page.locator('#fiber').fill('10');
  await page.locator('#save-food').click();
  await expect(page.locator('#food-library-status')).toContainText('ist gespeichert');
  await page.locator('#favorite-food').click();
  await expect(page.locator('#food-library-select option:checked')).toContainText('★ Haferflocken');

  await page.locator('#food-weight').fill('150');
  await expect(page.locator('#carbs')).toHaveValue('90');
  await expect(page.locator('#fat')).toHaveValue('12');
  await expect(page.locator('#protein')).toHaveValue('19.5');
  await expect(page.locator('#fiber')).toHaveValue('15');

  const library = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('glucosecoach-food-library-v1') || '[]'),
  );
  expect(library).toHaveLength(1);
  expect(library[0].favorite).toBe(true);
  expect(library[0].referenceWeight).toBe(100);

  await clickTab(page, 'insulin-action');
  await expect(page.locator('#all-bolus-phases-card h2')).toHaveText(
    'Frühe Gegenwirkung und spätere CGM-Kurvenphasen',
  );
  await expect(page.getByText('frühe trendbereinigte Gegenwirkung', { exact: true }))
    .toBeVisible();
  await expect(page.getByText('vollständige Drei-Phasen-Verläufe', { exact: true })).not.toBeVisible();
  await expect(page.locator('article.card:has(#insulin-events)')).not.toBeVisible();
  await expect(page.getByText('Sekundär: Mittelwerte streng isolierter Korrekturboli', { exact: true })).not.toBeVisible();

  await clickTab(page, 'import-data');
  const storageCard = page.locator('#import-data article.card').filter({ hasText: 'Speichermodell' });
  await expect(storageCard).not.toBeVisible();

  await clickTab(page, 'quality');
  await expect(page.locator('#quality-note')).not.toBeVisible();

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});