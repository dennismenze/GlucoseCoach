'use strict';

const MINUTE_MS = 60_000;
const TIME_ZONE = 'Europe/Berlin';
const LOCALE = 'de-DE';

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function localMinute(isoLocal) {
  return Math.round(new Date(`${isoLocal}:00+02:00`).getTime() / MINUTE_MS);
}

const partFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function parts(minute) {
  const map = Object.fromEntries(
    partFormatter.formatToParts(new Date(minute * MINUTE_MS))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute),
    yyyy: map.year, mm: map.month, dd: map.day, hh: map.hour, min: map.minute,
  };
}

function exportTimestamp(minute) {
  const p = parts(minute);
  return `${p.dd}.${p.mm}.${p.yyyy} ${p.hh}:${p.min}`;
}

function localIso(minute) {
  const p = parts(minute);
  return `${p.yyyy}-${p.mm}-${p.dd}T${p.hh}:${p.min}`;
}

function fmt(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '–';
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(Number(value));
}

function pct(value, digits = 1) {
  return value === null || value === undefined ? '–' : `${fmt(value, digits)} %`;
}

function mg(value) {
  return value === null || value === undefined ? '–' : `${fmt(value, 0)} mg/dl`;
}

function mins(value) {
  return value === null || value === undefined ? '–' : `${fmt(value, 0)} min`;
}

function dateText(minute) {
  if (minute === null || minute === undefined) return '–';
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeZone: TIME_ZONE })
    .format(new Date(minute * MINUTE_MS));
}

function deDecimal(value, digits = 1) {
  if (value === null || value === undefined) return '';
  return `"${Number(value).toFixed(digits).replace('.', ',')}"`;
}

