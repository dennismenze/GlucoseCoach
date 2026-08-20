'use strict';

const { test, expect } = require('@playwright/test');
const {
  calculateMeanCards,
  formatMetric,
  localDayKey,
} = require('../docs/app-insulin-summary-core.js');
const {
  buildFixture,
  expectedDom,
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

function germanNumber(source) {
  const match = String(source).match(/-?\d+(?:\.\d{3})*(?:,\d+)?/);
  return match ? Number(match[0].replace(/\./g, '').replace(',', '.')) : null;
}

function duration(source) {
  const text = String(source);
  if (text === '–' || /nicht/.test(text)) return null;
  const hours = text.match(/(\d+) h/);
  const minutes = text.match(/(\d+) min/);
  if (!hours && !minutes) return null;
  return Number(hours?.[1] || 0) * 60 + Number(minutes?.[1] || 0);
}

function expectedEventsForMeans(fixture) {
  const dom = expectedDom(fixture);
  const sortedMinutes = fixture.boluses.map((row) => row[0]).sort((a, b) => b - a);
  return dom.events.map((item, index) => {
    const values = item.values;
    const maxDrop = values[4].split(' · ');
    const peak = values[5].split(' · ');
    const nadir = values[6].split(' · ');
    const stable = values[7].split(' · ');
    const qualityMatch = values[11].match(/\((\d+)\/100\)/);
    return {
      minute: sortedMinutes[index],
      baseline: germanNumber(values[0]),
      preSlope15: germanNumber(values[1]),
      observedDeclineOnset: duration(values[2]),
      effectOnset: duration(values[3]),
      maxDropRate: germanNumber(maxDrop[0]),
      maxDropRateTime: duration(maxDrop[1]),
      peakEffect: germanNumber(peak[0]),
      peakEffectTime: duration(peak[1]),
      nadir: germanNumber(nadir[0]),
      nadirTime: duration(nadir[1]),
      stableTime: duration(stable[0]),
      stableRange: germanNumber(stable[1]),
      actionEnd: duration(values[8]),
      effectAuc: germanNumber(values[9]),
      cgmCoverage: germanNumber(values[10]),
      qualityScore: Number(qualityMatch?.[1]),
    };
  });
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return {
    n: valid.length,
    mean: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null,
  };
}

function numberText(value, digits = 0) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(value);
}

function durationText(value) {
  if (value < 60) return `${numberText(value)} min`;
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function metricText(values, unit, digits = 0, prefix = '') {
  const result = mean(values);
  if (!result.n) return 'nicht bestimmbar · n=0';
  const value = unit === 'min'
    ? durationText(result.mean)
    : `${numberText(result.mean, digits)} ${unit}`;
  return `${prefix}${value} · n=${result.n}`;
}

function independentMeanDom(events) {
  const one = (field, unit, digits = 0, prefix = '') =>
    metricText(events.map((event) => event[field]), unit, digits, prefix);
  const pair = (first, second) => `${first} · ${second}`;
  return {
    labels: [
      'Ausgangswert', 'Ausgangstrend', 'beobachteter anhaltender Abfall',
      'geschätzter Effektbeginn', 'stärkste Senkungsrate',
      'maximale trendbereinigte Wirkung', 'Nadir', 'erste stabile Phase',
      'Restwirkung unter Schwelle', 'Effektfläche', 'CGM-Abdeckung', 'Qualität',
    ],
    values: [
      one('baseline', 'mg/dl', 0),
      one('preSlope15', 'mg/dl / 15 min', 1),
      one('observedDeclineOnset', 'min'),
      one('effectOnset', 'min'),
      pair(one('maxDropRate', 'mg/dl / 15 min', 1), one('maxDropRateTime', 'min', 0, 'bei ')),
      pair(one('peakEffect', 'mg/dl', 1), one('peakEffectTime', 'min', 0, 'bei ')),
      pair(one('nadir', 'mg/dl', 0), one('nadirTime', 'min', 0, 'bei ')),
      pair(one('stableTime', 'min'), one('stableRange', 'mg/dl Spanne', 1)),
      one('actionEnd', 'min'),
      one('effectAuc', 'mg/dl·h', 1),
      one('cgmCoverage', '%', 1),
      one('qualityScore', '/100', 0),
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

test('insulin events are compact, date-filterable and every added mean is independently verified', async ({ page }) => {
  const fixture = buildFixture();
  const expectedEvents = expectedEventsForMeans(fixture);
  const expectedAll = independentMeanDom(expectedEvents);

  await page.goto('/');
  await expect(page.locator('#export-all')).toHaveText('CSV-ZIP herunterladen');
  await importFixture(page, fixture);
  await clickTab(page, 'insulin-action');

  const meanCards = page.locator('#insulin-means .insulin-mean-card');
  await expect(meanCards).toHaveCount(12);
  await expect(meanCards.locator('span')).toHaveText(expectedAll.labels);
  await expect(meanCards.locator('.insulin-mean-value')).toHaveText(expectedAll.values);
  await expect(page.locator('#insulin-mean-scope')).toContainText('4 auswertbare Ereignisse');

  const disclosure = page.locator('#insulin-events-disclosure');
  await expect(disclosure).not.toHaveAttribute('open', '');
  const eventDetails = page.locator('#insulin-events details.insulin-event');
  await expect(eventDetails).toHaveCount(4);
  expect(await eventDetails.evaluateAll((items) => items.every((item) => !item.open))).toBe(true);

  const selectedDate = localDayKey(fixture.boluses[0][0]);
  const selectedExpected = independentMeanDom(
    expectedEvents.filter((event) => localDayKey(event.minute) === selectedDate),
  );
  await page.locator('#insulin-event-date').selectOption(selectedDate);
  await expect(page.locator('#insulin-mean-scope')).toContainText('1 auswertbares Ereignis');
  await expect(meanCards.locator('.insulin-mean-value')).toHaveText(selectedExpected.values);
  await expect(page.locator('#insulin-events details.insulin-event:not([hidden])')).toHaveCount(1);
  await expect(page.locator('#insulin-events details.insulin-event[hidden]')).toHaveCount(3);

  await disclosure.locator(':scope > summary').click();
  await page.locator('#insulin-expand-visible').click();
  expect(await eventDetails.evaluateAll((items) =>
    items.filter((item) => !item.hidden).every((item) => item.open),
  )).toBe(true);
  expect(await eventDetails.evaluateAll((items) =>
    items.filter((item) => item.hidden).every((item) => !item.open),
  )).toBe(true);
  await page.locator('#insulin-collapse-visible').click();
  expect(await eventDetails.evaluateAll((items) => items.every((item) => !item.open))).toBe(true);
});
