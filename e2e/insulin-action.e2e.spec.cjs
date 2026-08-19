'use strict';

const { test, expect } = require('@playwright/test');
const {
  buildFixture,
  expectedDom,
  cgmCsv,
  bolusCsv,
} = require('./insulin-action-oracle.cjs');

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

async function importFixture(page, fixture) {
  await clickTab(page, 'import-data');
  await page.locator('#csv-files').setInputFiles([
    {
      name: 'cgm_data_insulin_action_e2e.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(cgmCsv(fixture), 'utf8'),
    },
    {
      name: 'bolus_data_insulin_action_e2e.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(bolusCsv(fixture), 'utf8'),
    },
  ]);
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('Fertig:');
  await expect(page.locator('#overview')).toHaveClass(/\bactive\b/);
}

async function assertEveryDisplayedInsulinNumber(page, expected) {
  const summaryValues = page.locator('#insulin-summary strong');
  await expect(summaryValues).toHaveCount(expected.summary.length);
  await expect(summaryValues).toHaveText(expected.summary);

  const aggregateValues = page.locator('#insulin-aggregate .insulin-facts strong');
  await expect(aggregateValues).toHaveCount(expected.aggregateFacts.length);
  await expect(aggregateValues).toHaveText(expected.aggregateFacts);

  const profileRows = page.locator('#insulin-profile tr');
  await expect(profileRows).toHaveCount(expected.profile.length);
  for (let index = 0; index < expected.profile.length; index += 1) {
    await expect(profileRows.nth(index).locator('td')).toHaveText(expected.profile[index]);
  }
  await expect(page.locator('#insulin-profile-empty')).toBeHidden();

  const groupRows = page.locator('#insulin-groups tr');
  await expect(groupRows).toHaveCount(expected.groups.length);
  for (let index = 0; index < expected.groups.length; index += 1) {
    await expect(groupRows.nth(index).locator('td')).toHaveText(expected.groups[index]);
  }
  await expect(page.locator('#insulin-groups-empty')).toBeHidden();

  const eventCards = page.locator('#insulin-events .insulin-event');
  await expect(eventCards).toHaveCount(expected.events.length);
  for (let index = 0; index < expected.events.length; index += 1) {
    const card = eventCards.nth(index);
    const item = expected.events[index];
    await expect(card.locator('.analysis-head strong')).toHaveText(item.heading);
    await expect(card.locator('.analysis-head small')).toContainText(item.dateTime);
    await expect(card.locator('.analysis-head small')).toContainText('Pumpe');
    await expect(card.locator('.status')).toHaveText(item.status);

    const cells = card.locator('.insulin-event-grid > div');
    await expect(cells).toHaveCount(item.labels.length);
    await expect(cells.locator('span')).toHaveText(item.labels);
    await expect(cells.locator('strong')).toHaveText(item.values);
    await expect(card).toContainText('Keine der derzeit geprüften Störvariablen erkannt.');
  }

  const expectedCalculatedCells =
    expected.summary.length +
    expected.aggregateFacts.length +
    expected.profile.length * 4 +
    expected.groups.length * 5 +
    expected.events.length * 12;
  const actualCalculatedCells =
    await summaryValues.count() +
    await aggregateValues.count() +
    await page.locator('#insulin-profile td').count() +
    await page.locator('#insulin-groups td').count() +
    await page.locator('#insulin-events .insulin-event-grid strong').count();
  expect(actualCalculatedCells, 'every calculated insulin-action cell is covered').toBe(expectedCalculatedCells);
}

test('personal insulin-action tab verifies every displayed calculated value', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const fixture = buildFixture();
  const expected = expectedDom(fixture);

  await page.goto('/');
  await expect(page.locator('nav button[data-panel="insulin-action"]')).toHaveText('Insulinwirkung');
  await importFixture(page, fixture);
  await clickTab(page, 'insulin-action');

  await expect(page.locator('#insulin-action h2').first()).toHaveText(
    'Geschätzte effektive Glukosesenkungswirkung von Bolusinsulin',
  );
  await expect(page.locator('#insulin-method-note')).toContainText(
    'Pumpeneinstellung von 2 Stunden wird für diese Schätzung nicht verwendet',
  );
  await expect(page.locator('#insulin-method-note')).toContainText('bis zu 5 Stunden');
  await expect(page.locator('#insulin-method-note')).toContainText(
    'keine Empfehlung zur Änderung von Pumpenparametern',
  );

  await assertEveryDisplayedInsulinNumber(page, expected);

  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(pageErrors, 'uncaught browser errors').toEqual([]);
});

module.exports = { assertEveryDisplayedInsulinNumber };