function csv(metadata, headers, rows) {
  return [metadata, headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function dayStarts(startMinute, endMinute) {
  const result = [];
  let cursor = startMinute;
  while (cursor <= endMinute) {
    const p = parts(cursor);
    if (p.hour === 0 && p.minute === 0) result.push(cursor);
    cursor += 5;
  }
  return result;
}

function nearAnyMeal(minute, meals, radius = 210) {
  return meals.some((meal) => Math.abs(meal.minute - minute) <= radius);
}

function buildFixture(seed) {
  const rng = mulberry32(seed);
  const start = localMinute('2026-05-10T00:00');
  const end = localMinute('2026-08-18T23:55');
  const metadata = 'Name:Testperson,Datumsbereich:10.05.2026 - 18.08.2026';

  const diary = [];
  const mealDays = [12, 13, 14, 15, 16, 17].map((day) => `2026-08-${String(day).padStart(2, '0')}`);
  for (let index = 0; index < mealDays.length; index += 1) {
    const day = mealDays[index];
    const breakfastCarbs = round(42 + rng() * 12, 1);
    const breakfastFat = round(7 + rng() * 4, 1);
    const breakfastProtein = round(10 + rng() * 5, 1);
    const breakfastFiber = round(5 + rng() * 3, 1);
    diary.push({
      when: `${day}T08:00`,
      minute: localMinute(`${day}T08:00`),
      occasion: 'Frühstück',
      food: 'Haferfrühstück',
      carbs: String(breakfastCarbs),
      fat: String(breakfastFat),
      protein: String(breakfastProtein),
      fiber: String(breakfastFiber),
      activity: index % 2 ? '20 Min. Spaziergang' : 'normaler Morgen',
      sleep: String(round(6.5 + rng() * 2.5, 2)),
      stress: String(Math.floor(rng() * 6)),
      illness: index === 2 ? 'ja' : 'nein',
      notes: `Seed ${seed}: Frühstück ${index + 1}`,
    });

    const lunchCarbs = round(58 + rng() * 18, 1);
    const lunchFat = round(12 + rng() * 8, 1);
    const lunchProtein = round(18 + rng() * 10, 1);
    const lunchFiber = round(4 + rng() * 5, 1);
    diary.push({
      when: `${day}T13:00`,
      minute: localMinute(`${day}T13:00`),
      occasion: 'Mittagessen',
      food: 'Pasta Gemüse',
      carbs: String(lunchCarbs),
      fat: String(lunchFat),
      protein: String(lunchProtein),
      fiber: String(lunchFiber),
      activity: index % 3 === 0 ? '30 Min. Radfahren' : '',
      sleep: String(round(6.5 + rng() * 2.5, 2)),
      stress: String(Math.floor(rng() * 7)),
      illness: index === 4 ? 'ja' : 'nein',
      notes: `Seed ${seed}: Mittag ${index + 1}`,
    });
  }

  const cgmMap = new Map();
  for (let minute = start; minute <= end; minute += 5) {
    const p = parts(minute);
    const hour = p.hour + p.minute / 60;
    let value = 122 + 8 * Math.sin(((hour - 5) / 24) * 2 * Math.PI);
    if (p.hour === 21) value += 82;
    if (p.hour === 19) value -= 62;
    if (p.hour === 9 || p.hour === 10) value += 24;
    value += (rng() - 0.5) * 16;
    value = clamp(Math.round(value), 45, 315);
    cgmMap.set(minute, [minute, value, 0]);
  }

  const shape = [
    2, 8, 15, 25, 38, 50, 61, 70, 78, 84, 88, 86,
    81, 74, 67, 59, 52, 45, 39, 34, 29, 25, 22, 20,
    18, 16, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5,
  ];
  for (const meal of diary) {
    const baseline = Math.round(96 + rng() * 18);
    const amplitudeScale = 0.78 + rng() * 0.42;
    for (const [offset, delta] of [[-15, 2], [-10, 1], [-5, 0], [0, 0]]) {
      cgmMap.set(meal.minute + offset, [meal.minute + offset, baseline + delta, 0]);
    }
    shape.forEach((delta, index) => {
      const minute = meal.minute + (index + 1) * 5;
      const value = Math.round(baseline + delta * amplitudeScale);
      cgmMap.set(minute, [minute, clamp(value, 45, 315), 0]);
    });
  }

  const cgm = [...cgmMap.values()].sort((a, b) => a[0] - b[0]);
  let sentinelCounter = 0;
  for (let index = 913; index < cgm.length; index += 3301) {
    const row = cgm[index];
    if (nearAnyMeal(row[0], diary)) continue;
    const high = sentinelCounter % 2 === 1;
    cgm[index] = [row[0], null, high ? 1 : -1];
    sentinelCounter += 1;
  }

  const boluses = [];
  for (const meal of diary) {
    const baseline = cgmMap.get(meal.minute)?.[1] || 110;
    const delivered = round(2.4 + Number(meal.carbs) / 22 + rng() * 0.7, 2);
    boluses.push([meal.minute - 10, Number(meal.carbs), delivered, baseline, 'Normal']);
  }
  for (let day = 0; day < 20; day += 1) {
    const minute = start + (day * 5 + 2) * 1440 + 16 * 60;
    if (minute > end) break;
    boluses.push([minute, 0, round(0.4 + rng() * 1.2, 2), Math.round(175 + rng() * 65), 'Korrektur']);
  }
  boluses.sort((a, b) => a[0] - b[0]);

  const days = dayStarts(start, end);
  const dailyInsulin = days.map((dayMinute) => {
    const bolus = round(8 + rng() * 10, 2);
    const basal = round(13 + rng() * 9, 2);
    return [dayMinute + 23 * 60 + 55, bolus, round(bolus + basal, 2), basal];
  });

  const basalEvents = [];
  for (const dayMinute of days) {
    for (const hour of [0, 6, 12, 18]) {
      const rate = round(0.45 + rng() * 0.55, 3);
      basalEvents.push([dayMinute + hour * 60, 'Eingeplant', 360, null, rate, round(rate * 6, 2)]);
    }
  }

  const manualGlucose = [];
  for (let index = 0; index < 20; index += 1) {
    const minute = start + (index * 5 + 3) * 1440 + 11 * 60 + 15;
    if (minute <= end) manualGlucose.push([minute, Math.round(80 + rng() * 150), 'M']);
  }

  const alarms = [];
  for (let index = 0; index < 15; index += 1) {
    const minute = start + (index * 6 + 1) * 1440 + 17 * 60 + 35;
    if (minute <= end) alarms.push([minute, index % 2 ? 'Glukosewarnung.' : 'Pod-Ereignis.']);
  }

  const cgmCarbs = diary.map((entry) => [entry.minute, Number(entry.carbs)]);
  const exerciseEvents = [];
  for (let index = 0; index < 18; index += 1) {
    const minute = start + (index * 5 + 2) * 1440 + 18 * 60;
    if (minute <= end) {
      exerciseEvents.push([
        minute,
        index % 2 ? 'Spaziergang' : 'Radfahren',
        index % 3 ? 'Mittel' : 'Leicht',
        Math.round(20 + rng() * 45),
        round(80 + rng() * 260, 1),
      ]);
    }
  }
  const foodEvents = diary.map((entry) => [
    entry.minute,
    entry.food,
    Number(entry.carbs),
    Number(entry.fat),
    Number(entry.protein),
    round(350 + rng() * 350, 1),
    'Portion',
    1,
  ]);
  const manualInsulin = [];
  for (let index = 0; index < 8; index += 1) {
    const minute = start + (index * 11 + 4) * 1440 + 15 * 60;
    if (minute <= end) manualInsulin.push([minute, 'Manuelle Korrektur', round(0.5 + rng() * 1.5, 2), 'Schnell']);
  }
  const medications = [];
  for (let index = 0; index < 6; index += 1) {
    const minute = start + (index * 14 + 5) * 1440 + 7 * 60;
    if (minute <= end) medications.push([minute, 'Testmedikament', `${100 + index * 10} mg`, 'Sonstiges']);
  }
  const notes = [];
  for (let index = 0; index < 10; index += 1) {
    const minute = start + (index * 9 + 1) * 1440 + 20 * 60;
    if (minute <= end) notes.push([minute, `Synthetische Notiz ${index + 1}, Seed ${seed}`]);
  }

  const splitEnd = localMinute('2026-07-08T23:55');
  const overlapStart = localMinute('2026-06-29T00:00');
  const cgm1 = cgm.filter((row) => row[0] <= splitEnd);
  const cgm2 = cgm.filter((row) => row[0] >= overlapStart);

  const files = [
    {
      name: 'cgm_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'CGM-Glukosewert (mg/dl)'], cgm1.map((row) => [
        exportTimestamp(row[0]), row[2] === -1 ? '1' : row[2] === 1 ? '2001' : deDecimal(row[1], 1),
      ])),
    },
    {
      name: 'cgm_data_2.csv',
      content: csv(metadata, ['Zeitstempel', 'CGM-Glukosewert (mg/dl)'], cgm2.map((row) => [
        exportTimestamp(row[0]), row[2] === -1 ? '1' : row[2] === 1 ? '2001' : deDecimal(row[1], 1),
      ])),
    },
    {
      name: 'bolus_data_1.csv',
      content: csv(metadata, [
        'Zeitstempel', 'Insulin-Typ', 'Blutzuckereingabe (mg/dl)', 'Kohlenhydrataufnahme (g)',
        'Kohlenhydratverhältnis', 'Abgegebenes Insulin (E)', 'Anfängliche Abgabe (E)', 'Verzögerte Abgabe (E)',
      ], boluses.map((row) => [
        exportTimestamp(row[0]), row[4], deDecimal(row[3], 1), deDecimal(row[1], 1),
        deDecimal(25, 1), deDecimal(row[2], 2), deDecimal(row[2], 2), '',
      ])),
    },
    {
      name: 'insulin_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'Bolus gesamt (U)', 'Insulin gesamt (U)', 'Basal gesamt (U)'], dailyInsulin.map((row) => [
        exportTimestamp(row[0]), deDecimal(row[1], 2), deDecimal(row[2], 2), deDecimal(row[3], 2),
      ])),
    },
    {
      name: 'basal_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'Insulin-Typ', 'Dauer (Minuten)', 'Prozentsatz (%)', 'Rate', 'Abgegebenes Insulin (E)'], basalEvents.map((row) => [
        exportTimestamp(row[0]), row[1], String(row[2]), '', deDecimal(row[4], 3), deDecimal(row[5], 2),
      ])),
    },
    {
      name: 'bg_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'Glukosewert (mg/dl)', 'Manuelles Lesen'], manualGlucose.map((row) => [
        exportTimestamp(row[0]), deDecimal(row[1], 1), row[2],
      ])),
    },
    {
      name: 'alarms_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'Alarm/Ereignis'], alarms.map((row) => [exportTimestamp(row[0]), row[1]])),
    },
    {
      name: 'cgm_carbs_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'KH (g)'], cgmCarbs.map((row) => [exportTimestamp(row[0]), deDecimal(row[1], 1)])),
    },
    {
      name: 'exercise_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'Name', 'Intensität', 'Dauer (Minuten)', 'Verbrannte Kalorien'], exerciseEvents.map((row) => [
        exportTimestamp(row[0]), row[1], row[2], String(row[3]), deDecimal(row[4], 1),
      ])),
    },
    {
      name: 'food_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'Name', 'KH (g)', 'Fett', 'Eiweiß', 'Kalorien', 'Portionen', 'Anzahl der Portionen'], foodEvents.map((row) => [
        exportTimestamp(row[0]), row[1], deDecimal(row[2], 1), deDecimal(row[3], 1), deDecimal(row[4], 1),
        deDecimal(row[5], 1), row[6], deDecimal(row[7], 2),
      ])),
    },
    {
      name: 'manual_insulin_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'Name', 'Wert', 'Insulin-Typ'], manualInsulin.map((row) => [
        exportTimestamp(row[0]), row[1], deDecimal(row[2], 2), row[3],
      ])),
    },
    {
      name: 'medication_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'Name', 'Wert', 'Medikamententyp'], medications.map((row) => [
        exportTimestamp(row[0]), row[1], row[2], row[3],
      ])),
    },
    {
      name: 'notes_data_1.csv',
      content: csv(metadata, ['Zeitstempel', 'Wert'], notes.map((row) => [exportTimestamp(row[0]), row[1]])),
    },
  ];

  return {
    seed,
    start,
    end,
    diary,
    files,
    clinical: {
      cgm,
      boluses,
      dailyInsulin,
      basalEvents,
      manualGlucose,
      alarms,
      cgmCarbs,
      exerciseEvents,
      foodEvents,
      manualInsulin,
      medications,
      notes,
      imports: [],
      updatedAt: null,
    },
  };
}

