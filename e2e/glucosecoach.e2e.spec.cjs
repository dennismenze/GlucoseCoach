'use strict';

const { test, expect } = require('@playwright/test');
const {
  buildFixture,
  calculateMetrics,
  filterWindow,
  analysesFor,
  foodGroups,
  illnessStats,
  expectedRecommendations,
  expectedImportSummary,
  fmt,
  pct,
  mg,
  mins,
  dateText,
} = require('./oracle.cjs');

const SEEDS = [0x51a7c0de, 0x0badc0de, 0xc001d00d];
const WINDOW_VALUES = ['7', '14', '30', '90', 'all'];

function filePayload(file) {
  let content = file.content;
  if (file.name.startsWith('notes_data_')) {
    const lines = content.split('\n');
    content = lines.map((line, index) => {
      if (index < 2) return line;
      const separator = line.indexOf(',');
      if (separator < 0) return line;
      const timestamp = line.slice(0, separator);
      const value = line.slice(separator + 1).replace(/"/g, '""');
      return `${timestamp},"${value}"`;
    }).join('\n');
  }
  return {
    name: file.name,
    mimeType: 'text/csv',
    buffer: Buffer.from(content, 'utf8'),
  };
}

function exactImportSummary(summary) {
  const parts = [
    [summary.cgmAdded, 'CGM-Werte'],
    [summary.bolusesAdded, 'Bolusereignisse'],
    [summary.dailyInsulinAdded, 'Tages-Insulinzeilen'],
    [summary.basalEventsAdded, 'Basalereignisse'],
    [summary.manualGlucoseAdded, 'manuelle Glukosewerte'],
    [summary.alarmsAdded, 'Alarme/Ereignisse'],
    [summary.cgmCarbsAdded, 'CGM-KH-Ereignisse'],
    [summary.exerciseAdded, 'Sportereignisse'],
    [summary.foodAdded, 'Lebensmitteleinträge'],
    [summary.manualInsulinAdded, 'manuelle Insulineinträge'],
    [summary.medicationsAdded, 'Medikamente'],
    [summary.notesAdded, 'Notizen'],
  ].filter(([count]) => count > 0).map(([count, label]) => `${count} neue ${label}`);
  const kinds = [
    'cgm', 'bolus', 'dailyInsulin', 'basal', 'bg', 'alarm',
    'CGM-Kohlenhydrate', 'Sport', 'Lebensmittel', 'manuelles Insulin', 'Medikamente', 'Notizen',
  ].join(', ');
  return `${parts.join(', ')} · erkannt: ${kinds}`;
}

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

async function expectMetric(page, label, expected) {
  const card = page.locator('#metrics .metric').filter({ hasText: label });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.value')).toHaveText(expected);
}

async function expectFact(page, container, label, expected) {
  const item = page.locator(`${container} li`).filter({ hasText: label });
  await expect(item).toHaveCount(1);
  await expect(item.locator('strong')).toHaveText(String(expected));
}

async function expectGridValue(item, label, expected) {
  const cell = item.locator('.analysis-grid > div').filter({ hasText: label });
  await expect(cell).toHaveCount(1);
  await expect(cell.locator('strong')).toHaveText(String(expected));
}

function expectedPeakText(analysis) {
  if (!Number.isFinite(analysis.peak)) return 'nicht bestimmbar';
  return `${mg(analysis.peak)} · ${mins(analysis.peakFromBolus)} nach letztem Bolus · ${mins(analysis.minutesToPeak)} nach Essen`;
}

function expectedBolusText(analysis) {
  if (!analysis.bolus) return 'kein passender positiver Bolus vor Rückgang gefunden';
  const offset = analysis.bolusOffset === 0
    ? 'zum Essen'
    : `${mins(Math.abs(analysis.bolusOffset))} ${analysis.bolusOffset < 0 ? 'vor' : 'nach'} Essen`;
  return `${fmt(analysis.bolus[2], 2)} E · ${offset}`;
}

function expectedTurnText(analysis) {
  if (!Number.isFinite(analysis.turnMinute)) return 'nicht stabil erkennbar';
  return `${mins(analysis.turnFromBolus)} nach letztem Bolus · ${mins(analysis.turnFromMeal)} nach Essen`;
}

async function addDiaryEntriesThroughUi(page, entries) {
  for (const entry of entries) {
    entry.sleep = String(Math.round(Number(entry.sleep) * 4) / 4);
    await clickTab(page, 'diary');
    await page.locator('#when').fill(entry.when);
    await page.locator('#occasion').selectOption({ label: entry.occasion });
    await page.locator('#food').fill(entry.food);
    await page.locator('#carbs').fill(entry.carbs);
    await page.locator('#fat').fill(entry.fat);
    await page.locator('#protein').fill(entry.protein);
    await page.locator('#fiber').fill(entry.fiber);
    await page.locator('#activity').fill(entry.activity);
    await page.locator('#sleep').fill(entry.sleep);
    await page.locator('#stress').fill(entry.stress);
    await page.locator('#illness').selectOption(entry.illness);
    await page.locator('#notes').fill(entry.notes);
    await page.locator('#diary-form button[type="submit"]').click();
    await expect(page.locator('#meal-analysis')).toHaveClass(/\bactive\b/);
  }
}

async function assertStoredData(page, fixture) {
  const stored = await page.evaluate(() => ({
    diary: JSON.parse(localStorage.getItem('glucosecoach-diary-v1') || '[]'),
    clinical: JSON.parse(localStorage.getItem('glucosecoach-clinical-v1') || '{}'),
  }));

  expect(stored.diary).toHaveLength(fixture.diary.length);
  stored.diary.forEach((actual, index) => {
    const expected = fixture.diary[index];
    expect({
      when: actual.when,
      occasion: actual.occasion,
      food: actual.food,
      carbs: actual.carbs,
      fat: actual.fat,
      protein: actual.protein,
      fiber: actual.fiber,
      activity: actual.activity,
      sleep: actual.sleep,
      stress: actual.stress,
      illness: actual.illness,
      notes: actual.notes,
    }).toEqual({
      when: expected.when,
      occasion: expected.occasion,
      food: expected.food,
      carbs: expected.carbs,
      fat: expected.fat,
      protein: expected.protein,
      fiber: expected.fiber,
      activity: expected.activity,
      sleep: expected.sleep,
      stress: expected.stress,
      illness: expected.illness,
      notes: expected.notes,
    });
  });

  for (const key of [
    'cgm', 'boluses', 'dailyInsulin', 'basalEvents', 'manualGlucose', 'alarms',
    'cgmCarbs', 'exerciseEvents', 'foodEvents', 'manualInsulin', 'medications', 'notes',
  ]) {
    expect(stored.clinical[key], `localStorage ${key}`).toEqual(fixture.clinical[key]);
  }
  expect(stored.clinical.imports).toHaveLength(1);
}

async function assertOverview(page, fixture, windowDays) {
  await clickTab(page, 'overview');
  await page.locator('#window-days').selectOption(windowDays);

  const rows = filterWindow(fixture.clinical.cgm, windowDays);
  const metrics = calculateMetrics(rows);
  const analyses = analysesFor(fixture);

  await expect(page.locator('#header-badge')).toHaveText(`${fmt(fixture.clinical.cgm.length, 0)} lokale CGM-Werte`);
  await expectMetric(page, 'Zeit im Zielbereich', pct(metrics.inRange, 2));
  await expectMetric(page, 'Mittlere Glukose', mg(metrics.mean));
  await expectMetric(page, 'GMI-Schätzung', `${fmt(metrics.gmi, 2)} %`);
  await expectMetric(page, 'Variationskoeffizient', pct(metrics.cv, 1));

  const legendExpected = [
    `<54: ${pct(metrics.veryLow, 2)}`,
    `54–69: ${pct(metrics.low, 2)}`,
    `70–180: ${pct(metrics.inRange, 2)}`,
    `181–250: ${pct(metrics.high, 2)}`,
    `>250: ${pct(metrics.veryHigh, 2)}`,
  ];
  await expect(page.locator('#range-legend span')).toHaveText(legendExpected);

  await expectFact(page, '#dataset-facts', 'Zeitraum', `${dateText(metrics.start)}–${dateText(metrics.end)}`);
  await expectFact(page, '#dataset-facts', 'CGM-Abdeckung', pct(metrics.activePercent, 2));
  await expectFact(page, '#dataset-facts', 'CGM-Punkte', fmt(rows.length, 0));
  await expectFact(page, '#dataset-facts', 'Bolusereignisse', fmt(fixture.clinical.boluses.length, 0));
  await expectFact(page, '#dataset-facts', 'Tagebucheinträge', fmt(fixture.diary.length, 0));
  await expectFact(page, '#dataset-facts', 'vollständige Mahlzeitenkurven', fmt(analyses.filter((item) => item.complete).length, 0));

  await expect(page.locator('#metrics .value')).toHaveCount(4);
  await expect(page.locator('#range-legend span')).toHaveCount(5);
  await expect(page.locator('#dataset-facts strong')).toHaveCount(6);
}

async function assertRecommendations(page, fixture, windowDays) {
  await clickTab(page, 'recommendations');
  const expectedCards = expectedRecommendations(fixture, windowDays);
  const cards = page.locator('#recommendation-list .rec');
  await expect(cards).toHaveCount(expectedCards.length);
  for (let index = 0; index < expectedCards.length; index += 1) {
    const card = cards.nth(index);
    await expect(card.locator('h2')).toHaveText(expectedCards[index].title);
    await expect(card.locator('dd').nth(0)).toHaveText(expectedCards[index].finding);
  }
}

async function assertMealAnalysis(page, fixture) {
  await clickTab(page, 'meal-analysis');
  const analyses = analysesFor(fixture).sort((a, b) => b.minute - a.minute);
  const complete = analyses.filter((item) => item.complete);
  const groups = foodGroups(analyses);
  const illness = illnessStats(analyses);

  await expect(page.locator('#meal-summary strong')).toHaveText([
    String(analyses.length),
    String(complete.length),
    String(complete.filter((item) => item.bolus).length),
    String(complete.filter((item) => item.turnMinute !== null).length),
  ]);

  const items = page.locator('#meal-events .analysis-item');
  await expect(items).toHaveCount(analyses.length);
  for (let index = 0; index < analyses.length; index += 1) {
    const expected = analyses[index];
    const item = items.nth(index);
    await expect(item.locator('.analysis-head strong')).toHaveText(`${expected.entry.occasion} · ${expected.entry.food}`);
    await expect(item.locator('.status')).toHaveText(expected.complete ? 'vollständig' : expected.status === 'missing-cgm' ? 'wartet auf CSV' : 'teilweise');
    await expectGridValue(item, 'Ausgangswert', mg(expected.baseline));
    await expectGridValue(item, 'erster nachhaltiger Anstieg', mins(expected.minutesToRise));
    await expectGridValue(item, 'Peak nach letztem Bolus', expectedPeakText(expected));
    await expectGridValue(item, '2-h-Wert', mg(expected.twoHour));
    await expectGridValue(item, 'maßgeblicher letzter Bolus', expectedBolusText(expected));
    await expectGridValue(item, 'CGM-Wendepunkt-Proxy', expectedTurnText(expected));
  }

  const tableRows = page.locator('#food-comparison tr');
  await expect(tableRows).toHaveCount(groups.length);
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    await expect(tableRows.nth(index).locator('td')).toHaveText([
      group.label,
      String(group.entries),
      String(group.analyzed),
      group.analyzed ? mg(group.medianPeakDelta) : 'wartet auf Daten',
      group.analyzed ? mins(group.medianMinutesToPeak) : '–',
      group.analyzed ? mins(group.medianMinutesBolusToPeak) : '–',
      group.analyzed ? mg(group.medianTwoHourDelta) : '–',
    ]);
  }

  await expectFact(page, '#illness-comparison .facts', 'Krankheits-Einträge', illness.recordedIllnessEntries);
  await expectFact(page, '#illness-comparison .facts', 'auswertbar krank', illness.illness.entries);
  await expectFact(page, '#illness-comparison .facts', 'auswertbar ohne Krankheit', illness.noIllness.entries);

  await expect(page.locator('#meal-summary strong')).toHaveCount(4);
  await expect(page.locator('#meal-events .analysis-grid strong')).toHaveCount(analyses.length * 6);
  await expect(page.locator('#food-comparison td:not(:first-child)')).toHaveCount(groups.length * 6);
  await expect(page.locator('#illness-comparison strong')).toHaveCount(3);
}

