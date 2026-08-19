(function () {
  'use strict';

  const PEAK_WINDOW_MINUTES = 120;
  const EXTENDED_CONTEXT_MINUTES = 180;
  const MINUTE_MS = 60_000;
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);

  const nodeCore = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-v3-core.js')
    : null;
  const baseApi = nodeCore || (typeof GlucoseCoachV3 !== 'undefined' ? GlucoseCoachV3 : {});
  const baseRecommendations = baseApi.buildRecommendations;

  function parseTime(value) {
    const source = String(value ?? '').trim();
    if (!source) return null;
    const german = source.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})/);
    if (german) {
      const date = new Date(
        Number(german[3]),
        Number(german[2]) - 1,
        Number(german[1]),
        Number(german[4]),
        Number(german[5]),
      );
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
    }
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
  }

  function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function closest(rows, target) {
    return [...rows].sort(
      (a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target),
    )[0] || null;
  }

  function analyzeMealTwoHourPeak(entry, cgm, boluses) {
    const minute = parseTime(entry.when);
    if (minute === null) return { entry, complete: false, status: 'invalid-time' };

    const windowRows = (cgm || []).filter(
      (row) => row[0] >= minute - 15 && row[0] <= minute + EXTENDED_CONTEXT_MINUTES,
    );
    if (!windowRows.length) {
      return { entry, minute, complete: false, status: 'missing-cgm' };
    }

    const pre = windowRows.filter((row) => row[0] <= minute && row[1] !== null);
    const post = windowRows.filter((row) => row[0] >= minute + 5 && row[1] !== null);
    const peakRows = post.filter((row) => row[0] <= minute + PEAK_WINDOW_MINUTES);

    if (!pre.length || peakRows.length < 18) {
      return {
        entry,
        minute,
        complete: false,
        status: 'partial-cgm',
        cgmPoints: peakRows.length,
        peakWindowMinutes: PEAK_WINDOW_MINUTES,
      };
    }

    const baseline = pre[pre.length - 1][1];
    const peakRow = peakRows.reduce(
      (best, row) => row[1] > best[1] ? row : best,
      peakRows[0],
    );
    const two = closest(
      post.filter((row) => row[0] >= minute + 105 && row[0] <= minute + 135),
      minute + 120,
    );

    let rise = null;
    for (let index = 0; index <= post.length - 3; index += 1) {
      const first = post[index];
      const second = post[index + 1];
      const third = post[index + 2];
      if (
        first[1] >= baseline + 5 &&
        second[1] >= baseline + 3 &&
        third[1] >= baseline + 3
      ) {
        rise = first;
        break;
      }
    }

    const bolus = [...(boluses || [])]
      .filter((row) => row[0] >= minute - 60 && row[0] <= minute + 30 && Number(row[2]) > 0)
      .sort((a, b) => Math.abs(a[0] - minute) - Math.abs(b[0] - minute))[0] || null;

    let turn = null;
    if (bolus && rise) {
      for (let index = 0; index <= post.length - 3; index += 1) {
        const first = post[index];
        const second = post[index + 1];
        const third = post[index + 2];
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

    const complete = peakRows.length >= 18 && Boolean(two);
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
      peakWindowMinutes: PEAK_WINDOW_MINUTES,
      twoHour: two?.[1] ?? null,
      twoHourDelta: two ? two[1] - baseline : null,
      bolus,
      bolusOffset: bolus ? bolus[0] - minute : null,
      turnMinute: turn?.[0] ?? null,
      turnFromBolus: turn && bolus ? turn[0] - bolus[0] : null,
    };
  }

  function analyzeMealsTwoHourPeak(diary, cgm, boluses) {
    return (diary || [])
      .filter((entry) => MEAL_OCCASIONS.has(entry.occasion))
      .map((entry) => analyzeMealTwoHourPeak(entry, cgm, boluses));
  }

  function buildFoodComparisonsTwoHourPeak(analyses) {
    const groups = new Map();
    for (const analysis of analyses || []) {
      const key = String(analysis.entry?.food ?? '').trim().toLocaleLowerCase('de-DE');
      if (!key) continue;
      if (!groups.has(key)) {
        groups.set(key, { label: analysis.entry.food.trim(), all: [], complete: [] });
      }
      const group = groups.get(key);
      group.all.push(analysis);
      if (analysis.complete) group.complete.push(analysis);
    }

    return [...groups.values()]
      .filter((group) => group.all.length >= 2)
      .map((group) => ({
        label: group.label,
        entries: group.all.length,
        analyzed: group.complete.length,
        medianPeakDelta: round(median(group.complete.map((item) => item.peakDelta)), 0),
        medianMinutesToPeak: round(
          median(group.complete.map((item) => item.minutesToPeak)),
          0,
        ),
        medianTwoHourDelta: round(
          median(group.complete.map((item) => item.twoHourDelta).filter(Number.isFinite)),
          0,
        ),
        peakWindowMinutes: PEAK_WINDOW_MINUTES,
      }));
  }

  function buildRecommendationsTwoHourPeak(input) {
    if (typeof baseRecommendations !== 'function') return [];
    return baseRecommendations(input).map((card) => {
      if (card.tag !== 'Beobachtung' || !card.title.includes('wiederholter persönlicher Vergleich')) {
        return card;
      }
      return {
        ...card,
        finding: card.finding
          .replace('Peak-Anstieg', '2-h-Peak-Anstieg')
          .replace(/ min\.$/, ' min innerhalb der ersten 120 Minuten.'),
        boundary:
          'Der 2-h-Peak ist nur zeitlich nach dem protokollierten Essen beobachtet. ' +
          'Unprotokollierte Nahrung, Korrekturen, Bewegung und andere Einflüsse können beitragen; ' +
          'der Vergleich ist keine Dosisempfehlung.',
      };
    });
  }

  function updateExplanatoryText() {
    const intro = document.querySelector('#meal-analysis article.card.full p.muted');
    if (intro) {
      intro.textContent =
        'Für Tagebucheinträge werden CGM-Werte von 15 Minuten davor bis 180 Minuten danach ' +
        'als Kurvenkontext gesucht. Der angezeigte 2-h-Peak ist ausschließlich der höchste ' +
        'CGM-Wert in den ersten 120 Minuten nach dem protokollierten Essensbeginn; spätere ' +
        'Werte werden nicht mehr als Mahlzeiten-Peak verwendet. Das ist eine zeitliche ' +
        'Zuordnung und kein Nachweis, dass das Lebensmittel den Wert verursacht hat.';
    }

    const headers = document.querySelectorAll('#food-comparison')
      .item(0)?.closest('table')?.querySelectorAll('thead th');
    if (headers?.length >= 6) {
      headers[3].textContent = '2-h-Peak-Anstieg';
      headers[4].textContent = 'Zeit bis 2-h-Peak';
    }

    const note = document.querySelector('#food-comparison-note');
    if (note) {
      note.textContent =
        'Mediane werden nur aus persönlichen, vollständig abgedeckten Ereignissen berechnet. ' +
        'Der Peak wird auf 0–120 Minuten nach dem protokollierten Essensbeginn begrenzt; ' +
        'eine ursächliche Zuordnung zum Lebensmittel ist damit nicht bewiesen.';
    }
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined') return;

    const previousMealsView = typeof gcMeals === 'function' ? gcMeals : null;
    const previousQualityView = typeof gcQuality === 'function' ? gcQuality : null;

    if (typeof analyzeMeals !== 'undefined') analyzeMeals = analyzeMealsTwoHourPeak;
    if (typeof buildFoodComparisons !== 'undefined') {
      buildFoodComparisons = buildFoodComparisonsTwoHourPeak;
    }
    if (typeof buildRecommendations !== 'undefined') {
      buildRecommendations = buildRecommendationsTwoHourPeak;
    }

    if (previousMealsView) {
      gcMeals = function twoHourPeakMealsView() {
        previousMealsView();
        document.querySelectorAll('#meal-events .analysis-grid span').forEach((label) => {
          if (label.textContent.trim() === 'Peak') label.textContent = '2-h-Peak';
        });
        updateExplanatoryText();
      };
    }

    if (previousQualityView) {
      gcQuality = function twoHourPeakQualityView() {
        previousQualityView();
        const body = document.querySelector('#quality-body');
        if (!body) return;
        const row = document.createElement('tr');
        row.innerHTML =
          '<td>Mahlzeiten-Peakfenster</td>' +
          '<td>0–120 min</td>' +
          '<td>Das Maximum nach 120 Minuten wird nicht als Mahlzeiten-Peak oder Zeit bis Peak verwendet.</td>';
        body.appendChild(row);
      };
    }

    if (typeof GlucoseCoachV3 !== 'undefined') {
      GlucoseCoachV3.analyzeMeals = analyzeMealsTwoHourPeak;
      GlucoseCoachV3.buildFoodComparisons = buildFoodComparisonsTwoHourPeak;
      GlucoseCoachV3.buildRecommendations = buildRecommendationsTwoHourPeak;
      GlucoseCoachV3.GC_POSTPRANDIAL_PEAK_MINUTES = PEAK_WINDOW_MINUTES;
    }

    updateExplanatoryText();
    if (typeof gcRender === 'function') gcRender();
  }

  const api = {
    ...baseApi,
    analyzeMealTwoHourPeak,
    analyzeMeals: analyzeMealsTwoHourPeak,
    buildFoodComparisons: buildFoodComparisonsTwoHourPeak,
    buildRecommendations: buildRecommendationsTwoHourPeak,
    GC_POSTPRANDIAL_PEAK_MINUTES: PEAK_WINDOW_MINUTES,
    GC_MEAL_CONTEXT_MINUTES: EXTENDED_CONTEXT_MINUTES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  installBrowserPatch();
})();
