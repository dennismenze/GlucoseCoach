(function (root) {
  'use strict';

  const TWO_HOUR_MINUTES = 120;
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
  const GLOOKO_SOURCE = 'glooko';

  const nodeBase = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-meal-overlap-fallback.js')
    : null;
  const browserBase = typeof GlucoseCoachMealOverlapFallback !== 'undefined'
    ? GlucoseCoachMealOverlapFallback
    : (typeof GlucoseCoachV3 !== 'undefined' ? GlucoseCoachV3 : {});
  const baseApi = nodeBase || browserBase;
  const baseAnalyzeMeal = baseApi.analyzeMealAdaptivePeak || baseApi.analyzeMealTwoHourPeak;
  const baseAnalyzeMeals = baseApi.analyzeMeals;
  const baseBuildFoodComparisons = baseApi.buildFoodComparisons;

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function normalizeName(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  function normalizeKey(value) {
    return normalizeName(value).toLocaleLowerCase('de-DE');
  }

  function hasFinalPeak(analysis) {
    if (!analysis) return false;
    if (typeof analysis.peakComplete === 'boolean') return analysis.peakComplete;
    return Boolean(analysis.complete && finite(analysis.peak) !== null);
  }

  function normalizeOverlapAnalysis(analysis) {
    if (!analysis || typeof analysis !== 'object') return analysis;

    if (!analysis.truncatedByNextMealBolus) {
      const peakComplete = hasFinalPeak(analysis);
      return {
        ...analysis,
        peakComplete,
        comparisonEligible: peakComplete,
      };
    }

    const fallbackAvailable = analysis.twoHourFallback === true &&
      analysis.twoHourFallbackAvailable === true;
    const turnDetected = finite(analysis.turnMinute) !== null;
    const peakComplete = fallbackAvailable && turnDetected && finite(analysis.peak) !== null;

    if (!fallbackAvailable) {
      return {
        ...analysis,
        complete: false,
        peakComplete: false,
        comparisonEligible: false,
        turnCensoredByNextMealBolus: !turnDetected,
      };
    }

    if (peakComplete) {
      return {
        ...analysis,
        complete: true,
        peakComplete: true,
        comparisonEligible: true,
        turnCensoredByNextMealBolus: false,
      };
    }

    return {
      ...analysis,
      complete: true,
      peakComplete: false,
      comparisonEligible: false,
      status: 'complete-overlap-censored',
      turnCensoredByNextMealBolus: true,
      usableWindowMinutes: finite(analysis.nextMealBolusFromMeal),
    };
  }

  function analyzeMealManaged(entry, cgm, boluses, nextMealMinute = null) {
    if (typeof baseAnalyzeMeal !== 'function') {
      return { entry, complete: false, peakComplete: false, status: 'partial-analysis' };
    }
    return normalizeOverlapAnalysis(baseAnalyzeMeal(entry, cgm, boluses, nextMealMinute));
  }

  function analyzeMealsManaged(diary, cgm, boluses) {
    if (typeof baseAnalyzeMeals !== 'function') return [];
    return safeArray(baseAnalyzeMeals(diary, cgm, boluses)).map(normalizeOverlapAnalysis);
  }

  function comparisonAnalyses(analyses) {
    return safeArray(analyses).map((analysis) => ({
      ...analysis,
      complete: hasFinalPeak(analysis),
    }));
  }

  function buildFoodComparisonsManaged(analyses) {
    if (typeof baseBuildFoodComparisons !== 'function') return [];
    return baseBuildFoodComparisons(comparisonAnalyses(analyses));
  }

  function mergeMealEntries(entries, selectedIds, commonName) {
    const source = safeArray(entries);
    const canonicalName = normalizeName(commonName);
    const ids = new Set(safeArray(selectedIds).map((value) => String(value)));
    const eligible = source.filter((entry) =>
      ids.has(String(entry?.id ?? '')) &&
      MEAL_OCCASIONS.has(entry?.occasion) &&
      entry?.readOnly !== true &&
      entry?.source !== GLOOKO_SOURCE,
    );

    if (!canonicalName) {
      return {
        entries: source,
        selected: eligible.length,
        changed: 0,
        applied: false,
        reason: 'empty-name',
        name: canonicalName,
      };
    }
    if (eligible.length < 2) {
      return {
        entries: source,
        selected: eligible.length,
        changed: 0,
        applied: false,
        reason: 'select-at-least-two',
        name: canonicalName,
      };
    }

    let changed = 0;
    const updated = source.map((entry) => {
      if (!eligible.includes(entry)) return entry;
      if (normalizeName(entry.food) === canonicalName) return entry;
      changed += 1;
      return { ...entry, food: canonicalName };
    });

    return {
      entries: updated,
      selected: eligible.length,
      changed,
      applied: true,
      reason: null,
      name: canonicalName,
    };
  }

  function formatNumber(value, digits = 0) {
    return finite(value) === null
      ? '–'
      : new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value));
  }

  function censoredTurnText(analysis) {
    const cutoff = finite(analysis?.nextMealBolusFromMeal);
    const parts = ['kein stabiler Wendepunkt vor dem nächsten Mahlzeitenbolus erkannt'];
    if (cutoff !== null) parts.push(`nutzbares Fenster endete ${formatNumber(cutoff)} min nach Essen`);
    if (cutoff !== null && cutoff <= TWO_HOUR_MINUTES) {
      parts.push('2-h-Marke wurde nicht erreicht');
    }
    return parts.join(' · ');
  }

  function currentAnalyses() {
    if (typeof gcState === 'undefined') return [];
    return analyzeMealsManaged(
      gcState.diary || [],
      gcState.clinical?.cgm || [],
      gcState.clinical?.boluses || [],
    );
  }

  function updateCensoredOverlapCards() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined') return;
    const analyses = currentAnalyses().sort((a, b) => (b.minute || 0) - (a.minute || 0));
    const items = document.querySelectorAll('#meal-events .analysis-item');

    items.forEach((item, index) => {
      const analysis = analyses[index];
      if (!analysis?.turnCensoredByNextMealBolus || !analysis.twoHourFallbackAvailable) return;

      item.dataset.analysisStatus = 'complete-overlap-censored';
      const status = item.querySelector('.status');
      if (status) {
        status.className = 'status ok';
        status.textContent = 'vollständig · Fenster vor Wendepunkt beendet';
      }

      const cells = item.querySelectorAll('.analysis-grid > div');
      if (cells.length < 6) return;

      cells[2].querySelector('span').textContent = 'Endgültiger Peak';
      cells[2].querySelector('strong').textContent =
        'nicht endgültig bestimmbar · kein stabiler Wendepunkt vor Folgebolus';
      cells[3].querySelector('span').textContent = 'Ersatz für 2-h-Wert';
      cells[3].querySelector('strong').textContent =
        `${formatNumber(analysis.twoHour)} mg/dl · höchster Wert bis ` +
        `${formatNumber(analysis.nextMealBolusFromMeal)} min nach Essen`;
      cells[5].querySelector('span').textContent = 'CGM-Wendepunkt-Proxy (nutzbares Fenster)';
      cells[5].querySelector('strong').textContent = censoredTurnText(analysis);
    });
  }

  function updateMealMeanHeaders(analyses) {
    if (typeof document === 'undefined') return;
    const counts = new Map();
    for (const analysis of safeArray(analyses)) {
      const key = normalizeKey(analysis?.entry?.food);
      if (!key) continue;
      if (!counts.has(key)) counts.set(key, { all: 0, finalPeak: 0 });
      const count = counts.get(key);
      count.all += 1;
      if (hasFinalPeak(analysis)) count.finalPeak += 1;
    }

    for (const card of document.querySelectorAll('#food-comparison-means [data-food-key]')) {
      const count = counts.get(card.dataset.foodKey);
      const text = card.querySelector('.meal-comparison-mean-head small');
      if (!count || !text || count.finalPeak === count.all) continue;
      text.textContent =
        `${count.finalPeak} von ${count.all} Einträgen mit endgültigem Peak; ` +
        'Teilmetriken verwenden ihr eigenes n';
    }
  }

  function ensureStyles() {
    if (typeof document === 'undefined' || document.querySelector('#meal-management-styles')) return;
    const style = document.createElement('style');
    style.id = 'meal-management-styles';
    style.textContent = `
      .meal-merge-controls {
        margin:0 0 14px;
        padding:13px;
        border:1px solid var(--line);
        border-radius:12px;
        background:var(--surface-strong);
      }
      .meal-merge-controls h3 { margin:0; font-size:1rem; }
      .meal-merge-controls p { margin:7px 0 10px; }
      .meal-merge-controls label.meal-merge-name { display:block; }
      .meal-merge-controls input[type="text"] { width:100%; margin-top:5px; }
      .meal-merge-controls .actions { margin-top:10px; }
      .meal-merge-status { min-height:1.25em; margin-top:8px; }
      .meal-merge-choice {
        display:inline-flex;
        align-items:center;
        gap:6px;
        margin-right:10px;
        font-size:.76rem;
        font-weight:700;
        color:var(--muted);
      }
      .meal-merge-choice input { margin:0; }
      details.entry > summary.entry-head { align-items:center; }
    `;
    document.head.appendChild(style);
  }

  function editableLocalMeals() {
    if (typeof gcState === 'undefined') return [];
    return safeArray(gcState.diary).filter((entry) =>
      MEAL_OCCASIONS.has(entry?.occasion) &&
      entry?.readOnly !== true &&
      entry?.source !== GLOOKO_SOURCE &&
      String(entry?.id ?? '').trim(),
    );
  }

  function ensureMergeControls() {
    const aside = document.querySelector('#diary article.card.side');
    const anchor = document.querySelector('#diary-entries-disclosure') ||
      document.querySelector('#entries');
    if (!aside || !anchor) return null;

    let controls = document.querySelector('#meal-merge-controls');
    if (!controls) {
      controls = document.createElement('section');
      controls.id = 'meal-merge-controls';
      controls.className = 'meal-merge-controls';
      controls.innerHTML =
        '<h3>Vergleichbare Mahlzeiten zusammenlegen</h3>' +
        '<p class="muted">Mindestens zwei lokale Mahlzeiten markieren und einen gemeinsamen ' +
        'Namen vergeben. Alle bisherigen Messwerte bleiben erhalten und werden neu gruppiert.</p>' +
        '<label class="meal-merge-name">Gemeinsamer Name' +
        '<input id="meal-merge-name" type="text" list="meal-merge-name-options" ' +
        'placeholder="z. B. Müsli mit Banane und Himbeeren"></label>' +
        '<datalist id="meal-merge-name-options"></datalist>' +
        '<div class="actions"><button id="merge-selected-meals" class="secondary" ' +
        'type="button" disabled>Markierte Mahlzeiten zusammenlegen</button></div>' +
        '<div id="meal-merge-status" class="meal-merge-status muted" role="status" ' +
        'aria-live="polite"></div>';
      aside.insertBefore(controls, anchor);
    }
    return controls;
  }

  function renderMealMergeControls() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined') return;
    ensureStyles();
    const meals = editableLocalMeals();
    const controls = ensureMergeControls();
    if (!controls) return;
    controls.hidden = meals.length < 2;

    const options = controls.querySelector('#meal-merge-name-options');
    if (options) {
      options.replaceChildren();
      const names = [...new Set(meals.map((entry) => normalizeName(entry.food)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'de-DE'));
      for (const name of names) {
        const option = document.createElement('option');
        option.value = name;
        options.appendChild(option);
      }
    }

    const byId = new Map(meals.map((entry) => [String(entry.id), entry]));
    for (const item of document.querySelectorAll('#entries .entry')) {
      const button = item.querySelector('.remove-entry[data-id]');
      const id = String(button?.dataset.id ?? '');
      const entry = byId.get(id);
      if (!entry) continue;
      const head = item.querySelector('.entry-head');
      if (!head || head.querySelector('.meal-merge-choice')) continue;

      const choice = document.createElement('label');
      choice.className = 'meal-merge-choice';
      choice.title = `„${normalizeName(entry.food) || entry.occasion}“ zum Zusammenlegen markieren`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'meal-merge-checkbox';
      checkbox.dataset.mealId = id;
      checkbox.setAttribute('aria-label', choice.title);
      const caption = document.createElement('span');
      caption.textContent = 'zusammenlegen';
      choice.append(checkbox, caption);
      choice.addEventListener('click', (event) => event.stopPropagation());
      head.prepend(choice);
    }

    const nameInput = controls.querySelector('#meal-merge-name');
    const mergeButton = controls.querySelector('#merge-selected-meals');
    const status = controls.querySelector('#meal-merge-status');
    const checkboxes = [...document.querySelectorAll('#entries .meal-merge-checkbox')];
    const selectedIds = () => checkboxes.filter((item) => item.checked).map((item) => item.dataset.mealId);
    const syncButton = () => {
      if (mergeButton) {
        mergeButton.disabled = selectedIds().length < 2 || !normalizeName(nameInput?.value);
      }
    };

    for (const checkbox of checkboxes) checkbox.addEventListener('change', syncButton);
    if (nameInput) nameInput.addEventListener('input', syncButton);
    syncButton();

    if (status) {
      status.textContent = root?.__glucoseCoachMealMergeMessage || '';
      if (root) delete root.__glucoseCoachMealMergeMessage;
    }

    if (mergeButton) {
      mergeButton.onclick = () => {
        const result = mergeMealEntries(gcState.diary, selectedIds(), nameInput?.value);
        if (!result.applied) {
          if (status) {
            status.textContent = result.reason === 'empty-name'
              ? 'Bitte einen gemeinsamen Namen eingeben.'
              : 'Bitte mindestens zwei lokale Mahlzeiten markieren.';
          }
          return;
        }

        if (root) {
          root.__glucoseCoachMealMergeMessage = result.changed
            ? `${result.selected} Mahlzeiten als „${result.name}“ zusammengelegt und neu berechnet.`
            : `Die ${result.selected} markierten Mahlzeiten verwenden bereits „${result.name}“.`;
        }
        gcState.diary = result.entries;
        if (typeof gcSave === 'function') gcSave();
        if (typeof gcRender === 'function') gcRender();
      };
    }
  }

  function installBrowserPatch() {
    if (
      typeof document === 'undefined' ||
      typeof gcRender !== 'function' ||
      typeof gcState === 'undefined' ||
      root?.__glucoseCoachMealManagementInstalled
    ) return;
    if (root) root.__glucoseCoachMealManagementInstalled = true;

    if (typeof analyzeMeals !== 'undefined') analyzeMeals = analyzeMealsManaged;
    if (typeof buildFoodComparisons !== 'undefined') {
      buildFoodComparisons = buildFoodComparisonsManaged;
    }

    const previousIllnessComparison = typeof illnessComparison === 'function'
      ? illnessComparison
      : null;
    if (previousIllnessComparison) {
      illnessComparison = function managedIllnessComparison(analyses) {
        return previousIllnessComparison(comparisonAnalyses(analyses));
      };
    }

    if (typeof GlucoseCoachV3 !== 'undefined') {
      Object.assign(GlucoseCoachV3, {
        analyzeMealAdaptivePeak: analyzeMealManaged,
        analyzeMealTwoHourPeak: analyzeMealManaged,
        analyzeMeals: analyzeMealsManaged,
        buildFoodComparisons: buildFoodComparisonsManaged,
        mergeMealEntries,
        normalizeOverlapAnalysis,
      });
      if (previousIllnessComparison) GlucoseCoachV3.illnessComparison = illnessComparison;
    }

    const previousMeals = typeof gcMeals === 'function' ? gcMeals : null;
    if (previousMeals) {
      gcMeals = function managedMealsView() {
        previousMeals();
        updateCensoredOverlapCards();
      };
    }

    const previousRender = gcRender;
    gcRender = function renderWithMealManagement() {
      previousRender();
      const analyses = currentAnalyses();
      updateMealMeanHeaders(analyses);
      renderMealMergeControls();
    };

    gcRender();
  }

  const api = {
    ...baseApi,
    analyzeMealAdaptivePeak: analyzeMealManaged,
    analyzeMealTwoHourPeak: analyzeMealManaged,
    analyzeMeals: analyzeMealsManaged,
    buildFoodComparisons: buildFoodComparisonsManaged,
    mergeMealEntries,
    normalizeOverlapAnalysis,
    comparisonAnalyses,
    censoredTurnText,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachMealManagement = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
