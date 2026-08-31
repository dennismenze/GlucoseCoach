(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const compatibility = isNode
    ? require('./app-carb-only-meals-compat.js')
    : root?.GlucoseCoachCarbOnlyMealsCompat;
  const finalApi = isNode
    ? require('./app-carb-only-meals-final.js')
    : root?.GlucoseCoachCarbOnlyMealsFinal;
  const carbApi = isNode
    ? require('./app-carb-only-meals.js')
    : root?.GlucoseCoachCarbOnlyMeals;
  const previousAnalyzeMeal = compatibility?.analyzeMealAdaptivePeak ||
    compatibility?.analyzeMealTwoHourPeak;

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function normalizeMealRelativeTiming(analysis) {
    if (!analysis || typeof analysis !== 'object') return analysis;
    const bolusOffset = finite(analysis.bolusOffset);
    if (bolusOffset === null) return analysis;

    const normalized = { ...analysis };
    const peakFromBolus = finite(analysis.peakFromBolus);
    const turnFromBolus = finite(analysis.turnFromBolus);
    if (peakFromBolus !== null) normalized.minutesToPeak = peakFromBolus + bolusOffset;
    if (turnFromBolus !== null) normalized.turnFromMeal = turnFromBolus + bolusOffset;
    return normalized;
  }

  function analyzeMealWithConsistentTiming(entry, cgm, boluses, nextMealMinute = null) {
    if (typeof previousAnalyzeMeal !== 'function') return null;
    return normalizeMealRelativeTiming(
      previousAnalyzeMeal(entry, cgm, boluses, nextMealMinute),
    );
  }

  function installBrowserPatch() {
    if (
      isNode ||
      typeof document === 'undefined' ||
      typeof gcRender !== 'function' ||
      !compatibility ||
      root?.__glucoseCoachCarbOnlyMealTimingInstalled
    ) return;
    root.__glucoseCoachCarbOnlyMealTimingInstalled = true;

    compatibility.analyzeMealAdaptivePeak = analyzeMealWithConsistentTiming;
    compatibility.analyzeMealTwoHourPeak = analyzeMealWithConsistentTiming;
    if (carbApi) {
      carbApi.analyzeMealAdaptivePeak = analyzeMealWithConsistentTiming;
      carbApi.analyzeMealTwoHourPeak = analyzeMealWithConsistentTiming;
    }
    if (typeof GlucoseCoachV3 !== 'undefined') {
      GlucoseCoachV3.analyzeMealAdaptivePeak = analyzeMealWithConsistentTiming;
      GlucoseCoachV3.analyzeMealTwoHourPeak = analyzeMealWithConsistentTiming;
    }
  }

  const api = {
    analyzeMealAdaptivePeak: analyzeMealWithConsistentTiming,
    analyzeMealTwoHourPeak: analyzeMealWithConsistentTiming,
    analyzeMeals: finalApi?.analyzeMeals,
    buildFoodComparisons: finalApi?.buildFoodComparisons || carbApi?.buildFoodComparisons,
    buildRecommendations: finalApi?.buildRecommendations || carbApi?.buildRecommendations,
    normalizeMealRelativeTiming,
  };

  if (isNode) module.exports = api;
  if (root) root.GlucoseCoachCarbOnlyMealTiming = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);