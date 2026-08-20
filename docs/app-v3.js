(function () {
  'use strict';

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      const mealWindow = require('./app-meal-window.js');
      const mealOverlap = require('./app-meal-overlap-fallback.js');
      const insulinAction = require('./app-insulin-action.js');
      const allBolusPhases = require('./app-all-bolus-phases.js');
      const importers = require('./app-importers-context.js');
      const exportCore = require('./app-export-core.js');
      const zipExchange = require('./app-zip64-compat.js');
      const insulinSummaryCore = require('./app-insulin-summary-core.js');
      module.exports = {
        ...require('./app-v3-core.js'),
        ...require('./app-importers.js'),
        ...importers,
        ...require('./app-ui-contract.js'),
        ...mealWindow,
        ...mealOverlap,
        ...insulinAction,
        ...exportCore,
        ...zipExchange,
        ...insulinSummaryCore,
        ...allBolusPhases,
        parseClinicalCsv: importers.parseClinicalCsv,
        mergeClinical: importers.mergeClinical,
        normalizeClinical: importers.normalizeClinical,
        analyzeMeals: mealOverlap.analyzeMeals,
        analyzeMealAdaptivePeak: mealOverlap.analyzeMealAdaptivePeak,
        buildFoodComparisons: mealOverlap.buildFoodComparisons,
      };
    }
    return;
  }

  function loadScript(src, onload) {
    const script = document.createElement('script');
    script.src = src;
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

  loadScript('version.js', () =>
    loadScript('app-v3-core.js', () =>
      loadScript('app-importers.js', () =>
        loadScript('app-importers-context.js', () =>
          loadScript('app-ui-contract.js', () =>
            loadScript('app-meal-window.js', () =>
              loadScript('app-meal-overlap-fallback.js', () =>
                loadScript('app-insulin-action.js', () =>
                  loadScript('app-export-core.js', () =>
                    loadScript('app-zip-core.js', () =>
                      loadScript('app-zip64-compat.js', () =>
                        loadScript('app-export-ui.js', () =>
                          loadScript('app-insulin-summary-core.js', () =>
                            loadScript('app-insulin-summary-ui.js', () =>
                              loadScript('app-all-bolus-phases.js', () =>
                                loadScript('app-compact-lists.js', () =>
                                  loadScript('app-insulin-page-ui.js', () =>
                                    loadScript('app-meal-page-ui.js', () =>
                                      loadScript('app-version.js'),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
})();
