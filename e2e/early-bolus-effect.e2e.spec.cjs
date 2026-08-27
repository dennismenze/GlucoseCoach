'use strict';

const { test, expect } = require('@playwright/test');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function risingCorrectionCurve(start, shift = 0) {
  const rows = [];
  for (let offset = -30; offset <= 75; offset += 5) {
    const baselineAtBolus = 170 + shift;
    let value = baselineAtBolus + offset * 0.5;
    if (offset >= 20) value -= (offset - 20 + 5) * 1.2;
    rows.push([start + offset, Math.round(value), 0]);
  }
  return rows;
}

function mealCurve(start, shift = 0) {
  const values = [
    [-15, 100], [-10, 100], [-5, 100], [0, 100],
    [5, 102], [10, 106], [15, 112], [20, 120], [25, 130],
    [30, 140], [35, 150], [40, 160], [45, 160], [50, 157],
    [55, 153], [60, 149], [65, 145], [70, 141], [75, 138],
    [80, 135], [85, 132], [90, 130], [95, 128], [100, 126],
    [105, 124], [110, 122], [115, 121], [120, 120],
  ];
  return values.map(([offset, value]) => [start + offset, value + shift, 0]);
}

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

async function addMealThroughUi(page, when) {
  await clickTab(page, 'diary');
  await page.locator('#entry-type').selectOption('meal');
  await page.locator('#when').fill(when);
  await page.locator('#occasion').selectOption({ label: 'Frühstück' });
  await page.locator('#food').fill('Testmüsli');
  await page.locator('#carbs').fill('30');
  await page.locator('#diary-form button[type="submit"]').click();
  await expect(page.locator('#meal-analysis')).toHaveClass(/\bactive\b/);
}

function summaryCell(card, label) {
  return card.locator('#all-bolus-phase-summary > div').filter({ hasText: label });
}

test('early CGM counteraction drives the meal bolus lead instead of the later slowdown', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const firstCorrection = minute('2026-08-01T20:00:00+02:00');
  const secondCorrection = minute('2026-08-02T20:00:00+02:00');
  const thirdCorrection = minute('2026-08-03T20:00:00+02:00');
  const firstMeal = minute('2026-08-04T08:00:00+02:00');
  const secondMeal = minute('2026-08-05T08:00:00+02:00');
  const clinical = {
    cgm: [
      ...risingCorrectionCurve(firstCorrection, 0),
      ...risingCorrectionCurve(secondCorrection, 5),
      ...risingCorrectionCurve(thirdCorrection, 10),
      ...mealCurve(firstMeal, 0),
      ...mealCurve(secondMeal, 5),
    ],
    boluses: [
      [firstCorrection, 0, 0.5, 170, 'Normal'],
      [secondCorrection, null, 0.6, 175, 'Normal'],
      [thirdCorrection, 0, 0.7, 180, 'Normal'],
      [firstMeal - 5, 30, 1.5, 100, 'Normal'],
      [secondMeal - 5, 30, 1.5, 105, 'Normal'],
    ],
    manualInsulin: [],
    foodEvents: [],
    cgmCarbs: [],
    exerciseEvents: [],
    basalEvents: [],
    alarms: [],
    imports: [],
    updatedAt: '2026-08-05T12:00:00.000Z',
  };

  await page.addInitScript((storedClinical) => {
    localStorage.setItem('glucosecoach-clinical-v1', JSON.stringify(storedClinical));
  }, clinical);

  await page.goto('/');
  await addMealThroughUi(page, '2026-08-04T08:00');
  await addMealThroughUi(page, '2026-08-05T08:00');

  await clickTab(page, 'insulin-action');
  const phaseCard = page.locator('#all-bolus-phases-card');
  await expect(phaseCard.locator('h2')).toHaveText(
    'Frühe Gegenwirkung und spätere CGM-Kurvenphasen',
  );

  const early = summaryCell(phaseCard, 'frühe trendbereinigte Gegenwirkung');
  await expect(early.locator('span')).toHaveText('frühe trendbereinigte Gegenwirkung');
  await expect(early.locator('strong')).toHaveText(
    '25 min · mittlere 50 %: 25–25 min · 3 Verläufe',
  );

  const later = summaryCell(phaseCard, 'spätere Abflachung des Netto-Anstiegs');
  await expect(later.locator('span')).toHaveText('spätere Abflachung des Netto-Anstiegs');
  await expect(later.locator('strong')).not.toContainText('25 min');
  await expect(page.getByText('Anstieg wird schwächer', { exact: true })).not.toBeVisible();

  await clickTab(page, 'meal-analysis');
  const timing = page.locator('#meal-timing-insights .timing-insight')
    .filter({ hasText: 'Testmüsli' });
  await expect(timing).toHaveCount(1);
  await expect(timing.locator('.meal-bolus-target')).toHaveText(
    'Geschätzter Mahlzeitenbolus: 15 Min. vor dem Essen.',
  );
  await expect(timing.locator('.meal-bolus-explanation')).toContainText(
    'nach 25 Min.',
  );
  await expect(timing.locator('.meal-bolus-explanation')).toContainText(
    'früheste erkennbare Nettoeffekt',
  );
  await expect(timing).not.toContainText('65 Min.');
  await expect(timing).not.toContainText('spätere Abflachung');

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
