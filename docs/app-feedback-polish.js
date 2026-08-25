(function (root) {
  'use strict';

  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
  const HIGH_CAUSES =
    'Mögliche Mitursachen sind eine späte oder verzögerte Mahlzeitenwirkung, Krankheit oder ' +
    'Stress, hormonelle Gegenregulation – etwa durch Wachstumshormon – oder eine in diesem ' +
    'Zeitfenster nicht ausreichende Insulinwirkung. Aus dem Stundenmuster allein lässt sich ' +
    'die Ursache nicht unterscheiden.';
  const LOW_CAUSES =
    'Mögliche Mitursachen sind noch wirksames Insulin, Aktivität, verzögert aufgenommene oder ' +
    'nicht erfasste Kohlenhydrate, Krankheitserholung oder eine Sensorabweichung. Aus dem ' +
    'Stundenmuster allein lässt sich die Ursache nicht unterscheiden.';

  function definitionTerm(card, label) {
    return [...card.querySelectorAll('dt')]
      .find((candidate) => candidate.textContent.trim() === label) || null;
  }

  function splitFindingAndCauses(card, causes) {
    const findingTerm = definitionTerm(card, 'Befund');
    const finding = findingTerm?.nextElementSibling;
    if (!finding) return;

    const marker = ' Mögliche Mitursachen sind';
    const markerIndex = finding.textContent.indexOf(marker);
    if (markerIndex >= 0) finding.textContent = finding.textContent.slice(0, markerIndex).trim();
    delete finding.dataset.feedbackCause;

    let causeTerm = definitionTerm(card, 'Mögliche Ursachen');
    let causeText = causeTerm?.nextElementSibling || null;
    if (!causeTerm) {
      causeTerm = document.createElement('dt');
      causeTerm.textContent = 'Mögliche Ursachen';
      causeText = document.createElement('dd');
      finding.insertAdjacentElement('afterend', causeTerm);
      causeTerm.insertAdjacentElement('afterend', causeText);
    }
    causeText.textContent = causes;
  }

  function clarifyRecommendations() {
    for (const card of document.querySelectorAll('#recommendation-list .rec')) {
      const title = card.querySelector('h2')?.textContent.trim() || '';
      if (title.startsWith('Höherer Hochanteil')) splitFindingAndCauses(card, HIGH_CAUSES);
      if (title.startsWith('Höherer Niedriganteil')) splitFindingAndCauses(card, LOW_CAUSES);
    }
  }

  function clarifyMealMethod() {
    const intro = document.querySelector('#meal-method-explanation p.muted') ||
      document.querySelector('#meal-analysis article.card.full > p.muted');
    if (!intro) return;
    intro.textContent =
      'Die Auswertung ist nicht mehr auf zwei Stunden begrenzt. Bis zu fünf Stunden nach dem ' +
      'Essen wird nach dem Peak-Ende gesucht. Ein mahlzeitennaher positiver Bolus mit positiver ' +
      'Kohlenhydratangabe dient als Bezug; ein positiver Bolus ohne Kohlenhydratangabe gilt ' +
      'immer als Korrekturbolus. Spätere mögliche Korrekturboli werden als Korrekturboli ' +
      'behandelt und starten den Peak nicht neu. Der Peak endet erst vor einem stabil ' +
      'bestätigten Rückgang: Eine 20 Minuten Hysterese verlangt mehrere aufeinanderfolgende ' +
      'CGM-Werte, die insgesamt mindestens 8 mg/dl fallen. Das beschreibt die Kurvenform und ' +
      'nicht den pharmakologischen Wirkeintritt des Insulins.';
  }

  function addLegacyTurnAliases() {
    for (const cell of document.querySelectorAll('#meal-events .analysis-grid > div')) {
      const label = cell.querySelector(':scope > span');
      if (!label || label.textContent.trim() !== 'Stabil bestätigter Rückgang') continue;
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

  function protectFirstEmptyAssignment(input) {
    if (!input) return () => {};
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.get || !descriptor?.set) return () => {};
    let ignored = false;
    Object.defineProperty(input, 'value', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (!ignored && value === '') {
          ignored = true;
          return;
        }
        descriptor.set.call(this, value);
      },
    });
    return () => {
      delete input.value;
    };
  }

  function preserveLegacyMealContext() {
    const form = document.querySelector('#diary-form');
    if (!form || form.dataset.feedbackLegacyContext === 'true') return;
    const previousSubmit = form.onsubmit;
    if (typeof previousSubmit !== 'function') return;
    form.dataset.feedbackLegacyContext = 'true';
    form.onsubmit = function submitWithLegacyMealContext(event) {
      const type = document.querySelector('#entry-type')?.value;
      const occasion = document.querySelector('#occasion')?.value;
      if (type !== 'meal' || !MEAL_OCCASIONS.has(occasion)) {
        return previousSubmit.call(this, event);
      }
      const restoreActivity = protectFirstEmptyAssignment(document.querySelector('#activity'));
      const restoreSleep = protectFirstEmptyAssignment(document.querySelector('#sleep'));
      try {
        return previousSubmit.call(this, event);
      } finally {
        restoreActivity();
        restoreSleep();
      }
    };
  }

  function ensureStyles() {
    if (document.querySelector('#feedback-polish-styles')) return;
    const style = document.createElement('style');
    style.id = 'feedback-polish-styles';
    style.textContent = `
      .feedback-legacy-turn-label {
        position:absolute !important;
        width:1px !important;
        height:1px !important;
        padding:0 !important;
        margin:-1px !important;
        overflow:hidden !important;
        clip:rect(0,0,0,0) !important;
        white-space:nowrap !important;
        border:0 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function applyPolish() {
    ensureStyles();
    clarifyRecommendations();
    clarifyMealMethod();
    addLegacyTurnAliases();
    preserveLegacyMealContext();
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    if (root?.__glucoseCoachFeedbackPolishInstalled) {
      applyPolish();
      return;
    }
    if (root) root.__glucoseCoachFeedbackPolishInstalled = true;
    const previousRender = gcRender;
    gcRender = function renderWithFeedbackPolish() {
      previousRender();
      applyPolish();
    };
    applyPolish();
  }

  const api = { clarifyRecommendations, clarifyMealMethod };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachFeedbackPolish = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
