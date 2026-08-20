(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const TWO_HOUR_MINUTES = 120;
  const MEAL_CONTEXT_MINUTES = 300;
  const BOLUS_LOOKBACK_MINUTES = 60;
  const MEAL_BOLUS_ASSOCIATION_MINUTES = 60;
  const MIN_FALLBACK_WINDOW_MINUTES = 30;
  const MIN_FALLBACK_POINTS = 6;
  const MIN_FALLBACK_COVERAGE = 0.70;
  const MAX_FALLBACK_GAP_MINUTES = 15;
  const DECLINE_CONFIRMATION_POINTS = 4;
  const DECLINE_CONFIRMATION_MINUTES = 20;
  const DECLINE_MAX_POINT_GAP_MINUTES = 7;
  const DECLINE_DROP_MGDL = 8;
  const DECLINE_REBOUND_TOLERANCE_MGDL = 3;
  const DECLINE_STEP_TOLERANCE_MGDL = 1;
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);

  const nodeBase = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-meal-window.js')
    : null;
  const browserBase = typeof GlucoseCoachV3 !== 'undefined' ? GlucoseCoachV3 : {};
  const baseApi = nodeBase || browserBase;
  const baseAnalyzeMeal = baseApi.analyzeMealAdaptivePeak || baseApi.analyzeMealTwoHourPeak;
  const baseSelectMealBolus = baseApi.selectMealBolus;
  const baseBuildFoodComparisons = baseApi.buildFoodComparisons;

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

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function round(value, digits = 1) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function positiveBoluses(boluses, start, end) {
    return [...(boluses || [])]
      .filter((row) => finite(row?.[0]) !== null && finite(row?.[2]) > 0)
      .filter((row) => Number(row[0]) >= start && Number(row[0]) <= end)
      .sort((a, b) => Number(a[0]) - Number(b[0]));
  }

  function selectMealBolus(entry, boluses, minute, contextEnd) {
    if (typeof baseSelectMealBolus === 'function') {
      return baseSelectMealBolus(entry, boluses, minute, contextEnd);
    }
    const candidates = positiveBoluses(
      boluses,
      minute - BOLUS_LOOKBACK_MINUTES,
      Math.min(contextEnd, minute + MEAL_BOLUS_ASSOCIATION_MINUTES),
    ).filter((row) => finite(row[1]) > 0);
    if (!candidates.length) return null;
    const diaryCarbs = finite(entry?.carbs);
    return [...candidates].sort((a, b) => {
      if (diaryCarbs !== null) {
        const carbDistance = Math.abs(Number(a[1]) - diaryCarbs) -
          Math.abs(Number(b[1]) - diaryCarbs);
        if (carbDistance !== 0) return carbDistance;
      }
      return Math.abs(Number(a[0]) - minute) - Math.abs(Number(b[0]) - minute);
    })[0] || null;
  }

  function nextMealBolus(mealBolus, boluses, mealMinute) {
    if (!mealBolus) return null;
    return positiveBoluses(
      boluses,
      Number(mealBolus[0]) + 2,
      mealMinute + TWO_HOUR_MINUTES,
    ).find((row) => finite(row[1]) > 0) || null;
  }

  function closest(rows, target) {
    return [...rows].sort(
      (a, b) => Math.abs(Number(a[0]) - target) - Math.abs(Number(b[0]) - target),
    )[0] || null;
  }

  function maxGap(rows) {
    let result = 0;
    for (let index = 1; index < rows.length; index += 1) {
      result = Math.max(result, Number(rows[index][0]) - Number(rows[index - 1][0]));
    }
    return result;
  }

  function contiguousConfirmation(rows, startIndex) {
    const candidate = rows[startIndex];
    const future = [];
    let previousMinute = Number(candidate[0]);
    for (let index = startIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (Number(row[0]) - Number(candidate[0]) > DECLINE_CONFIRMATION_MINUTES + 5) break;
      if (Number(row[0]) - previousMinute > DECLINE_MAX_POINT_GAP_MINUTES) break;
      future.push(row);
      previousMinute = Number(row[0]);
      if (future.length === DECLINE_CONFIRMATION_POINTS) break;
    }
    if (future.length < DECLINE_CONFIRMATION_POINTS) return null;
    if (Number(future.at(-1)[0]) - Number(candidate[0]) < DECLINE_CONFIRMATION_MINUTES - 5) {
      return null;
    }
    return future;
  }

  function findSustainedDecline(rows, earliestMinute) {
    const first = rows.findIndex((row) => Number(row[0]) >= earliestMinute);
    if (first < 0) return null;
    for (let index = first; index < rows.length; index += 1) {
      const candidate = rows[index];
      const future = contiguousConfirmation(rows, index);
      if (!future) continue;
      const sequence = [candidate, ...future];
      const nonIncreasingSteps = future
        .map((row, deltaIndex) => Number(row[1]) - Number(sequence[deltaIndex][1]))
        .filter((delta) => delta <= DECLINE_STEP_TOLERANCE_MGDL).length;
      const highestConfirmationValue = Math.max(...future.map((row) => Number(row[1])));
      const remaining = rows.slice(index + 1);
      const highestLaterValue = remaining.length
        ? Math.max(...remaining.map((row) => Number(row[1])))
        : Number(candidate[1]);
      const confirmedDrop = Number(candidate[1]) - Number(future.at(-1)[1]);
      if (
        highestConfirmationValue <= Number(candidate[1]) &&
        nonIncreasingSteps >= DECLINE_CONFIRMATION_POINTS - 1 &&
        confirmedDrop >= DECLINE_DROP_MGDL &&
        highestLaterValue <= Number(candidate[1]) + DECLINE_REBOUND_TOLERANCE_MGDL
      ) {
        return candidate;
      }
    }
    return null;
  }

  function reliableFallback(post, mealMinute, cutoff) {
    const availableMinutes = cutoff - mealMinute;
    const expectedPoints = Math.max(0, Math.floor((cutoff - (mealMinute + 5)) / 5) + 1);
    const coverage = expectedPoints > 0 ? post.length / expectedPoints : 0;
    return {
      available: availableMinutes >= MIN_FALLBACK_WINDOW_MINUTES &&
        post.length >= MIN_FALLBACK_POINTS &&
        coverage >= MIN_FALLBACK_COVERAGE &&
        maxGap(post) <= MAX_FALLBACK_GAP_MINUTES,
      availableMinutes,
      coverage,
    };
  }

  function analyzeMealWithBolusCutoff(entry, cgm, boluses, nextMealMinute = null) {
    const baseResult = typeof baseAnalyzeMeal === 'function'
      ? baseAnalyzeMeal(entry, cgm, boluses, nextMealMinute)
      : { entry, complete: false, status: 'partial-analysis' };
    const minute = parseTime(entry?.when);
    if (minute === null) return baseResult;

    const diaryContextEnd = Number.isFinite(nextMealMinute) && nextMealMinute > minute
      ? Math.min(minute + MEAL_CONTEXT_MINUTES, nextMealMinute - 1)
      : minute + MEAL_CONTEXT_MINUTES;
    const mealBolus = baseResult.mealBolus || baseResult.bolus ||
      selectMealBolus(entry, boluses, minute, diaryContextEnd);
    const followingMealBolus = nextMealBolus(mealBolus, boluses, minute);
    if (!mealBolus || !followingMealBolus) return baseResult;

    const nextBolusCutoff = Number(followingMealBolus[0]) - 1;
    const diaryCutoff = Number.isFinite(nextMealMinute) && nextMealMinute > minute
      ? nextMealMinute - 1
      : Number.POSITIVE_INFINITY;
    const cutoff = Math.min(nextBolusCutoff, diaryCutoff);
    const windowRows = (cgm || [])
      .filter((row) =>
        finite(row?.[0]) !== null && finite(row?.[1]) !== null &&
        Number(row[0]) >= minute - BOLUS_LOOKBACK_MINUTES &&
        Number(row[0]) <= cutoff,
      )
      .map((row) => [Number(row[0]), Number(row[1])])
      .sort((a, b) => a[0] - b[0]);
    const pre = windowRows.filter((row) => row[0] <= minute);
    const post = windowRows.filter((row) => row[0] >= minute + 5);
    const reliability = reliableFallback(post, minute, cutoff);

    if (!pre.length || !reliability.available) {
      return {
        ...baseResult,
        complete: false,
        status: 'overlapping-meal',
        mealBolus,
        bolus: mealBolus,
        nextMealBolus: followingMealBolus,
        truncatedByNextMealBolus: true,
        twoHourFallback: true,
        twoHourFallbackAvailable: false,
        twoHourFallbackCoverage: round(reliability.coverage * 100, 1),
        twoHourFallbackWindowMinutes: reliability.availableMinutes,
      };
    }

    const baseline = Number(pre.at(-1)[1]);
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

    const declineSearchStart = Math.max(minute + 5, Number(mealBolus[0]) + 10);
    const turn = findSustainedDecline(post, declineSearchStart);
    const peakRows = turn
      ? windowRows.filter(
          (row) => row[0] >= Number(mealBolus[0]) && row[0] <= Number(turn[0]),
        )
      : [];
    const peakRow = peakRows.length
      ? peakRows.reduce((best, row) => row[1] > best[1] ? row : best, peakRows[0])
      : null;
    const fallbackRow = post.reduce(
      (best, row) => row[1] > best[1] ? row : best,
      post[0],
    );
    const bolusStartRow = closest(windowRows, Number(mealBolus[0]));
    const bolusesInContext = positiveBoluses(
      boluses,
      minute - BOLUS_LOOKBACK_MINUTES,
      cutoff,
    );
    const bolusesBeforeTurn = turn
      ? bolusesInContext.filter((row) => Number(row[0]) <= Number(turn[0]))
      : [];
    const ignoredBolusesBeforeTurn = bolusesBeforeTurn.filter(
      (row) => Number(row[0]) > Number(mealBolus[0]) && !(finite(row[1]) > 0),
    );
    const complete = Boolean(turn && peakRow && fallbackRow);

    return {
      ...baseResult,
      entry,
      minute,
      complete,
      status: complete ? 'complete-overlap-fallback' : 'overlapping-meal',
      baseline,
      minutesToRise: rise ? rise[0] - minute : null,
      peak: peakRow?.[1] ?? null,
      minutesToPeak: peakRow ? peakRow[0] - minute : null,
      peakFromBolus: peakRow ? peakRow[0] - Number(mealBolus[0]) : null,
      peakDelta: peakRow ? peakRow[1] - baseline : null,
      peakDeltaFromBolus: peakRow && bolusStartRow
        ? peakRow[1] - bolusStartRow[1]
        : null,
      twoHour: fallbackRow[1],
      twoHourDelta: fallbackRow[1] - baseline,
      twoHourFallback: true,
      twoHourFallbackAvailable: true,
      twoHourFallbackCoverage: round(reliability.coverage * 100, 1),
      twoHourFallbackWindowMinutes: reliability.availableMinutes,
      twoHourFallbackObservedMinute: fallbackRow[0],
      twoHourFallbackObservedFromMeal: fallbackRow[0] - minute,
      twoHourReferenceKind: 'maximum-before-next-meal-bolus',
      bolus: mealBolus,
      mealBolus,
      bolusOffset: Number(mealBolus[0]) - minute,
      bolusCountBeforeTurn: bolusesBeforeTurn.length,
      ignoredBolusCountBeforeTurn: ignoredBolusesBeforeTurn.length,
      turnMinute: turn?.[0] ?? null,
      turnFromMeal: turn ? turn[0] - minute : null,
      turnFromBolus: turn ? turn[0] - Number(mealBolus[0]) : null,
      turnAfterPeak: turn && peakRow ? turn[0] >= peakRow[0] : null,
      nextMealBolus: followingMealBolus,
      nextMealBolusFromMeal: Number(followingMealBolus[0]) - minute,
      contextEnd: cutoff,
      truncatedByNextMealBolus: true,
    };
  }

  function analyzeMealsWithBolusCutoff(diary, cgm, boluses) {
    const meals = (diary || [])
      .filter((entry) => MEAL_OCCASIONS.has(entry.occasion))
      .map((entry) => ({ entry, minute: parseTime(entry.when) }));
    const chronological = meals
      .filter((item) => Number.isFinite(item.minute))
      .sort((a, b) => a.minute - b.minute);
    const nextMealByEntry = new Map();
    chronological.forEach((item, index) => {
      nextMealByEntry.set(item.entry, chronological[index + 1]?.minute ?? null);
    });
    return meals.map(({ entry }) =>
      analyzeMealWithBolusCutoff(entry, cgm, boluses, nextMealByEntry.get(entry) ?? null),
    );
  }

  function buildFoodComparisonsWithBolusCutoff(analyses) {
    const groups = typeof baseBuildFoodComparisons === 'function'
      ? baseBuildFoodComparisons(analyses)
      : [];
    const fallbackCounts = new Map();
    for (const analysis of analyses || []) {
      if (!analysis?.complete || !analysis.twoHourFallback) continue;
      const key = String(analysis.entry?.food || '').trim().toLocaleLowerCase('de-DE');
      if (key) fallbackCounts.set(key, (fallbackCounts.get(key) || 0) + 1);
    }
    return groups.map((group) => ({
      ...group,
      twoHourFallbackCount: fallbackCounts.get(
        String(group.label || '').trim().toLocaleLowerCase('de-DE'),
      ) || 0,
    }));
  }

  function formatNumber(value, digits = 0) {
    return Number.isFinite(Number(value))
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value))
      : '–';
  }

  function formatPeak(analysis) {
    if (!Number.isFinite(analysis.peak)) return 'nicht bestimmbar';
    const parts = [`${formatNumber(analysis.peak, 0)} mg/dl`];
    if (Number.isFinite(analysis.peakFromBolus)) {
      parts.push(`${formatNumber(analysis.peakFromBolus, 0)} min nach Mahlzeitenbolus`);
    }
    if (Number.isFinite(analysis.minutesToPeak)) {
      parts.push(`${formatNumber(analysis.minutesToPeak, 0)} min nach Essen`);
    }
    return parts.join(' · ');
  }

  function formatTurn(analysis) {
    if (!Number.isFinite(analysis.turnMinute)) return 'nicht vor dem nächsten Mahlzeitenbolus erkannt';
    return `${formatNumber(analysis.turnFromBolus, 0)} min nach Mahlzeitenbolus · ` +
      `${formatNumber(analysis.turnFromMeal, 0)} min nach Essen`;
  }

  function updateMealUi() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined') return;
    const analyses = analyzeMealsWithBolusCutoff(
      gcState.diary || [],
      gcState.clinical?.cgm || [],
      gcState.clinical?.boluses || [],
    ).sort((a, b) => (b.minute || 0) - (a.minute || 0));
    const items = document.querySelectorAll('#meal-events .analysis-item');

    items.forEach((item, index) => {
      const analysis = analyses[index];
      if (!analysis?.truncatedByNextMealBolus) return;
      const status = item.querySelector('.status');
      if (status) {
        status.className = `status ${analysis.complete ? 'ok' : 'wait'}`;
        status.textContent = analysis.complete
          ? 'vollständig · verkürzte 2-h-Referenz'
          : 'teilweise · nächster Mahlzeitenbolus';
      }
      const cells = item.querySelectorAll('.analysis-grid > div');
      if (cells.length < 6) return;
      cells[2].querySelector('span').textContent = 'Peak vor nächstem Mahlzeitenbolus';
      cells[2].querySelector('strong').textContent = formatPeak(analysis);
      cells[3].querySelector('span').textContent = 'Ersatz für 2-h-Wert';
      cells[3].querySelector('strong').textContent = analysis.twoHourFallbackAvailable
        ? `${formatNumber(analysis.twoHour, 0)} mg/dl · höchster Wert bis ` +
          `${formatNumber(analysis.nextMealBolusFromMeal, 0)} min nach Essen`
        : 'nicht ausreichend abgedeckt';
      cells[5].querySelector('span').textContent = 'CGM-Wendepunkt-Proxy (vor Folgebolus)';
      cells[5].querySelector('strong').textContent = formatTurn(analysis);
    });

    const groups = buildFoodComparisonsWithBolusCutoff(analyses);
    document.querySelectorAll('#food-comparison tr').forEach((row, index) => {
      const group = groups[index];
      if (!group || row.cells.length < 7) return;
      row.cells[1].textContent = String(group.entries);
      row.cells[2].textContent = String(group.analyzed);
      row.cells[3].textContent = group.analyzed && Number.isFinite(group.medianPeakDelta)
        ? `${formatNumber(group.medianPeakDelta, 0)} mg/dl`
        : 'wartet auf Daten';
      row.cells[4].textContent = group.analyzed && Number.isFinite(group.medianMinutesToPeak)
        ? `${formatNumber(group.medianMinutesToPeak, 0)} min`
        : '–';
      row.cells[5].textContent = group.analyzed && Number.isFinite(group.medianMinutesBolusToPeak)
        ? `${formatNumber(group.medianMinutesBolusToPeak, 0)} min`
        : '–';
      const twoHourValue = group.analyzed && Number.isFinite(group.medianTwoHourDelta)
        ? `${formatNumber(group.medianTwoHourDelta, 0)} mg/dl`
        : '–';
      row.cells[6].textContent = group.twoHourFallbackCount
        ? `${twoHourValue} · ${group.twoHourFallbackCount} verkürzt`
        : twoHourValue;
    });

    const note = document.querySelector('#food-comparison-note');
    if (note) {
      note.textContent =
        'Die 2-h-Änderung verwendet normalerweise den CGM-Wert um 120 Minuten. Beginnt vorher ' +
        'ein weiterer Mahlzeitenbolus mit positiver Kohlenhydratangabe, endet das Fenster dort ' +
        'und der höchste CGM-Wert bis unmittelbar davor wird als gekennzeichneter Ersatzwert ' +
        'verwendet. Der Folgebolus beeinflusst diesen Ersatzwert noch nicht.';
    }
    const intro = document.querySelector('#meal-analysis article.card.full p.muted');
    if (intro && !intro.textContent.includes('gekennzeichneter Ersatzwert')) {
      intro.textContent +=
        ' Beginnt ein weiterer Mahlzeitenbolus vor der 2-h-Marke, wird der höchste CGM-Wert ' +
        'bis unmittelbar davor als gekennzeichneter Ersatzwert verwendet.';
    }
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined') return;
    if (typeof analyzeMeals !== 'undefined') analyzeMeals = analyzeMealsWithBolusCutoff;
    if (typeof buildFoodComparisons !== 'undefined') {
      buildFoodComparisons = buildFoodComparisonsWithBolusCutoff;
    }
    if (typeof GlucoseCoachV3 !== 'undefined') {
      Object.assign(GlucoseCoachV3, {
        analyzeMealAdaptivePeak: analyzeMealWithBolusCutoff,
        analyzeMealTwoHourPeak: analyzeMealWithBolusCutoff,
        analyzeMeals: analyzeMealsWithBolusCutoff,
        buildFoodComparisons: buildFoodComparisonsWithBolusCutoff,
        GC_MEAL_TWO_HOUR_FALLBACK_MINUTES: TWO_HOUR_MINUTES,
      });
    }
    if (typeof gcMeals === 'function') {
      const previousMeals = gcMeals;
      gcMeals = function mealsWithBolusCutoff() {
        previousMeals();
        updateMealUi();
      };
    }
    updateMealUi();
  }

  const api = {
    ...baseApi,
    analyzeMealAdaptivePeak: analyzeMealWithBolusCutoff,
    analyzeMealTwoHourPeak: analyzeMealWithBolusCutoff,
    analyzeMeals: analyzeMealsWithBolusCutoff,
    buildFoodComparisons: buildFoodComparisonsWithBolusCutoff,
    nextMealBolus,
    GC_MEAL_TWO_HOUR_FALLBACK_MINUTES: TWO_HOUR_MINUTES,
    GC_MEAL_TWO_HOUR_FALLBACK_MIN_COVERAGE: MIN_FALLBACK_COVERAGE,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachMealOverlapFallback = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