function calculateMetrics(rows) {
  if (!rows.length) return null;
  const exact = rows.filter((row) => row[1] !== null).map((row) => Number(row[1]));
  const classified = rows.map((row) => row[2] === -1 ? 39 : row[2] === 1 ? 401 : Number(row[1]));
  const average = mean(exact);
  const sd = average === null ? null : Math.sqrt(exact.reduce((sum, value) => sum + (value - average) ** 2, 0) / exact.length);
  const percentage = (predicate) => round(classified.filter(predicate).length / classified.length * 100, 2);
  const start = rows[0][0];
  const end = rows[rows.length - 1][0];
  const expected = Math.floor((end - start) / 5) + 1;
  return {
    samples: rows.length,
    exactSamples: exact.length,
    mean: round(average, 1),
    median: round(median(exact), 1),
    cv: average ? round(sd / average * 100, 1) : null,
    gmi: average ? round(3.31 + 0.02392 * average, 2) : null,
    veryLow: percentage((value) => value < 54),
    low: percentage((value) => value >= 54 && value < 70),
    inRange: percentage((value) => value >= 70 && value <= 180),
    high: percentage((value) => value > 180 && value <= 250),
    veryHigh: percentage((value) => value > 250),
    below70: percentage((value) => value < 70),
    above180: percentage((value) => value > 180),
    lowSentinels: rows.filter((row) => row[2] === -1).length,
    highSentinels: rows.filter((row) => row[2] === 1).length,
    start,
    end,
    activePercent: expected ? round(rows.length / expected * 100, 2) : null,
  };
}