async function assertDiary(page, fixture) {
  await clickTab(page, 'diary');
  const expected = [...fixture.diary].sort((a, b) => b.when.localeCompare(a.when));
  const entries = page.locator('#entries .entry');
  await expect(entries).toHaveCount(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    const item = entries.nth(index);
    await expect(item.locator('.entry-head strong')).toHaveText(expected[index].occasion);
    await expect(item.locator('p').first()).toHaveText(expected[index].food);
  }
}

async function assertCsvTab(page, fixture) {
  await clickTab(page, 'import-data');
  const counts = [
    ['CGM-Werte', fixture.clinical.cgm.length],
    ['Bolusereignisse', fixture.clinical.boluses.length],
    ['Tages-Insulinzeilen', fixture.clinical.dailyInsulin.length],
    ['Basalereignisse', fixture.clinical.basalEvents.length],
    ['manuelle Glukosewerte', fixture.clinical.manualGlucose.length],
    ['Alarme/Ereignisse', fixture.clinical.alarms.length],
    ['CGM-KH-Ereignisse', fixture.clinical.cgmCarbs.length],
    ['Sportereignisse', fixture.clinical.exerciseEvents.length],
    ['Lebensmitteleinträge', fixture.clinical.foodEvents.length],
    ['manuelle Insulineinträge', fixture.clinical.manualInsulin.length],
    ['Medikamente', fixture.clinical.medications.length],
    ['Notizen', fixture.clinical.notes.length],
    ['Importvorgänge', 1],
  ];
  for (const [label, value] of counts) await expectFact(page, '#local-data-facts', label, value);
  await expect(page.locator('#local-data-facts strong')).toHaveCount(counts.length);

  const expectedSummary = exactImportSummary(expectedImportSummary(fixture));
  await expect(page.locator('#import-summary')).toHaveText(`Letzter Import: ${expectedSummary}`);
  await expect(page.locator('#import-progress')).toHaveText(`Fertig: ${expectedSummary}.`);
}

