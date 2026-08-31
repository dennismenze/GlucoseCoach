(function () {
  'use strict';

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      const mealWindow = require('./app-meal-window.js');
      const mealOverlap = require('./app-meal-overlap-fallback.js');
      const mealManagement = require('./app-meal-management.js');
      const mealBoundary = require('./app-meal-boundary.js');
      const insulinAction = require('./app-insulin-action.js');
      const allBolusPhases = require('./app-all-bolus-phases.js');
      const earlyBolusEffect = require('./app-early-bolus-effect.js');
      const importers = require('./app-importers-context.js');
      const exportCore = require('./app-export-core.js');
      const zipExchange = require('./app-zip64-compat.js');
      const insulinSummaryCore = require('./app-insulin-summary-core.js');
      const glookoMode = require('./app-glooko-mode.js');
      const feedbackUi = require('./app-feedback-ui.js');
      const feedbackGlooko = require('./app-feedback-glooko.js');
      const mealBolusAlignment = require('./app-meal-bolus-alignment.js');
      const feedbackPolish = require('./app-feedback-polish.js');
      const carbOnlyMeals = require('./app-carb-only-meals.js');
      const carbOnlyMealsCompat = require('./app-carb-only-meals-compat.js');
      const carbOnlyMealsFinal = require('./app-carb-only-meals-final.js');
      const carbOnlyMealTiming = require('./app-carb-only-meals-timing.js');
      const carbOnlyMealAssociation = require('./app-carb-only-meals-association.js');
      module.exports = {
        ...require('./app-v3-core.js'),
        ...require('./app-importers.js'),
        ...importers,
        ...require('./app-ui-contract.js'),
        ...mealWindow,
        ...mealOverlap,
        ...mealManagement,
        ...mealBoundary,
        ...insulinAction,
        ...exportCore,
        ...zipExchange,
        ...insulinSummaryCore,
        ...allBolusPhases,
        ...earlyBolusEffect,
        ...glookoMode,
        ...feedbackUi,
        ...feedbackGlooko,
        ...mealBolusAlignment,
        ...feedbackPolish,
        ...carbOnlyMeals,
        ...carbOnlyMealsCompat,
        ...carbOnlyMealsFinal,
        ...carbOnlyMealTiming,
        ...carbOnlyMealAssociation,
        parseClinicalCsv: importers.parseClinicalCsv,
        mergeClinical: importers.mergeClinical,
        normalizeClinical: importers.normalizeClinical,
        analyzeMeals: carbOnlyMealsFinal.analyzeMeals,
        analyzeMealAdaptivePeak: carbOnlyMealTiming.analyzeMealAdaptivePeak,
        analyzeMealTwoHourPeak: carbOnlyMealTiming.analyzeMealTwoHourPeak,
        buildFoodComparisons: carbOnlyMeals.buildFoodComparisons,
        augmentMealDiary: carbOnlyMealAssociation.augmentMealDiary,
      };
    }
    return;
  }

  function scriptSource(src) {
    if (src === 'version.js') return `${src}?refresh=${Date.now()}`;
    const version = String(globalThis.GLUCOSECOACH_VERSION || '').trim();
    return version ? `${src}?v=${encodeURIComponent(version)}` : src;
  }

  function loadScript(src, onload) {
    const script = document.createElement('script');
    script.src = scriptSource(src);
    script.defer = false;
    script.onload = () => {
      if (onload) onload();
    };
    script.onerror = () => {
      const target = document.querySelector('#import-progress');
      if (target) target.textContent = `Laden fehlgeschlagen: ${src}`;
      if (onload) onload();
    };
    document.head.appendChild(script);
  }

  function prepareCarbOnlyInstall() {
    // app-carb-only-meals.js historically rendered immediately while later
    // compatibility patches were still loading. Suppress only that bootstrap
    // render; the last association patch performs one complete render.
    globalThis.__glucoseCoachCarbOnlyMealsInstalled = true;
  }

  function activateCarbOnlyApi() {
    const api = globalThis.GlucoseCoachCarbOnlyMeals;
    if (!api) return;
    if (typeof analyzeMeals !== 'undefined') analyzeMeals = api.analyzeMeals;
    if (typeof buildFoodComparisons !== 'undefined') {
      buildFoodComparisons = api.buildFoodComparisons;
    }
    if (typeof buildRecommendations !== 'undefined') {
      buildRecommendations = api.buildRecommendations;
    }
    if (typeof GlucoseCoachV3 !== 'undefined') {
      Object.assign(GlucoseCoachV3, {
        analyzeMealAdaptivePeak: api.analyzeMealAdaptivePeak,
        analyzeMealTwoHourPeak: api.analyzeMealTwoHourPeak,
        analyzeMeals: api.analyzeMeals,
        buildFoodComparisons: api.buildFoodComparisons,
        buildRecommendations: api.buildRecommendations,
        augmentMealDiary: api.augmentMealDiary,
      });
    }
  }

  const scripts = [
    'app-v3-core.js',
    'app-importers.js',
    'app-importers-context.js',
    'app-ui-contract.js',
    'app-meal-window.js',
    'app-meal-overlap-fallback.js',
    'app-insulin-action.js',
    'app-export-core.js',
    'app-zip-core.js',
    'app-zip64-compat.js',
    'app-export-ui.js',
    'app-insulin-summary-core.js',
    'app-insulin-summary-ui.js',
    'app-all-bolus-phases.js',
    'app-compact-lists.js',
    'app-insulin-page-ui.js',
    'app-meal-page-ui.js',
    'app-meal-management.js',
    'app-meal-boundary.js',
    'app-glooko-mode.js',
    'app-feedback-ui.js',
    'app-feedback-glooko.js',
    'app-early-bolus-effect.js',
    'app-meal-bolus-alignment.js',
    'app-feedback-polish.js',
    'app-carb-only-meals.js',
    'app-carb-only-meals-compat.js',
    'app-carb-only-meals-final.js',
    'app-carb-only-meals-timing.js',
    'app-carb-only-meals-association.js',
    'app-version.js',
  ];

  function loadNext(index) {
    const src = scripts[index];
    if (!src) return;
    if (src === 'app-carb-only-meals.js') prepareCarbOnlyInstall();
    loadScript(src, () => {
      if (src === 'app-carb-only-meals.js') activateCarbOnlyApi();
      loadNext(index + 1);
    });
  }

  loadScript('version.js', () => loadNext(0));
})();