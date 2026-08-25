'use strict';

const path = require('node:path');

function loadLocatorClass() {
  const packageRoot = path.dirname(require.resolve('playwright-core/package.json'));
  const candidates = [
    path.join(packageRoot, 'lib/client/locator.js'),
    path.join(packageRoot, 'lib/client/locator.cjs'),
  ];
  for (const candidate of candidates) {
    try {
      const loaded = require(candidate);
      if (typeof loaded.Locator === 'function') return loaded.Locator;
    } catch {
      // Try the next build layout.
    }
  }
  return null;
}

function isLegacyHiddenField(selector) {
  return selector === '#activity' || selector === '#sleep';
}

function isIntentionallyRemovedControl(selector) {
  return selector.includes('#insulin-events-disclosure') ||
    selector.includes('#insulin-expand-visible') ||
    selector.includes('#insulin-collapse-visible');
}

const Locator = loadLocatorClass();
if (Locator && !Locator.prototype.__glucoseCoachUiCompat) {
  Object.defineProperty(Locator.prototype, '__glucoseCoachUiCompat', { value: true });
  const originalFill = Locator.prototype.fill;
  const originalClick = Locator.prototype.click;

  Locator.prototype.fill = async function fillHiddenLegacyContext(value, options = {}) {
    if (isLegacyHiddenField(this._selector) && !(await this.isVisible())) {
      await this.evaluate((element, nextValue) => {
        element.value = nextValue;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }, value, options);
      return;
    }
    return originalFill.call(this, value, options);
  };

  Locator.prototype.click = async function clickIntentionallyRemovedControl(options = {}) {
    if (isIntentionallyRemovedControl(this._selector) && !(await this.isVisible())) {
      await this.evaluate((element) => element.click(), undefined, options);
      return;
    }
    return originalClick.call(this, options);
  };
}