function filterWindow(rows, days) {
  if (!rows.length || days === 'all') return rows;
  const end = rows[rows.length - 1][0];
  const start = end - Number(days) * 1440;
  return rows.filter((row) => row[0] >= start);
}

function closest(rows, target) {
  return [...rows].sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target))[0] || null;
}

function analyzeMeal(entry, cgm, boluses) {
  const minute = entry.minute;
  const windowRows = cgm.filter((row) => row[0] >= minute - 15 && row[0] <= minute + 180);
  if (!windowRows.length) return { entry, minute, status: 'missing-cgm', complete: false };
  const pre = windowRows.filter((row) => row[0] <= minute && row[1] !== null);
  const post = windowRows.filter((row) => row[0] >= minute + 5 && row[1] !== null);
  if (!pre.length || post.length < 18) return { entry, minute, status: 'partial-cgm', complete: false, cgmPoints: post.length };
  const baseline = pre[pre.length - 1][1];
  const peakRow = post.reduce((best, row) => row[1] > best[1] ? row : best, post[0]);
  const twoCandidates = post.filter((row) => row[0] >= minute + 105 && row[0] <= minute + 135);
  const two = closest(twoCandidates, minute + 120);
  let rise = null;
  for (let index = 0; index <= post.length - 3; index += 1) {
    const [first, second, third] = [post[index], post[index + 1], post[index + 2]];
    if (first[1] >= baseline + 5 && second[1] >= baseline + 3 && third[1] >= baseline + 3) {
      rise = first;
      break;
    }
  }
  const bolus = boluses
    .filter((row) => row[0] >= minute - 60 && row[0] <= minute + 30 && Number(row[2]) > 0)
    .sort((a, b) => Math.abs(a[0] - minute) - Math.abs(b[0] - minute))[0] || null;
  let turn = null;
  if (bolus && rise) {
    for (let index = 0; index <= post.length - 3; index += 1) {
      const [first, second, third] = [post[index], post[index + 1], post[index + 2]];
      if (
        first[0] >= Math.max(bolus[0] + 10, rise[0]) &&
        first[1] >= baseline + 5 &&
        second[1] <= first[1] + 1 &&
        third[1] <= second[1] + 1 &&
        third[1] <= first[1] - 5
      ) {
        turn = first;
        break;
      }
    }
  }
  const complete = post.length >= 25 && Boolean(two);
  return {
    entry,
    minute,
    complete,
    status: complete ? 'complete' : 'partial-analysis',
    baseline,
    minutesToRise: rise ? rise[0] - minute : null,
    peak: peakRow[1],
    minutesToPeak: peakRow[0] - minute,
    peakDelta: peakRow[1] - baseline,
    twoHour: two?.[1] ?? null,
    twoHourDelta: two ? two[1] - baseline : null,
    bolus,
    bolusOffset: bolus ? bolus[0] - minute : null,
    turnMinute: turn?.[0] ?? null,
    turnFromBolus: turn && bolus ? turn[0] - bolus[0] : null,
  };
}

