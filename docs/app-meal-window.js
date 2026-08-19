(function () {
  'use strict';

  const PEAK_WINDOW_MINUTES = 120;
  const EXTENDED_CONTEXT_MINUTES = 180;
  const DECLINE_CONFIRMATION_POINTS = 4;
  const DECLINE_CONFIRMATION_MINUTES = 20;
  const DECLINE_MAX_POINT_GAP_MINUTES = 7;
  const DECLINE_DROP_MGDL = 8;
  const DECLINE_REBOUND_TOLERANCE_MGDL = 3;
  const DECLINE_STEP_TOLERANCE_MGDL = 1;
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

  function contiguousConfirmation(rows, startIndex) {
    const candidate = rows[startIndex];
    const future = [];
    let previousMinute = candidate[0];

    for (let index = startIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (row[0] - candidate[0] > DECLINE_CONFIRMATION_MINUTES + 5) break;
      if (row[0] - previousMinute > DECLINE_MAX_POINT_GAP_MINUTES) break;
      future.push(row);
      previousMinute = row[0];
      if (future.length === DECLINE_CONFIRMATION_POINTS) break;
    }

    if (future.length < DECLINE_CONFIRMATION_POINTS) return null;
    if (future.at(-1)[0] - candidate[0] < DECLINE_CONFIRMATION_MINUTES - 5) return null;
    return future;
  }

  function findSustainedDecline(post, peakRow) {
    const firstEligibleIndex = post.findIndex((row) => row[0] >= peakRow[0]);
    if (firstEligibleIndex < 0) return null;

    for (let index = firstEligibleIndex; index < post.length; index += 1) {
      const candidate = post[index];
      const future = contiguousConfirmation(post, index);
      if (!future) continue;

      const sequence = [candidate, ...future];
      const deltas = future.map((row, deltaIndex) => row[1] - sequence[deltaIndex][1]);
      const nonIncreasingSteps = deltas.filter(
        (delta) => delta <= DECLINE_STEP_TOLERANCE_MGDL,
      ).length;
      const remaining = post.slice(index + 1);
      const highestLaterValue = remaining.length
        ? Math.max(...remaining.map((row) => row[1]))
        : candidate[1];
      const confirmedDrop = candidate[1] - future.at(-1)[1];

      if (
        nonIncreasingSteps >= DECLINE_CONFIRMATION_POINTS - 1 &&
        confirmedDrop >= DECLINE_DROP_MGDL &&
        highestLaterValue <= candidate[1] + DECLINE_REBOUND_TOLERANCE_MGDL
      ) {
        return candidate;
      }
    }

    return null;
  }

  function analyzeMealTwoHourPeak(entry, cgm, boluses, nextMealMinute = null) {
    const minute = parseTime(entry.when);
    if (minute === null) return { entry, complete: false, status: 'invalid-time' };

    const contextEnd = Math.min(
      minute + EXTENDED_CONTEXT_MINUTES,
      Number.isFinite(nextMealMinute) && nextMealMinute > minute
        ? nextMealMinute - 1
        : Number.POSITIVE_INFINITY,
    );
    const truncatedByNextMeal = contextEnd < minute + EXTENDED_CONTEXT_MINUTES;
    const overlapsPeakWindow = contextEnd < minute + PEAK_WINDOW_MINUTES;

    const windowRows = (cgm || []).filter(
      (row) => row[0] >= minute - 15 && row[0] <= contextEnd,
    );
    if (!windowRows.length) {
      return {
        entry,
        minute,
        complete: false,
        status: 'missing-cgm',
        nextMealMinute,
        contextEnd,
        truncatedByNextMeal,
      };
    }

    const pre = windowRows.filter((row) => row[0] <= minute && row[1] !== null);
    const post = windowRows.filter((row) => row[0] >= minute + 5 && row[1] !== null);
    const peakRows = post.filter((row) => row[0] <= minute + PEAK_WINDOW_MINUTES);

    if (!pre.length || peakRows.length < 18) {
      return {
        entry,
        minute,
        complete: false,
        status: overlapsPeakWindow ? 'overlapping-meal' : 'partial-cgm',
        cgmPoints: peakRows.length,
        peakWindowMinutes: PEAK_WINDOW_MINUTES,
        nextMealMinute,
        contextEnd,
        truncatedByNextMeal,
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

    const turn = findSustainedDecline(post, peakRow);
    const complete = peakRows.length >= 18 && Boolean(two) && !overlapsPeakWindow;

    return {
      entry,
      minute,
      complete,
      status: complete ? 'complete' : overlapsPeakWindow ? 'overlapping-meal' : 'partial-analysis',
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
      turnFromMeal: turn ? turn[0] - minute : null,
      turnFromBolus: turn && bolus ? turn[0] - bolus[0] : null,
      turnAfterPeak: turn ? turn[0] >= peakRow[0] : null,
      nextMealMinute,
      contextEnd,
      truncatedByNextMeal,
    };
  }

  function analyzeMealsTwoHourPeak(diary, cgm, boluses) {
    const meals = (diary || [])
      .filter((entry) => MEAL_OCCASIONS.has(entry.occasion))
      .map((entry) => ({ entry, minute: parseTime(entry.when) }));
    const chronological = meals
      .filter((item) => item.minute !== null)
      .sort((a, b) => a.minute - b.minute);
    const nextMealByEntry = new Map();
    chronological.forEach((item, index) => {
      nextMealByEntry.set(item.entry, chronological[index + 1]?.minute ?? null);
    });

    return meals.map(({ entry }) =>
      analyzeMealTwoHourPeak(entry, cgm, boluses, nextMealByEntry.get(entry) ?? null),
    );
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

  function formatNumber(value, digits = 0) {
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value));
  }

  function formatOffset(offset, reference) {
    if (!Number.isFinite(offset)) return null;
    if (offset === 0) return reference === 'Essen' ? 'zum Essen' : 'zum Bolus';
    return `${formatNumber(Math.abs(offset), 0)} min ${offset < 0 ? 'vor' : 'nach'} ${reference}`;
  }

  function formatPeakValue(analysis) {
    if (analysis.peak === undefined || analysis.peak === null) return '–';
    return `${formatNumber(analysis.peak, 0)} mg/dl · ${formatOffset(analysis.minutesToPeak, 'Essen')}`;
  }

  function formatBolusValue(analysis) {
    if (!analysis.bolus) return 'kein passender positiver Bolus gefunden';
    return `${formatNumber(analysis.bolus[2], 2)} E · ${formatOffset(analysis.bolusOffset, 'Essen')}`;
  }

  function formatTurnValue(analysis) {
    if (analysis.turnMinute === null || analysis.turnMinute === undefined) {
      return 'nicht stabil erkennbar';
    }
    const parts = [formatOffset(analysis.turnFromMeal, 'Essen')];
    if (analysis.bolus && Number.isFinite(analysis.turnFromBolus)) {
      parts.push(formatOffset(analysis.turnFromBolus, 'Bolus'));
    }
    return parts.filter(Boolean).join(' · ');
  }

  function updateExplanatoryText() {
    const intro = document.querySelector('#meal-analysis article.card.full p.muted');
    if (intro) {
      intro.textContent =
        'Der 2-h-Peak wird ab dem protokollierten Essensbeginn gemessen, nicht ab der ' +
        'Bolusabgabe. CGM-Werte bis 180 Minuten dienen nur als Kurvenkontext. Der ' +
        'anhaltende Rückgangs-Proxy kann frühestens am 2-h-Peak liegen und wird erst ' +
        'angezeigt, wenn vier weitere zusammenhängende Messwerte über mindestens 15 Minuten ' +
        `einen Abfall von mindestens ${DECLINE_DROP_MGDL} mg/dl bestätigen und bis zum ` +
        `Kontextende kein Rebound von mehr als ${DECLINE_REBOUND_TOLERANCE_MGDL} mg/dl folgt. ` +
        'Das beschreibt nur den CGM-Verlauf und beweist keinen Insulin-Wirkbeginn.';
    }

    const headers = document.querySelectorAll('#food-comparison')
      .item(0)?.closest('table')?.querySelectorAll('thead th');
    if (headers?.length >= 6) {
      headers[3].textContent = '2-h-Peak-Anstieg';
      headers[4].textContent = 'Zeit bis 2-h-Peak ab Essen';
    }

    const note = document.querySelector('#food-comparison-note');
    if (note) {
      note.textContent =
        'Mediane werden nur aus persönlichen, vollständig abgedeckten Ereignissen berechnet. ' +
        'Der Peak wird auf 0–120 Minuten nach dem protokollierten Essensbeginn begrenzt. ' +
        'Ein weiterer protokollierter Essenseintrag beendet den Kurvenkontext; eine ursächliche ' +
        'Zuordnung zum Lebensmittel ist dennoch nicht bewiesen.';
    }
  }

  function updateMealCards() {
    if (typeof gcState === 'undefined') return;
    const analyses = analyzeMealsTwoHourPeak(
      gcState.diary,
      gcState.clinical.cgm,
      gcState.clinical.boluses,
    ).sort((a, b) => (b.minute || 0) - (a.minute || 0));
    const items = document.querySelectorAll('#meal-events .analysis-item');

    items.forEach((item, index) => {
      const analysis = analyses[index];
      if (!analysis) return;
      const cells = item.querySelectorAll('.analysis-grid > div');
      if (cells.length < 6) return;

      cells[2].querySelector('span').textContent = '2-h-Peak';
      cells[2].querySelector('strong').textContent = formatPeakValue(analysis);
      cells[4].querySelector('strong').textContent = formatBolusValue(analysis);
      cells[5].querySelector('span').textContent = 'anhaltender Rückgang (Proxy)';
      cells[5].querySelector('strong').textContent = formatTurnValue(analysis);
    });

    const summaryLabels = document.querySelectorAll('#meal-summary > div > span');
    if (summaryLabels.length >= 4) {
      summaryLabels[3].textContent = 'mit anhaltendem Rückgangs-Proxy';
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
        updateMealCards();
        updateExplanatoryText();
      };
    }

    if (previousQualityView) {
      gcQuality = function twoHourPeakQualityView() {
        previousQualityView();
        const body = document.querySelector('#quality-body');
        if (!body) return;

        const peakRow = document.createElement('tr');
        peakRow.innerHTML =
          '<td>Mahlzeiten-Peakfenster</td>' +
          '<td>0–120 min ab Essen</td>' +
          '<td>Das Maximum nach 120 Minuten wird nicht als Mahlzeiten-Peak oder Zeit bis Peak verwendet.</td>';
        body.appendChild(peakRow);

        const declineRow = document.createElement('tr');
        declineRow.innerHTML =
          '<td>Anhaltender Rückgangs-Proxy</td>' +
          `<td>nach 2-h-Peak · ${DECLINE_CONFIRMATION_MINUTES} min Hysterese</td>` +
          `<td>Vier Folgewerte müssen mindestens ${DECLINE_DROP_MGDL} mg/dl Abfall bestätigen; ` +
          `ein späterer Rebound über ${DECLINE_REBOUND_TOLERANCE_MGDL} mg/dl bis zum Kontextende verwirft den Kandidaten.</td>`;
        body.appendChild(declineRow);
      };
    }

    if (typeof GlucoseCoachV3 !== 'undefined') {
      GlucoseCoachV3.analyzeMealTwoHourPeak = analyzeMealTwoHourPeak;
      GlucoseCoachV3.analyzeMeals = analyzeMealsTwoHourPeak;
      GlucoseCoachV3.buildFoodComparisons = buildFoodComparisonsTwoHourPeak;
      GlucoseCoachV3.buildRecommendations = buildRecommendationsTwoHourPeak;
      GlucoseCoachV3.GC_POSTPRANDIAL_PEAK_MINUTES = PEAK_WINDOW_MINUTES;
      GlucoseCoachV3.GC_DECLINE_CONFIRMATION_MINUTES = DECLINE_CONFIRMATION_MINUTES;
      GlucoseCoachV3.GC_DECLINE_DROP_MGDL = DECLINE_DROP_MGDL;
      GlucoseCoachV3.GC_DECLINE_REBOUND_TOLERANCE_MGDL = DECLINE_REBOUND_TOLERANCE_MGDL;
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
    formatOffset,
    GC_POSTPRANDIAL_PEAK_MINUTES: PEAK_WINDOW_MINUTES,
    GC_MEAL_CONTEXT_MINUTES: EXTENDED_CONTEXT_MINUTES,
    GC_DECLINE_CONFIRMATION_MINUTES: DECLINE_CONFIRMATION_MINUTES,
    GC_DECLINE_DROP_MGDL: DECLINE_DROP_MGDL,
    GC_DECLINE_REBOUND_TOLERANCE_MGDL: DECLINE_REBOUND_TOLERANCE_MGDL,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  installBrowserPatch();
})();