async function assertQuality(page, fixture) {
  await clickTab(page, 'quality');
  const metrics = calculateMetrics(fixture.clinical.cgm);
  const completeMeals = analysesFor(fixture).filter((item) => item.complete).length;
  const rows = page.locator('#quality-body tr');

  const typeRow = rows.filter({ hasText: 'Omnipod-Dateitypen' });
  await expect(typeRow.locator('td').nth(1)).toHaveText('12 unterstützt');

  const coverageRow = rows.filter({ hasText: 'CGM-Abdeckung' });
  await expect(coverageRow.locator('td').nth(1)).toHaveText(pct(metrics.activePercent, 2));

  const diaryRow = rows.filter({ hasText: 'Tagebuch-Zuordnung' });
  await expect(diaryRow.locator('td').nth(1)).toHaveText(`${completeMeals} vollständig`);

  const peakRow = rows.filter({ hasText: 'Mahlzeiten-Peakfenster' });
  await expect(peakRow.locator('td').nth(1)).toHaveText('letzter Bolus → Rückgang · max. 5 h');
}

async function runScenario(page, fixture) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('.import-drop p').first()).toContainText('Kompletter Omnipod-Export');
  await expect(page.locator('nav button')).toHaveCount(7);
  await expect(page.locator('nav button[data-panel="insulin-action"]')).toHaveText('Insulinwirkung');

  await addDiaryEntriesThroughUi(page, fixture.diary);
  await clickTab(page, 'import-data');

  const input = page.locator('#csv-files');
  await input.setInputFiles(fixture.files.map(filePayload));
  await expect(page.locator('#selected-files')).toHaveText(`${fixture.files.length} Datei(en) ausgewählt.`);
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('Fertig:');
  await expect(page.locator('#overview')).toHaveClass(/\bactive\b/);

  await assertStoredData(page, fixture);

  for (const windowDays of WINDOW_VALUES) {
    await assertOverview(page, fixture, windowDays);
    await assertRecommendations(page, fixture, windowDays);
  }

  await assertMealAnalysis(page, fixture);
  await assertDiary(page, fixture);
  await assertCsvTab(page, fixture);
  await assertQuality(page, fixture);

  expect(consoleErrors, 'browser console errors').toEqual([]);
  expect(pageErrors, 'uncaught page errors').toEqual([]);
}

for (const seed of SEEDS) {
  test(`seeded full-browser numeric contract 0x${seed.toString(16)}`, async ({ page }) => {
    await runScenario(page, buildFixture(seed));
  });
}