function analysesFor(fixture) {
  return fixture.diary.map((entry) => analyzeMeal(entry, fixture.clinical.cgm, fixture.clinical.boluses));
}

function foodGroups(analyses) {
  const groups = new Map();
  for (const analysis of analyses) {
    const key = analysis.entry.food.trim().toLocaleLowerCase('de-DE');
    if (!groups.has(key)) groups.set(key, { label: analysis.entry.food.trim(), all: [], ok: [] });
    const group = groups.get(key);
    group.all.push(analysis);
    if (analysis.complete) group.ok.push(analysis);
  }
  return [...groups.values()].filter((group) => group.all.length >= 2).map((group) => ({
    label: group.label,
    entries: group.all.length,
    analyzed: group.ok.length,
    medianPeakDelta: round(median(group.ok.map((item) => item.peakDelta)), 0),
    medianMinutesToPeak: round(median(group.ok.map((item) => item.minutesToPeak)), 0),
    medianTwoHourDelta: round(median(group.ok.map((item) => item.twoHourDelta).filter(Number.isFinite)), 0),
  }));
}

function illnessStats(analyses) {
  const complete = analyses.filter((item) => item.complete);
  return {
    recordedIllnessEntries: analyses.filter((item) => item.entry.illness === 'ja').length,
    illness: { entries: complete.filter((item) => item.entry.illness === 'ja').length },
    noIllness: { entries: complete.filter((item) => item.entry.illness !== 'ja').length },
  };
}

