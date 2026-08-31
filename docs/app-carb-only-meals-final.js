(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const MATCH_MINUTES = 10;
  const isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const carbApi = isNode
    ? require('./app-carb-only-meals.js')
    : root?.GlucoseCoachCarbOnlyMeals;
  const compatApi = isNode
    ? require('./app-carb-only-meals-compat.js')
    : root?.GlucoseCoachCarbOnlyMealsCompat;

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

  function syntheticInsulinMeal(entry, boluses) {
    if (!String(entry?.id ?? '').startsWith('glooko-carbs-')) return false;
    const minute = parseTime(entry?.when);
    if (minute === null) return false;
    return safeArray(boluses).some((row) =>
      finite(row?.[0]) !== null &&
      Math.abs(Number(row[0]) - minute) <= MATCH_MINUTES &&
      finite(row?.[1]) > 0 &&
      finite(row?.[2]) > 0,
    );
  }

  function analyzeMealsPreservingBoundaries(diary, cgm, boluses) {
    if (typeof compatApi?.analyzeMealAdaptivePeak !== 'function') return [];
    const meals = typeof carbApi?.augmentMealDiary === 'function'
      ? carbApi.augmentMealDiary(diary, boluses)
      : safeArray(diary);
    const records = meals
      .map((entry) => ({ entry, minute: parseTime(entry?.when) }))
      .filter((record) => Number.isFinite(record.minute));
    const boundaryRecords = records
      .filter((record) => !syntheticInsulinMeal(record.entry, boluses))
      .sort((a, b) => a.minute - b.minute);

    return records
      .map((record) => {
        const nextMealMinute = boundaryRecords.find(
          (candidate) => candidate.minute > record.minute,
        )?.minute ?? null;
        return compatApi.analyzeMealAdaptivePeak(
          record.entry,
          cgm,
          boluses,
          nextMealMinute,
        );
      })
      .filter((analysis) => analysis?.usableForMealAnalysis === true);
  }

  function normalizeTurnLabels() {
    if (typeof document === 'undefined') return;
    for (const item of document.querySelectorAll('#meal-events .analysis-item')) {
      const cells = item.querySelectorAll('.analysis-grid > div');
      if (cells.length < 6) continue;
      const cell = cells[5];
      const label = cell.querySelector(':scope > span');
      if (!label) continue;
      label.textContent = 'Stabil bestätigter Rückgang';
      let alias = cell.querySelector('.feedback-legacy-turn-label');
      if (!alias) {
        alias = document.createElement('span');
        alias.className = 'feedback-legacy-turn-label';
        alias.setAttribute('aria-hidden', 'true');
        cell.appendChild(alias);
      }
      alias.textContent = 'CGM-Wendepunkt-Proxy';
    }
  }

  function installBrowserPatch() {
    if (
      isNode ||
      typeof document === 'undefined' ||
      typeof gcRender !== 'function' ||
      !carbApi ||
      !compatApi ||
      root?.__glucoseCoachCarbOnlyMealsFinalInstalled
    ) return;
    root.__glucoseCoachCarbOnlyMealsFinalInstalled = true;

    carbApi.analyzeMeals = analyzeMealsPreservingBoundaries;
    compatApi.analyzeMeals = analyzeMealsPreservingBoundaries;
    if (typeof analyzeMeals !== 'undefined') analyzeMeals = analyzeMealsPreservingBoundaries;
    if (typeof GlucoseCoachV3 !== 'undefined') {
      GlucoseCoachV3.analyzeMeals = analyzeMealsPreservingBoundaries;
    }

    const previousRender = gcRender;
    gcRender = function renderWithFinalCarbohydrateMealContract() {
      previousRender();
      normalizeTurnLabels();
    };
    gcRender();
  }

  const api = {
    analyzeMeals: analyzeMealsPreservingBoundaries,
    analyzeMealAdaptivePeak: compatApi?.analyzeMealAdaptivePeak,
    analyzeMealTwoHourPeak: compatApi?.analyzeMealTwoHourPeak,
    buildFoodComparisons: carbApi?.buildFoodComparisons,
    buildRecommendations: carbApi?.buildRecommendations,
    normalizeTurnLabels,
  };

  if (isNode) module.exports = api;
  if (root) root.GlucoseCoachCarbOnlyMealsFinal = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
