(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const TWO_HOUR_MINUTES = 120;
  const MEAL_CONTEXT_MINUTES = 300;
  const FOLLOWING_BOLUS_MIN_GAP_MINUTES = 2;
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);

  const nodeBase = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-meal-management.js')
    : null;
  const browserBase = root?.GlucoseCoachMealManagement || root?.GlucoseCoachV3 || {};
  const baseApi = nodeBase || browserBase;
  const baseAnalyzeMeal = baseApi.analyzeMealAdaptivePeak || baseApi.analyzeMealTwoHourPeak;
  const baseBuildFoodComparisons = baseApi.buildFoodComparisons;
  const baseSelectMealBolus = baseApi.selectMealBolus;

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function parseTime(value) {
    const source = String(value ?? '').trim();
    if (!source) return null;
    const german = source.match(
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
    );
    if (german) {
      const date = new Date(
        Number(german[3]),
        Number(german[2]) - 1,
        Number(german[1]),
        Number(german[4]),
        Number(german[5]),
        Number(german[6] || 0),
      );
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
    }
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
  }

  function positiveMealBoluses(boluses, start, end) {
    return safeArray(boluses)
      .filter((row) => finite(row?.[0]) !== null)
      .filter((row) => finite(row?.[1]) > 0 && finite(row?.[2]) > 0)
      .filter((row) => Number(row[0]) >= start && Number(row[0]) <= end)
      .sort((a, b) => Number(a[0]) - Number(b[0]));
  }

  function followingMealBolus(mealBolus, boluses, mealMinute) {
    const bolusMinute = finite(mealBolus?.[0]);
    if (bolusMinute === null || !Number.isFinite(mealMinute)) return null;
    return positiveMealBoluses(
      boluses,
      bolusMinute + FOLLOWING_BOLUS_MIN_GAP_MINUTES,
      mealMinute + MEAL_CONTEXT_MINUTES,
    )[0] || null;
  }

  function hasReliableObservedWindow(analysis) {
    if (!analysis || typeof analysis !== 'object') return false;
    if (analysis.twoHourFallback === true || analysis.truncatedByNextMealBolus === true) {
      return analysis.twoHourFallbackAvailable === true;
    }
    if (typeof analysis.twoHourAvailable === 'boolean') return analysis.twoHourAvailable;
    return finite(analysis.twoHour) !== null;
  }

  function hasFinalPeak(analysis) {
    if (!analysis) return false;
    if (typeof analysis.peakComplete === 'boolean') return analysis.peakComplete;
    return Boolean(analysis.complete && finite(analysis.peak) !== null && finite(analysis.turnMinute) !== null);
  }

  function makeObservedWindowComplete(analysis, extra = {}) {
    if (!analysis || typeof analysis !== 'object') return analysis;
    if (analysis.complete || hasFinalPeak(analysis)) return { ...analysis, ...extra };
    if (!hasReliableObservedWindow(analysis)) return { ...analysis, ...extra };
    if (!(analysis.mealBolus || analysis.bolus)) return { ...analysis, ...extra };
    if (!['no-stable-decline', 'overlapping-meal'].includes(analysis.status)) {
      return { ...analysis, ...extra };
    }

    return {
      ...analysis,
      ...extra,
      complete: true,
      peakComplete: false,
      comparisonEligible: false,
      status: 'complete-observed-window',
      turnCensoredByContext: finite(extra?.nextMealBolusFromMeal) !== null ||
        analysis.truncatedByNextMeal === true ||
        analysis.truncatedByNextMealBolus === true,
    };
  }

  function analyzeMealWithFollowingBolusBoundary(entry, cgm, boluses, nextMealMinute = null) {
    if (typeof baseAnalyzeMeal !== 'function') {
      return { entry, complete: false, peakComplete: false, status: 'partial-analysis' };
    }

    const original = baseAnalyzeMeal(entry, cgm, boluses, nextMealMinute);
    const mealMinute = parseTime(entry?.when);
    if (mealMinute === null) return original;

    const knownMealBolus = original?.mealBolus || original?.bolus ||
      (typeof baseSelectMealBolus === 'function'
        ? baseSelectMealBolus(entry, boluses, mealMinute, mealMinute + MEAL_CONTEXT_MINUTES)
        : null);
    if (!knownMealBolus) return original;

    const following = followingMealBolus(knownMealBolus, boluses, mealMinute);
    const followingMinute = finite(following?.[0]);
    const diaryBoundary = finite(nextMealMinute);
    const diaryEndsFirst = diaryBoundary !== null && diaryBoundary > mealMinute &&
      (followingMinute === null || diaryBoundary <= followingMinute);

    if (
      followingMinute === null ||
      followingMinute - mealMinute <= TWO_HOUR_MINUTES ||
      diaryEndsFirst
    ) {
      return makeObservedWindowComplete(original);
    }

    const bounded = baseAnalyzeMeal(entry, cgm, boluses, followingMinute);
    const boundaryFields = {
      nextMealBolus: following,
      nextMealBolusFromMeal: followingMinute - mealMinute,
      contextEnd: followingMinute - 1,
      truncatedByNextMealBolus: true,
      twoHourFallback: false,
      turnCensoredByNextMealBolus: !hasFinalPeak(bounded),
    };

    if (hasFinalPeak(bounded)) {
      return {
        ...bounded,
        ...boundaryFields,
        complete: true,
        peakComplete: true,
        comparisonEligible: true,
        status: 'complete-before-following-meal-bolus',
        turnCensoredByNextMealBolus: false,
      };
    }

    return makeObservedWindowComplete(bounded, boundaryFields);
  }

  function analyzeMealsWithFollowingBolusBoundary(diary, cgm, boluses) {
    const meals = safeArray(diary)
      .filter((entry) => MEAL_OCCASIONS.has(entry?.occasion))
      .map((entry) => ({ entry, minute: parseTime(entry.when) }));
    const chronological = meals
      .filter((item) => Number.isFinite(item.minute))
      .sort((a, b) => itemMinute(a) - itemMinute(b));
    const nextMealByEntry = new Map();
    chronological.forEach((item, index) => {
      nextMealByEntry.set(item.entry, chronological[index + 1]?.minute ?? null);
    });

    return meals.map(({ entry }) => analyzeMealWithFollowingBolusBoundary(
      entry,
      cgm,
      boluses,
      nextMealByEntry.get(entry) ?? null,
    ));
  }

  function itemMinute(item) {
    return Number(item?.minute || 0);
  }

  function comparisonAnalyses(analyses) {
    return safeArray(analyses).map((analysis) => ({
      ...analysis,
      complete: hasFinalPeak(analysis),
    }));
  }

  function buildFoodComparisonsWithFollowingBolusBoundary(analyses) {
    if (typeof baseBuildFoodComparisons !== 'function') return [];
    return baseBuildFoodComparisons(comparisonAnalyses(analyses));
  }

  function formatNumber(value, digits = 0) {
    const numeric = finite(value);
    return numeric === null
      ? '–'
      : new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(numeric);
  }

  function formatPeak(analysis) {
    if (!hasFinalPeak(analysis) || finite(analysis.peak) === null) {
      return 'nicht endgültig bestimmbar';
    }
    const parts = [`${formatNumber(analysis.peak)} mg/dl`];
    if (finite(analysis.peakFromBolus) !== null) {
      parts.push(`${formatNumber(analysis.peakFromBolus)} min nach Mahlzeitenbolus`);
    }
    if (finite(analysis.minutesToPeak) !== null) {
      parts.push(`${formatNumber(analysis.minutesToPeak)} min nach Essen`);
    }
    return parts.join(' · ');
  }

  function formatTurn(analysis) {
    if (finite(analysis.turnMinute) === null) {
      const boundary = finite(analysis.nextMealBolusFromMeal);
      return boundary === null
        ? 'kein stabiler Wendepunkt im vollständig beobachteten Fenster erkannt'
        : 'kein stabiler Wendepunkt vor dem nächsten Mahlzeitenbolus erkannt · ' +
          `Fenster endete ${formatNumber(boundary)} min nach Essen`;
    }
    return `${formatNumber(analysis.turnFromBolus)} min nach Mahlzeitenbolus · ` +
      `${formatNumber(analysis.turnFromMeal)} min nach Essen`;
  }

  function currentAnalyses() {
    if (typeof gcState === 'undefined') return [];
    return analyzeMealsWithFollowingBolusBoundary(
      gcState.diary || [],
      gcState.clinical?.cgm || [],
      gcState.clinical?.boluses || [],
    );
  }

  function updateMealCards() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined') return;
    const analyses = currentAnalyses().sort((a, b) => itemMinute(b) - itemMinute(a));
    const items = document.querySelectorAll('#meal-events .analysis-item');

    items.forEach((item, index) => {
      const analysis = analyses[index];
      if (!analysis || ![
        'complete-before-following-meal-bolus',
        'complete-observed-window',
      ].includes(analysis.status)) return;

      item.dataset.analysisStatus = analysis.status;
      const status = item.querySelector('.status');
      if (status) {
        status.className = 'status ok';
        status.textContent = analysis.status === 'complete-before-following-meal-bolus'
          ? 'vollständig'
          : 'vollständig · kein stabiler Wendepunkt';
      }

      const cells = item.querySelectorAll('.analysis-grid > div');
      if (cells.length < 6) return;
      cells[2].querySelector('span').textContent = analysis.peakComplete
        ? 'Peak nach Mahlzeitenbolus'
        : 'Endgültiger Peak';
      cells[2].querySelector('strong').textContent = analysis.peakComplete
        ? formatPeak(analysis)
        : 'nicht endgültig bestimmbar · kein stabiler Wendepunkt im nutzbaren Fenster';
      cells[5].querySelector('span').textContent = analysis.truncatedByNextMealBolus
        ? 'CGM-Wendepunkt-Proxy (vor nächster Mahlzeit)'
        : 'CGM-Wendepunkt-Proxy (beobachtetes Fenster)';
      cells[5].querySelector('strong').textContent = formatTurn(analysis);
    });
  }

  function updateMethodText() {
    if (typeof document === 'undefined') return;
    const note = document.querySelector('#food-comparison-note');
    if (note && !note.textContent.includes('positive Kohlenhydratangabe beendet')) {
      note.textContent +=
        ' Ein späterer positiver Bolus mit positiver Kohlenhydratangabe beendet das ' +
        'Mahlzeitenfenster auch nach der 2-h-Marke. Vollständig beobachtete Ereignisse ohne ' +
        'bestätigten Wendepunkt werden als vollständig gekennzeichnet, aber nicht für ' +
        'endgültige Peak-Vergleiche verwendet.';
    }
  }

  function installBrowserPatch() {
    if (
      typeof document === 'undefined' ||
      typeof gcRender !== 'function' ||
      typeof gcState === 'undefined' ||
      root?.__glucoseCoachMealBoundaryInstalled
    ) return;
    if (root) root.__glucoseCoachMealBoundaryInstalled = true;

    if (typeof analyzeMeals !== 'undefined') {
      analyzeMeals = analyzeMealsWithFollowingBolusBoundary;
    }
    if (typeof buildFoodComparisons !== 'undefined') {
      buildFoodComparisons = buildFoodComparisonsWithFollowingBolusBoundary;
    }
    if (typeof GlucoseCoachV3 !== 'undefined') {
      Object.assign(GlucoseCoachV3, {
        analyzeMealAdaptivePeak: analyzeMealWithFollowingBolusBoundary,
        analyzeMealTwoHourPeak: analyzeMealWithFollowingBolusBoundary,
        analyzeMeals: analyzeMealsWithFollowingBolusBoundary,
        buildFoodComparisons: buildFoodComparisonsWithFollowingBolusBoundary,
        followingMealBolus,
      });
    }

    const previousMeals = typeof gcMeals === 'function' ? gcMeals : null;
    if (previousMeals) {
      gcMeals = function mealsWithFollowingBolusBoundary() {
        previousMeals();
        updateMealCards();
        updateMethodText();
      };
    }

    gcRender();
  }

  const api = {
    ...baseApi,
    analyzeMealAdaptivePeak: analyzeMealWithFollowingBolusBoundary,
    analyzeMealTwoHourPeak: analyzeMealWithFollowingBolusBoundary,
    analyzeMeals: analyzeMealsWithFollowingBolusBoundary,
    buildFoodComparisons: buildFoodComparisonsWithFollowingBolusBoundary,
    followingMealBolus,
    makeObservedWindowComplete,
    hasReliableObservedWindow,
    GC_FOLLOWING_MEAL_BOLUS_CONTEXT_MINUTES: MEAL_CONTEXT_MINUTES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachMealBoundary = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
