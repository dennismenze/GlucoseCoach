'use strict';

const { test, expect } = require('@playwright/test');
const {
  calculateMeanCards,
  formatMetric,
  localDayKey,
} = require('../docs/app-insulin-summary-core.js');
const {
  buildFixture,
  cgmCsv,
  bolusCsv,
} = require('./insulin-action-oracle.cjs');

const MINUTE_MS = 60_000;

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function byKey(cards) {
  return Object.fromEntries(cards.map((card) => [card.key, card]));
}

function explicitMeanFixture() {
  const firstDay = minute('2026-08-01T08:00:00+02:00');
  const secondDay = minute('2026-08-02T08:00:00+02:00');
  return {
    firstDay,
    events: [
      {
        minute: firstDay, detectable: true, baseline: 100, preSlope: 0.1,
        observedDeclineOnset: 20, effectOnset: 30, maxDropRate: -10,
        maxDropRateTime: 60, peakEffect: 50, peakEffectTime: 90,
        nadir: 80, nadirTime: 120, stableTime: 150, stableRange: 4,
        actionEnd: 240, effectAuc: 100, cgmCoverage: 90, qualityScore: 80,
      },
      {
        minute: firstDay + 60, detectable: true, baseline: 120, preSlope: -0.2,
        observedDeclineOnset: 40, effectOnset: 50, maxDropRate: -20,
        maxDropRateTime: 80, peakEffect: 70, peakEffectTime: 110,
        nadir: 70, nadirTime: 140, stableTime: null, stableRange: null,
        actionEnd: null, effectAuc: 120, cgmCoverage: 100, qualityScore: 100,
      },
      {
        minute: secondDay, detectable: true, baseline: 140, preSlope: 0,
        observedDeclineOnset: 60, effectOnset: 70, maxDropRate: -30,
        maxDropRateTime: 100, peakEffect: 90, peakEffectTime: 130,
        nadir: 60, nadirTime: 160, stableTime: 180, stableRange: 6,
        actionEnd: 300, effectAuc: 140, cgmCoverage: 80, qualityScore: 60,
      },
      {
        minute: firstDay + 120, detectable: false, baseline: 999, preSlope: 9,
        observedDeclineOnset: 999, effectOnset: 999, maxDropRate: -999,
        maxDropRateTime: 999, peakEffect: 999, peakEffectTime: 999,
        nadir: 1, nadirTime: 999, stableTime: 999, stableRange: 999,
        actionEnd: 999, effectAuc: 999, cgmCoverage: 1, qualityScore: 1,
      },
    ],
  };
}

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

async function importFixture(page, fixture) {
  await clickTab(page, 'import-data');
  await page.locator('#csv-files').setInputFiles([
    {
      name: 'cgm_data_insulin_summary_ui.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(cgmCsv(fixture), 'utf8'),
    },
    {
      name: 'bolus_data_insulin_summary_ui.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(bolusCsv(fixture), 'utf8'),
    },
  ]);
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('Fertig:');
}

test('arithmetic mean cards use only detectable corrections and keep metric-specific n', () => {
  const fixture = explicitMeanFixture();
  const all = calculateMeanCards(fixture.events, 'all');
  const allCards = byKey(all.cards);
  expect(all.eventCount).toBe(3);
  expect(allCards.baseline.metrics[0]).toMatchObject({ n: 3, mean: 120 });
  expect(allCards.preSlope.metrics[0]).toMatchObject({ n: 3, mean: -0.5 });
  expect(allCards.actionEnd.metrics[0]).toMatchObject({ n: 2, mean: 270 });

  const selected = calculateMeanCards(fixture.events, localDayKey(fixture.firstDay));
  const selectedCards = byKey(selected.cards);
  expect(selected.eventCount).toBe(2);
  expect(selectedCards.baseline.metrics[0]).toMatchObject({ n: 2, mean: 110 });
  expect(selectedCards.actionEnd.metrics[0]).toMatchObject({ n: 1, mean: 240 });
  expect(formatMetric(selectedCards.actionEnd.metrics[0])).toBe('4 h · n=1');
  expect(selectedCards.stableTime.metrics[0]).toMatchObject({ n: 1, mean: 150 });
  expect(selectedCards.stableTime.metrics[1]).toMatchObject({ n: 1, mean: 4 });
});

test('secondary correction means and per-bolus details stay removed from the insulin page', async ({ page }) => {
  const fixture = buildFixture();

  await page.goto('/');
  await expect(page.locator('#export-all')).toHaveText('CSV-ZIP herunterladen');
  await importFixture(page, fixture);
  await clickTab(page, 'insulin-action');

  await expect(page.locator('#insulin-aggregate')).toBeVisible();
  await expect(page.locator('#insulin-means-card')).not.toBeVisible();
  await expect(page.locator('#insulin-event-date')).not.toBeVisible();
  await expect(page.locator('article.card:has(#insulin-events)')).not.toBeVisible();
  await expect(page.getByText('Mittelwerte der auswertbaren Korrekturboli', { exact: true }))
    .not.toBeVisible();
  await expect(page.getByText('Beobachtete Reaktion je Bolus', { exact: true }))
    .not.toBeVisible();
});
