'use strict';

const MINUTE_MS = 60_000;
const TIME_ZONE = 'Europe/Berlin';
const WINDOW = 300;
const PRE = 30;

function minute(iso) {
  return Math.round(new Date(`${iso}:00+02:00`).getTime() / MINUTE_MS);
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function distribution(values, digits = 0) {
  const valid = values.filter(Number.isFinite);
  return {
    n: valid.length,
    median: round(median(valid), digits),
    q1: round(quantile(valid, 0.25), digits),
    q3: round(quantile(valid, 0.75), digits),
  };
}

function slope(rows) {
  if (rows.length < 2) return null;
  const xMean = rows.reduce((sum, row) => sum + row[0], 0) / rows.length;
  const yMean = rows.reduce((sum, row) => sum + row[1], 0) / rows.length;
  const numerator = rows.reduce((sum, row) => sum + (row[0] - xMean) * (row[1] - yMean), 0);
  const denominator = rows.reduce((sum, row) => sum + (row[0] - xMean) ** 2, 0);
  return denominator ? numerator / denominator : 0;
}

function smooth(rows) {
  return rows.map((row, index) => [
    row[0],
    median(rows.slice(Math.max(0, index - 1), Math.min(rows.length, index + 2)).map((item) => item[1])),
  ]);
}

function closest(rows, target, tolerance = 8) {
  const sorted = [...rows].sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target));
  return sorted.length && Math.abs(sorted[0][0] - target) <= tolerance ? sorted[0] : null;
}

function onset(effectRows) {
  for (let index = 0; index <= effectRows.length - 4; index += 1) {
    const group = effectRows.slice(index, index + 4);
    if (group[0].offset < 10 || group.at(-1).offset - group[0].offset < 14) continue;
    if (
      group[0].effect >= 5 &&
      group.slice(1).every((row) => row.effect >= 3) &&
      group.at(-1).effect >= 8
    ) return group[0];
  }
  return null;
}

function maxDrop(rows, eventMinute) {
  let best = null;
  for (const row of rows) {
    if (row[0] < eventMinute + 15) continue;
    const previous = closest(rows, row[0] - 15, 7);
    if (!previous) continue;
    const change = row[1] - previous[1];
    if (!best || change < best.change) best = { minute: row[0], change };
  }
  return best;
}

function stable(rows, nadirMinute) {
  const eligible = rows.filter((row) => row[0] >= nadirMinute);
  for (let index = 0; index < eligible.length; index += 1) {
    const start = eligible[index][0];
    const window = eligible.filter((row) => row[0] >= start && row[0] <= start + 30);
    if (window.length < 6 || window.at(-1)[0] - start < 25) continue;
    const values = window.map((row) => row[1]);
    const range = Math.max(...values) - Math.min(...values);
    const currentSlope = slope(window);
    if (range <= 10 && Math.abs(currentSlope || 0) <= 0.15) {
      return { minute: start, range: round(range, 1) };
    }
  }
  return null;
}

function actionEnd(effectRows, peak) {
  if (!peak || peak.effect < 8) return null;
  const threshold = Math.max(5, peak.effect * 0.10);
  for (const candidate of effectRows) {
    if (candidate.offset <= peak.offset) continue;
    const window = effectRows.filter(
      (row) => row.offset >= candidate.offset && row.offset <= candidate.offset + 30,
    );
    if (window.length < 6 || window.at(-1).offset - candidate.offset < 25) continue;
    const maxEffect = Math.max(...window.map((row) => row.effect));
    const currentSlope = slope(window.map((row) => [row.minute, row.observed]));
    if (maxEffect <= threshold && Math.abs(currentSlope || 0) <= 0.35) return candidate;
  }
  return null;
}

function auc(effectRows) {
  let result = 0;
  for (let index = 1; index < effectRows.length; index += 1) {
    const a = effectRows[index - 1];
    const b = effectRows[index];
    result += ((b.minute - a.minute) / 60) * (Math.max(0, a.effect) + Math.max(0, b.effect)) / 2;
  }
  return round(result, 1);
}

function profile(effectRows, peak) {
  const result = [];
  for (let offset = 0; offset <= WINDOW; offset += 15) {
    const row = [...effectRows].sort((a, b) => Math.abs(a.offset - offset) - Math.abs(b.offset - offset))[0];
    if (!row || Math.abs(row.offset - offset) > 8) continue;
    result.push([offset, round(Math.max(0, row.effect) / peak.effect * 100, 1)]);
  }
  return result;
}

