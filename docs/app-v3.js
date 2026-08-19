(function () {
  'use strict';

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      const mealWindow = require('./app-meal-window.js');
      const insulinAction = require('./app-insulin-action.js');
      module.exports = {
        ...require('./app-v3-core.js'),
        ...require('./app-importers.js'),
        ...require('./app-importers-context.js'),
        ...require('./app-ui-contract.js'),
        ...mealWindow,
        ...insulinAction,
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
          loadScript('app-meal-window.js', () => loadScript('app-insulin-action.js')),
        ),
      ),
    ),
  );
})();
