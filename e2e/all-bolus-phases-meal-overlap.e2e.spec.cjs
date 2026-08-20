'use strict';

process.env.TZ = 'Europe/Berlin';

const { test, expect } = require('@playwright/test');

const MINUTE_MS = 60_000;
const TIME_ZONE = 'Europe/Berlin';
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function minute(iso) {
  return Math.round(new Date(iso).getTime() / MINUTE_MS);
}

function timestamp(value) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(value * MINUTE_MS))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

function decimal(value, digits = 1) {
  return `"${Number(value).toFixed(digits).replace('.', ',')}"`;
}

function cgmCsv(rows) {
  return [
    'Name:Synthetisch,Datumsbereich:01.08.2026 - 03.08.2026',
    'Zeitstempel,CGM-Glukosewert (mg/dl)',
    ...rows.map((row) => `${timestamp(row[0])},${decimal(row[1], 1)}`),
  ].join('\n');
}

function bolusCsv(rows) {
  return [
    'Name:Synthetisch,Datumsbereich:01.08.2026 - 03.08.2026',
    'Zeitstempel,Insulin-Typ,Blutzuckereingabe (mg/dl),Kohlenhydrataufnahme (g),Kohlenhydratverhältnis,Abgegebenes Insulin (E),Anfängliche Abgabe (E),Verzögerte Abgabe (E)',
    ...rows.map((row) => [
      timestamp(row[0]),
      row[4],
      decimal(row[3], 1),
      row[1] === null ? '' : decimal(row[1], 1),
      decimal(20, 1),
      decimal(row[2], 2),
      decimal(row[2], 2),
      '',
    ].join(',')),
  ].join('\n');
}

function phaseCurve(start, delay = 0, shift = 0) {
  const shape = [
    [-30, 100], [-25, 100], [-20, 100], [-15, 100], [-10, 100], [-5, 100],
    [0, 100], [5, 104], [10, 108], [15, 112], [20, 116], [25, 120],
    [30, 124], [35, 127], [40, 130], [45, 132], [50, 134], [55, 135],
    [60, 136], [65, 136], [70, 136], [75, 136], [80, 135], [85, 132],
    [90, 128], [95, 124], [100, 121], [105, 119], [110, 118], [115, 117],
    [120, 116],
  ];
  const rows = [];
  for (let offset = -30; offset < delay; offset += 5) {
    rows.push([start + offset, 100 + shift, 0]);
  }
  for (const [offset, value] of shape) {
    if (offset < 0) continue;
    rows.push([start + offset + delay, value + shift, 0]);
  }
  return rows;
}

async function clickTab(page, id) {
  await page.locator(`nav button[data-panel="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveClass(/\bactive\b/);
}

async function importFiles(page, cgm, boluses) {
  await clickTab(page, 'import-data');
  await page.locator('#csv-files').setInputFiles([
    {
      name: 'cgm_data_phase_test.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(cgmCsv(cgm), 'utf8'),
    },
    {
      name: 'bolus_data_phase_test.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(bolusCsv(boluses), 'utf8'),
    },
  ]);
  await page.locator('#import-csv').click();
  await expect(page.locator('#import-progress')).toContainText('Fertig:');
}

test('all positive boluses produce three arithmetic mean phase times', async ({ page }) => {
  const first = minute('2026-08-01T08:00:00+02:00');
  const second = minute('2026-08-02T08:00:00+02:00');
  const cgm = [...phaseCurve(first), ...phaseCurve(second, 10, 5)];
  const boluses = [
    [first, 40, 2, 100, 'Normal'],
    [second, 30, 1.5, 105, 'Normal'],
  ];

  await page.goto('/');
  await importFiles(page, cgm, boluses);
  await clickTab(page, 'insulin-action');

  const card = page.locator('#all-bolus-phases-card');
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toHaveText('Beobachteter Wirkeintritt über alle Boli');
  await expect(card.locator('#all-bolus-phase-summary span')).toHaveText([
    'positive Boli geprüft',
    'mit ausreichendem CGM-Fenster',
    'Anstieg wird schwächer',
    'Plateau / Wendepunkt',
    'anhaltender Abfall beginnt',
    'vollständige Drei-Phasen-Verläufe',
  ]);
  await expect(card.locator('#all-bolus-phase-summary strong')).toHaveText([
    '2',
    '2',
    'Ø 55 min · n=2',
    'Ø 75 min · n=2',
    'Ø 90 min · n=2',
    '2',
  ]);
  await expect(page.locator('#insulin-action .notice.warn')).toContainText(
    'alle positiven Boli als Kandidaten',
  );
});

test('following meal bolus uses the pre-bolus maximum as marked two-hour substitute', async ({ page }) => {
  const meal = minute('2026-08-03T08:00:00+02:00');
  const values = new Map([
    [-15, 100], [-10, 100], [-5, 100], [0, 100], [5, 105], [10, 112],
    [15, 120], [20, 130], [25, 140], [30, 150], [35, 158], [40, 162],
    [45, 165], [50, 166], [55, 166], [60, 165], [65, 162], [70, 158],
    [75, 152], [80, 146], [85, 140],
  ]);
  const cgm = [...values.entries()].map(([offset, value]) => [meal + offset, value, 0]);
  const boluses = [
    [meal - 10, 20, 2, 100, 'Normal'],
    [meal + 90, 35, 3, 166, 'Normal'],
  ];

  await page.addInitScript(() => {
    localStorage.setItem('glucosecoach-diary-v1', JSON.stringify([{
      id: 'hafermilch-overlap',
      when: '2026-08-03T08:00',
      occasion: 'Frühstück',
      food: 'Hafermilch',
      carbs: '20',
      fat: '', protein: '', fiber: '', activity: '', sleep: '', stress: '',
      illness: 'nein', notes: '',
    }]));
  });
  await page.goto('/');
  await importFiles(page, cgm, boluses);
  await clickTab(page, 'meal-analysis');

  const item = page.locator('#meal-events .analysis-item').filter({ hasText: 'Hafermilch' });
  await expect(item).toHaveCount(1);
  await expect(item.locator('.status')).toHaveText('vollständig · verkürzte 2-h-Referenz');
  const substitute = item.locator('.analysis-grid > div').filter({ hasText: 'Ersatz für 2-h-Wert' });
  await expect(substitute.locator('strong')).toHaveText(
    '166 mg/dl · höchster Wert bis 90 min nach Essen',
  );
  await expect(item).toContainText('Peak vor nächstem Mahlzeitenbolus');
  await expect(page.locator('#food-comparison-note')).toContainText(
    'höchste CGM-Wert bis unmittelbar davor',
  );
});
