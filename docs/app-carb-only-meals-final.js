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
  let analysisCache = null;

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

  function hashText(hash, value) {
    const text = String(value ?? '');
    let next = hash >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      next ^= text.charCodeAt(index);
      next = Math.imul(next, 16_777_619) >>> 0;
    }
    next ^= 31;
    return Math.imul(next, 16_777_619) >>> 0;
  }

  function diarySignature(diary) {
    const entries = safeArray(diary);
    let hash = 2_166_136_261;
    for (const entry of entries) {
      for (const value of [
        entry?.id,
        entry?.when,
        entry?.occasion,
        entry?.food,
        entry?.carbs,
        entry?.fat,
        entry?.protein,
        entry?.fiber,
        entry?.activity,
        entry?.sleep,
        entry?.stress,
        entry?.illness,
        entry?.notes,
        entry?.source,
        entry?.readOnly,
      ]) hash = hashText(hash, value);
    }
    return `${entries.length}:${hash >>> 0}`;
  }

  function edgeSignature(rows) {
    const values = safeArray(rows);
    const first = values[0] || [];
    const last = values.at(-1) || [];
    return `${values.length}:${first.map((value) => String(value ?? '')).join('|')}:` +
      `${last.map((value) => String(value ?? '')).join('|')}`;
  }

  function clearAnalysisCache() {
    analysisCache = null;
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
    const analyzeMeal = compatApi?.analyzeMealAdaptivePeak;
    const augmentMeals = carbApi?.augmentMealDiary;
    if (typeof analyzeMeal !== 'function') return [];

    const cgmRows = safeArray(cgm);
    const bolusRows = safeArray(boluses);
    const snapshot = {
      diary: diarySignature(diary),
      cgmRows,
      cgmEdge: edgeSignature(cgmRows),
      bolusRows,
      bolusEdge: edgeSignature(bolusRows),
      analyzeMeal,
      augmentMeals,
    };
    if (
      analysisCache &&
      analysisCache.diary === snapshot.diary &&
      analysisCache.cgmRows === snapshot.cgmRows &&
      analysisCache.cgmEdge === snapshot.cgmEdge &&
      analysisCache.bolusRows === snapshot.bolusRows &&
      analysisCache.bolusEdge === snapshot.bolusEdge &&
      analysisCache.analyzeMeal === snapshot.analyzeMeal &&
      analysisCache.augmentMeals === snapshot.augmentMeals
    ) return analysisCache.result.slice();

    const meals = typeof augmentMeals === 'function'
      ? augmentMeals(diary, bolusRows)
      : safeArray(diary);
    const records = meals
      .map((entry) => ({ entry, minute: parseTime(entry?.when) }))
      .filter((record) => Number.isFinite(record.minute));
    const boundaryRecords = records
      .filter((record) => !syntheticInsulinMeal(record.entry, bolusRows))
      .sort((a, b) => a.minute - b.minute);
    const nextBoundaryByRecord = new Map();
    let nextBoundary = null;
    for (let index = boundaryRecords.length - 1; index >= 0; index -= 1) {
      const record = boundaryRecords[index];
      nextBoundaryByRecord.set(record, nextBoundary);
      nextBoundary = record.minute;
    }

    const result = records
      .map((record) => {
        let nextMealMinute = null;
        if (nextBoundaryByRecord.has(record)) {
          nextMealMinute = nextBoundaryByRecord.get(record);
        } else {
          let low = 0;
          let high = boundaryRecords.length;
          while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (boundaryRecords[middle].minute <= record.minute) low = middle + 1;
            else high = middle;
          }
          nextMealMinute = boundaryRecords[low]?.minute ?? null;
        }
        return analyzeMeal(
          record.entry,
          cgmRows,
          bolusRows,
          nextMealMinute,
        );
      })
      .filter((analysis) => analysis?.usableForMealAnalysis === true);

    analysisCache = { ...snapshot, result };
    return result.slice();
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
  }

  const api = {
    analyzeMeals: analyzeMealsPreservingBoundaries,
    analyzeMealAdaptivePeak: compatApi?.analyzeMealAdaptivePeak,
    analyzeMealTwoHourPeak: compatApi?.analyzeMealTwoHourPeak,
    buildFoodComparisons: carbApi?.buildFoodComparisons,
    buildRecommendations: carbApi?.buildRecommendations,
    normalizeTurnLabels,
    clearAnalysisCache,
    diarySignature,
  };

  if (isNode) module.exports = api;
  if (root) root.GlucoseCoachCarbOnlyMealsFinal = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);