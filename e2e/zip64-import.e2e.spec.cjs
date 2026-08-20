'use strict';

const { test, expect } = require('@playwright/test');
const { createZip64EntryArchive } = require('../tests/zip64_fixture.cjs');

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

test('browser imports ZIP64 per-entry sizes from nested folders', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const archive = createZip64EntryArchive();
  await page.goto('/');
  await clickTab(page, 'import-data');
  await expect(page.locator('#import-csv')).toContainText('CSV/ZIP');

  await page.locator('#csv-files').setInputFiles({
    name: 'zip64-export.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(archive),
  });
  await expect(page.locator('#selected-files')).toContainText('1 ZIP');
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('Fertig:');
  await expect(page.locator('#import-progress')).not.toContainText('Import fehlgeschlagen');
  await expect(page.locator('#overview')).toHaveClass(/\bactive\b/);

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('glucosecoach-clinical-v1') || '{}'),
  );
  expect(stored.cgm).toHaveLength(1);
  expect(stored.cgm[0][1]).toBe(123);
  expect(stored.cgm[0][2]).toBe(0);
  expect(browserErrors).toEqual([]);
});