function correctionCurve(when, variant = 0) {
  const start = minute(when);
  const baseline = 220 + variant;
  const rows = [];
  for (let offset = -30; offset <= 300; offset += 5) {
    let value = baseline;
    if (offset > 15 && offset <= 120) {
      value = baseline - ((offset - 15) / 105) * (100 + variant * 0.2);
    } else if (offset > 120 && offset <= 235) {
      const nadir = baseline - (100 + variant * 0.2);
      value = nadir + ((offset - 120) / 115) * 92;
    } else if (offset > 235) {
      value = baseline - 8 + Math.min(3, Math.floor((offset - 235) / 15));
    }
    rows.push([start + offset, Math.round(value), 0]);
  }
  return rows;
}

function buildFixture() {
  const times = [
    '2026-08-01T08:00',
    '2026-08-02T08:00',
    '2026-08-03T12:00',
    '2026-08-04T18:00',
  ];
  const cgm = times.flatMap((when, index) => correctionCurve(when, index * 2));
  const boluses = times.map((when, index) => [
    minute(when), null, 1 + index * 0.2, 220 + index * 2, 'Bolus',
  ]);
  return { times, cgm, boluses };
}

function analyzeEvent(bolus, cgm, index) {
  const eventMinute = bolus[0];
  const raw = cgm.filter((row) => row[0] >= eventMinute - PRE && row[0] <= eventMinute + WINDOW)
    .map((row) => [row[0], row[1]]);
  const rows = smooth(raw);
  const pre = rows.filter((row) => row[0] <= eventMinute);
  const post = rows.filter((row) => row[0] >= eventMinute);
  const baseline = median(pre.slice(-3).map((row) => row[1]));
  const preSlope = slope(pre) || 0;
  const effectRows = post.map((row) => {
    const offset = row[0] - eventMinute;
    const expected = baseline + Math.max(-0.5, Math.min(0.5, preSlope)) * Math.min(offset, PRE);
    return { minute: row[0], offset, observed: row[1], effect: expected - row[1] };
  });
  const start = onset(effectRows);
  const peak = effectRows.reduce((best, row) => !best || row.effect > best.effect ? row : best, null);
  const end = actionEnd(effectRows, peak);
  const drop = maxDrop(post, eventMinute);
  const nadir = post.reduce((best, row) => !best || row[1] < best[1] ? row : best, null);
  const plateau = stable(post, nadir[0]);
  return {
    id: `pump-${eventMinute}-${index}`,
    minute: eventMinute,
    units: bolus[2],
    baseline: round(baseline, 1),
    preSlope: round(preSlope, 3),
    observedDeclineOnset: (() => {
      for (let i = 0; i <= post.length - 4; i += 1) {
        const group = post.slice(i, i + 4);
        if (group[0][0] < eventMinute + 10 || group.at(-1)[0] - group[0][0] < 14) continue;
        const steps = group.slice(1).map((row, j) => row[1] - group[j][1]);
        if (steps.filter((delta) => delta <= 1).length >= 2 && group[0][1] - group.at(-1)[1] >= 8) {
          return group[0][0] - eventMinute;
        }
      }
      return null;
    })(),
    effectOnset: start.offset,
    maxDropRate: round(drop.change, 1),
    maxDropRateTime: drop.minute - eventMinute,
    peakEffect: round(peak.effect, 1),
    peakEffectTime: peak.offset,
    nadir: round(nadir[1], 1),
    nadirTime: nadir[0] - eventMinute,
    stableTime: plateau.minute - eventMinute,
    stableRange: plateau.range,
    actionEnd: end.offset,
    effectiveDuration: end.offset - start.offset,
    actionEndCensored: false,
    effectAuc: auc(effectRows),
    cgmCoverage: 100,
    quality: 'hoch',
    qualityScore: 100,
    profile: profile(effectRows, peak),
  };
}

function aggregateProfile(events) {
  const rows = [];
  for (let offset = 0; offset <= WINDOW; offset += 15) {
    const values = events.map((event) => event.profile.find((row) => row[0] === offset)?.[1]).filter(Number.isFinite);
    rows.push({
      offset,
      n: values.length,
      median: round(median(values), 0),
      q1: round(quantile(values, 0.25), 0),
      q3: round(quantile(values, 0.75), 0),
    });
  }
  return rows;
}

function group(label, events) {
  return {
    label,
    n: events.length,
    onset: distribution(events.map((event) => event.effectOnset), 0),
    maximum: distribution(events.map((event) => event.peakEffectTime), 0),
    end: distribution(events.map((event) => event.actionEnd), 0),
  };
}