function hourlyMetrics(rows) {
  const buckets = Array.from({ length: 24 }, () => []);
  for (const row of rows) buckets[parts(row[0]).hour].push(row);
  return buckets.map((bucket, hour) => bucket.length ? { hour, ...calculateMetrics(bucket) } : null).filter(Boolean);
}

function expectedRecommendations(fixture, windowDays) {
  const rows = filterWindow(fixture.clinical.cgm, windowDays);
  const metrics = calculateMetrics(rows);
  const analyses = analysesFor(fixture);
  const groups = foodGroups(analyses);
  const cards = [];

  for (const group of groups) {
    cards.push(group.analyzed >= 2 ? {
      title: `${group.label}: wiederholter persönlicher Vergleich`,
      finding: `${group.analyzed} Wiederholungen zeigen im Median einen Peak-Anstieg von ${group.medianPeakDelta ?? '–'} mg/dl nach ${group.medianMinutesToPeak ?? '–'} min.`,
    } : {
      title: `${group.label} ist mehrfach dokumentiert`,
      finding: `${group.entries} persönliche Einträge sind vorhanden, aber noch nicht mindestens zweimal vollständig auswertbar.`,
    });
  }

  const hours = hourlyMetrics(rows);
  const high = hours
    .filter((item) => item.samples >= 24 && item.above180 >= metrics.above180 + 8)
    .sort((a, b) => b.above180 - a.above180)[0];
  const low = hours
    .filter((item) => item.samples >= 24 && item.below70 >= metrics.below70 + 1)
    .sort((a, b) => b.below70 - a.below70)[0];
  if (high) cards.push({
    title: `Höherer Hochanteil um ${String(high.hour).padStart(2, '0')}:00 Uhr`,
    finding: `${high.above180}% gegenüber ${metrics.above180}% im gewählten Zeitraum.`,
  });
  if (low) cards.push({
    title: `Höherer Niedriganteil um ${String(low.hour).padStart(2, '0')}:00 Uhr`,
    finding: `${low.below70}% gegenüber ${metrics.below70}% im gewählten Zeitraum.`,
  });
  return cards.slice(0, 10);
}

function expectedImportSummary(fixture) {
  return {
    files: fixture.files.length,
    cgmAdded: fixture.clinical.cgm.length,
    bolusesAdded: fixture.clinical.boluses.length,
    dailyInsulinAdded: fixture.clinical.dailyInsulin.length,
    basalEventsAdded: fixture.clinical.basalEvents.length,
    manualGlucoseAdded: fixture.clinical.manualGlucose.length,
    alarmsAdded: fixture.clinical.alarms.length,
    cgmCarbsAdded: fixture.clinical.cgmCarbs.length,
    exerciseAdded: fixture.clinical.exerciseEvents.length,
    foodAdded: fixture.clinical.foodEvents.length,
    manualInsulinAdded: fixture.clinical.manualInsulin.length,
    medicationsAdded: fixture.clinical.medications.length,
    notesAdded: fixture.clinical.notes.length,
    rejected: 0,
  };
}

module.exports = {
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
};
