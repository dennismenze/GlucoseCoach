(function () {
  'use strict';

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      const mealWindow = require('./app-meal-window.js');
      const insulinCore = require('./app-insulin-core.js');
      const insulinModel = require('./app-insulin-model.js');
      module.exports = {
        ...require('./app-v3-core.js'),
        ...require('./app-importers.js'),
        ...require('./app-importers-context.js'),
        ...require('./app-ui-contract.js'),
        analyzeMealTwoHourPeak: mealWindow.analyzeMealTwoHourPeak,
        analyzeMeals: mealWindow.analyzeMeals,
        buildFoodComparisons: mealWindow.buildFoodComparisons,
        buildRecommendations: mealWindow.buildRecommendations,
        formatOffset: mealWindow.formatOffset,
        GC_POSTPRANDIAL_PEAK_MINUTES: mealWindow.GC_POSTPRANDIAL_PEAK_MINUTES,
        GC_MEAL_CONTEXT_MINUTES: mealWindow.GC_MEAL_CONTEXT_MINUTES,
        GC_DECLINE_CONFIRMATION_MINUTES: mealWindow.GC_DECLINE_CONFIRMATION_MINUTES,
        GC_DECLINE_DROP_MGDL: mealWindow.GC_DECLINE_DROP_MGDL,
        GC_DECLINE_REBOUND_TOLERANCE_MGDL: mealWindow.GC_DECLINE_REBOUND_TOLERANCE_MGDL,
        ...insulinCore,
        ...insulinModel,
      };
    }
    return;
  }

  function loadScript(src, onload) {
    const script = document.createElement('script');
    script.src = src;
    script.defer = false;
    script.onload = onload || null;
    script.onerror = () => {
      const target = document.querySelector('#import-progress');
      if (target) target.textContent = `Laden fehlgeschlagen: ${src}`;
    };
    document.head.appendChild(script);
  }

  loadScript('app-v3-core.js', () =>
    loadScript('app-importers.js', () =>
      loadScript('app-importers-context.js', () =>
        loadScript('app-ui-contract.js', () =>
          loadScript('app-meal-window.js', () =>
            loadScript('app-insulin-core.js', () =>
              loadScript('app-insulin-model.js', () => loadScript('app-insulin-ui.js')),
            ),
          ),
        ),
      ),
    ),
  );
})();
