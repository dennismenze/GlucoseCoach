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

  function ensureLegacyBindStubs() {
    if (document.querySelector('#legacy-json-bind-stubs')) return;
    const container = document.createElement('div');
    container.id = 'legacy-json-bind-stubs';
    container.hidden = true;
    container.setAttribute('aria-hidden', 'true');
    container.innerHTML = `
      <button type="button" id="export-diary"></button>
      <input type="file" id="import-diary">
      <input type="file" id="import-all">`;
    document.body.appendChild(container);
  }

  function removeLegacyBindStubs() {
    document.querySelector('#legacy-json-bind-stubs')?.remove();
  }

  ensureLegacyBindStubs();
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
                      loadScript('app-meal-list-ui.js', removeLegacyBindStubs),
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