function analyzeFixture(fixture) {
  const events = fixture.boluses.map((bolus, index) => analyzeEvent(bolus, fixture.cgm, index));
  const onsetStats = distribution(events.map((event) => event.effectOnset), 0);
  const maxEffectStats = distribution(events.map((event) => event.peakEffectTime), 0);
  const maxDropStats = distribution(events.map((event) => event.maxDropRateTime), 0);
  const nadirStats = distribution(events.map((event) => event.nadirTime), 0);
  const endStats = distribution(events.map((event) => event.actionEnd), 0);
  const durationStats = distribution(events.map((event) => event.effectiveDuration), 0);
  return {
    events,
    aggregate: {
      totalBoluses: 4,
      correctionBoluses: 4,
      eligibleCorrections: 4,
      analyzedCorrections: 4,
      censoredActionEnds: 0,
      confidence: 'niedrig',
      onset: onsetStats,
      maxEffect: maxEffectStats,
      maxDrop: maxDropStats,
      nadir: nadirStats,
      end: endStats,
      duration: durationStats,
      profile: aggregateProfile(events),
      groups: [
        group('Morgen (04–10 Uhr)', events.slice(0, 2)),
        group('mittel (1–3 E)', events),
      ],
    },
  };
}

const fmt = (value, digits = 0) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(value);

function minutes(value) {
  if (!Number.isFinite(value)) return '–';
  if (value < 60) return `${fmt(value)} min`;
  const hours = Math.floor(value / 60);
  const remainder = Math.round(value % 60);
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function dist(item) {
  return `${minutes(item.median)} (mittlere 50 %: ${minutes(item.q1)}–${minutes(item.q3)})`;
}

function dateTime(value) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value * MINUTE_MS));
}

function expectedDom(fixture) {
  const result = analyzeFixture(fixture);
  const a = result.aggregate;
  return {
    summaryLabels: [
      'Bolusereignisse',
      'Korrekturboli ohne KH-Eingabe',
      'streng isoliert',
      'mit erkennbarem Effekt',
      'geschätzter Wirkbeginn',
      'Vertrauensstufe',
    ],
    summary: ['4', '4', '4', '4', dist(a.onset), 'niedrig'],
    aggregateFacts: [
      dist(a.onset),
      dist(a.maxEffect),
      dist(a.maxDrop),
      dist(a.nadir),
      dist(a.end),
      dist(a.duration),
      '0',
      'niedrig',
    ],
    profile: a.profile.map((row) => [
      minutes(row.offset),
      String(row.n),
      `${fmt(row.median)} %`,
      `${fmt(row.q1)}–${fmt(row.q3)} %`,
    ]),
    groups: a.groups.map((item) => [
      item.label,
      String(item.n),
      dist(item.onset),
      dist(item.maximum),
      dist(item.end),
    ]),
    events: [...result.events].sort((x, y) => y.minute - x.minute).map((event) => ({
      heading: `${fmt(event.units, 2)} E · Korrekturbolus`,
      dateTime: dateTime(event.minute),
      status: 'auswertbar',
      labels: [
        'Ausgangswert',
        'Ausgangstrend',
        'beobachteter anhaltender Abfall',
        'geschätzter Effektbeginn',
        'stärkste Senkungsrate',
        'maximale trendbereinigte Wirkung',
        'Nadir',
        'erste stabile Phase',
        'Restwirkung unter Schwelle',
        'Effektfläche',
        'CGM-Abdeckung',
        'Qualität',
      ],
      values: [
        `${fmt(event.baseline)} mg/dl`,
        `${fmt(event.preSlope * 15, 1)} mg/dl / 15 min`,
        minutes(event.observedDeclineOnset),
        minutes(event.effectOnset),
        `${fmt(event.maxDropRate, 1)} mg/dl / 15 min · ${minutes(event.maxDropRateTime)}`,
        `${fmt(event.peakEffect, 1)} mg/dl · ${minutes(event.peakEffectTime)}`,
        `${fmt(event.nadir)} mg/dl · ${minutes(event.nadirTime)}`,
        `${minutes(event.stableTime)} · Spanne ${fmt(event.stableRange, 1)} mg/dl`,
        minutes(event.actionEnd),
        `${fmt(event.effectAuc, 1)} mg/dl·h`,
        '100 %',
        'hoch (100/100)',
      ],
    })),
  };
}

function exportTimestamp(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value * MINUTE_MS));
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.day}.${map.month}.${map.year} ${map.hour}:${map.minute}`;
}

function cgmCsv(fixture) {
  return [
    'Name:Synthetische Testperson',
    'Zeitstempel,CGM-Glukosewert (mg/dl)',
    ...fixture.cgm.sort((a, b) => a[0] - b[0]).map((row) => `${exportTimestamp(row[0])},${row[1]}`),
  ].join('\n');
}

function bolusCsv(fixture) {
  return [
    'Name:Synthetische Testperson',
    'Zeitstempel,Kohlenhydrataufnahme (g),Abgegebenes Insulin (E),Blutzuckereingabe (mg/dl),Insulin-Typ',
    ...fixture.boluses.map((row) => [
      exportTimestamp(row[0]),
      '',
      `"${String(row[2]).replace('.', ',')}"`,
      row[3],
      row[4],
    ].join(',')),
  ].join('\n');
}

module.exports = {
  buildFixture,
  expectedDom,
  cgmCsv,
  bolusCsv,
};
