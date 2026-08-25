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
      const importers = require('./app-importers-context.js');
      const exportCore = require('./app-export-core.js');
      const zipExchange = require('./app-zip64-compat.js');
      const insulinSummaryCore = require('./app-insulin-summary-core.js');
      const glookoMode = require('./app-glooko-mode.js');
      const feedbackUi = require('./app-feedback-ui.js');
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
        ...glookoMode,
        ...feedbackUi,
        parseClinicalCsv: importers.parseClinicalCsv,
        mergeClinical: importers.mergeClinical,
        normalizeClinical: importers.normalizeClinical,
        analyzeMeals: mealBoundary.analyzeMeals,
        analyzeMealAdaptivePeak: mealBoundary.analyzeMealAdaptivePeak,
        buildFoodComparisons: mealBoundary.buildFoodComparisons,
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
                                      loadScript('app-meal-management.js', () =>
                                        loadScript('app-meal-boundary.js', () =>
                                          loadScript('app-glooko-mode.js', () =>
                                            loadScript('app-feedback-ui.js', () =>
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
          ),
        ),
      ),
    ),
  );
})();
