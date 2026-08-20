(function () {
  'use strict';

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      const mealWindow = require('./app-meal-window.js');
      const insulinAction = require('./app-insulin-action.js');
      const exportCore = require('./app-export-core.js');
      const insulinSummaryCore = require('./app-insulin-summary-core.js');
      module.exports = {
        ...require('./app-v3-core.js'),
        ...require('./app-importers.js'),
        ...require('./app-importers-context.js'),
        ...require('./app-ui-contract.js'),
        ...mealWindow,
        ...insulinAction,
        ...exportCore,
        ...insulinSummaryCore,
      };
    }
    return;
  }

  const cleanupStyle = document.createElement('style');
  cleanupStyle.id = 'legacy-json-control-hider';
  cleanupStyle.textContent = `
    #export-diary,
    label:has(#import-diary),
    label:has(#import-all) { display: none !important; }
  `;
  document.head.appendChild(cleanupStyle);

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
              loadScript('app-insulin-action.js', () =>
                loadScript('app-export-core.js', () =>
                  loadScript('app-export-ui.js', () =>
                    loadScript('app-insulin-summary-core.js', () =>
                      loadScript('app-insulin-summary-ui.js', () =>
                        loadScript('app-compact-lists.js', () =>
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
  );
})();
