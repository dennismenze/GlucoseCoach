(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const MATCH_MINUTES = 10;
  const isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const carbApi = isNode
    ? require('./app-carb-only-meals.js')
    : root?.GlucoseCoachCarbOnlyMeals;
  const boundaryApi = isNode
    ? require('./app-meal-boundary.js')
    : root?.GlucoseCoachMealBoundary;

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function parseTime(value) {
    const source = String(value ?? '').trim();
    if (!source) return null;
    const german = source.match(
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
    );
    if (german) {
      const date = new Date(
        Number(german[3]),
        Number(german[2]) - 1,
        Number(german[1]),
        Number(german[4]),
        Number(german[5]),
        Number(german[6] || 0),
      );
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
    }
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
  }

  function baseAnalyzeMeal(entry, cgm, boluses, nextMealMinute) {
    const analyze = boundaryApi?.analyzeMealAdaptivePeak || boundaryApi?.analyzeMealTwoHourPeak;
    return typeof analyze === 'function'
      ? analyze(entry, cgm, boluses, nextMealMinute)
      : { entry, minute: parseTime(entry?.when), complete: false, peakComplete: false, status: 'partial-analysis' };
  }

  function augmentedEntry(entry, boluses) {
    if (typeof carbApi?.augmentMealDiary !== 'function') return entry;
    const candidates = carbApi.augmentMealDiary([entry], boluses);
    const id = String(entry?.id ?? '');
    const byId = id
      ? candidates.find((candidate) => String(candidate?.id ?? '') === id)
      : null;
    if (byId) return byId;
    const minute = parseTime(entry?.when);
    if (minute === null) return null;
    return candidates.find((candidate) => {
      const candidateMinute = parseTime(candidate?.when);
      return candidateMinute !== null && Math.abs(candidateMinute - minute) <= MATCH_MINUTES;
    }) || null;
  }

  function analyzeMealPreservingInternalResult(entry, cgm, boluses, nextMealMinute = null) {
    const augmented = augmentedEntry(entry, boluses);
    if (!augmented || !(finite(augmented?.carbs) > 0)) {
      return {
        ...baseAnalyzeMeal(entry, cgm, boluses, nextMealMinute),
        complete: false,
        peakComplete: false,
        comparisonEligible: false,
        eligibleForMealAnalysis: false,
        usableForMealAnalysis: false,
        status: 'missing-carbs',
      };
    }
    const analysis = baseAnalyzeMeal(augmented, cgm, boluses, nextMealMinute);
    return typeof carbApi?.enhanceAnalysis === 'function'
      ? carbApi.enhanceAnalysis(analysis, cgm, boluses)
      : analysis;
  }

  function currentDiary() {
    if (typeof gcState === 'undefined') return [];
    const local = safeArray(gcState.diary);
    const clinical = gcState.clinical && typeof gcState.clinical === 'object'
      ? gcState.clinical
      : {};
    const mode = root?.GlucoseCoachGlookoMode;
    return typeof mode?.buildAnalysisDiary === 'function'
      ? mode.buildAnalysisDiary(local, clinical)
      : local;
  }

  function currentUsableAnalyses() {
    if (typeof gcState === 'undefined' || typeof carbApi?.analyzeMeals !== 'function') return [];
    return safeArray(carbApi.analyzeMeals(
      currentDiary(),
      gcState.clinical?.cgm || [],
      gcState.clinical?.boluses || [],
    )).sort((a, b) => Number(b?.minute || 0) - Number(a?.minute || 0));
  }

  function compactMealCards() {
    const target = document.querySelector('#meal-events');
    if (!target) return;
    for (const item of [...target.querySelectorAll(':scope > .analysis-item')]) {
      if (item.tagName === 'DETAILS') continue;
      const details = document.createElement('details');
      details.className = item.className;
      for (const attribute of item.attributes) {
        if (attribute.name !== 'class') details.setAttribute(attribute.name, attribute.value);
      }
      const head = item.querySelector(':scope > .analysis-head');
      if (head) {
        const summary = document.createElement('summary');
        summary.className = head.className;
        while (head.firstChild) summary.appendChild(head.firstChild);
        details.appendChild(summary);
      }
      for (const child of [...item.children]) {
        if (child !== head) details.appendChild(child);
      }
      item.replaceWith(details);
    }
  }

  function formatNumber(value, digits = 0) {
    const numeric = finite(value);
    return numeric === null
      ? '–'
      : new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(numeric);
  }

  function formatMg(value) {
    return finite(value) === null ? '–' : `${formatNumber(value)} mg/dl`;
  }

  function formatMinutes(value) {
    return finite(value) === null ? '–' : `${formatNumber(value)} min`;
  }

  function carbOnlyPeakText(analysis) {
    return `${formatNumber(analysis.peak)} mg/dl · ${formatNumber(analysis.minutesToPeak)} min nach Essen`;
  }

  function carbOnlyBolusText(analysis) {
    const correctionCount = finite(analysis.correctionBolusCountBeforeTurn) ??
      finite(analysis.ignoredBolusCountBeforeTurn) ?? 0;
    const correctionText = correctionCount === 1
      ? ' · 1 Korrekturbolus ohne KH-Angabe im Verlauf'
      : correctionCount > 1
        ? ` · ${formatNumber(correctionCount)} Korrekturboli ohne KH-Angabe im Verlauf`
        : '';
    return `kein Insulin zur Mahlzeit abgegeben · ${formatNumber(analysis.entry?.carbs, 1)} g KH erfasst${correctionText}`;
  }

  function decorateCarbOnlyCards(analyses) {
    const items = [...document.querySelectorAll('#meal-events > .analysis-item')];
    items.forEach((item, index) => {
      const analysis = analyses[index];
      if (!analysis?.withoutMealInsulin) return;
      item.dataset.analysisStatus = analysis.status || 'complete-without-meal-insulin';
      const status = item.querySelector('.status');
      if (status) {
        status.className = 'status ok';
        status.textContent = finite(analysis.twoHour) === null
          ? 'vollständig · ohne Mahlzeiteninsulin · 2-h-Wert fehlt'
          : 'vollständig · ohne Mahlzeiteninsulin';
      }
      const cells = item.querySelectorAll('.analysis-grid > div');
      if (cells.length < 6) return;
      cells[0].querySelector('span').textContent = 'Ausgangswert';
      cells[0].querySelector('strong').textContent = formatMg(analysis.baseline);
      cells[1].querySelector('span').textContent = 'erster nachhaltiger Anstieg';
      cells[1].querySelector('strong').textContent = formatMinutes(analysis.minutesToRise);
      cells[2].querySelector('span').textContent = 'Peak nach Essen';
      cells[2].querySelector('strong').textContent = carbOnlyPeakText(analysis);
      cells[3].querySelector('span').textContent = '2-h-Wert';
      cells[3].querySelector('strong').textContent = formatMg(analysis.twoHour);
      cells[4].querySelector('span').textContent = 'maßgeblicher Mahlzeitenbolus';
      cells[4].querySelector('strong').textContent = carbOnlyBolusText(analysis);
      cells[5].querySelector('span').textContent = 'Stabil bestätigter Rückgang';
      cells[5].querySelector('strong').textContent = `${formatNumber(analysis.turnFromMeal)} min nach Essen`;
    });
  }

  function renderComparisons(analyses) {
    const target = document.querySelector('#food-comparison');
    if (!target || typeof carbApi?.buildFoodComparisons !== 'function') return;
    const groups = safeArray(carbApi.buildFoodComparisons(analyses))
      .filter((group) => Number(group?.analyzed || 0) > 0);
    const columns = target.closest('table')?.querySelectorAll('thead th').length || 7;
    target.innerHTML = groups.length
      ? groups.map((group) => {
        const cells = [
          group.label,
          String(group.entries),
          String(group.analyzed),
          formatMg(group.medianPeakDelta),
          formatMinutes(group.medianMinutesToPeak),
        ];
        if (columns >= 7) cells.push(formatMinutes(group.medianMinutesBolusToPeak));
        cells.push(formatMg(group.medianTwoHourDelta));
        const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[character]));
        return `<tr>${cells.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`;
      }).join('')
      : `<tr><td colspan="${columns}">Noch keine Mahlzeit ist mindestens zweimal vollständig auswertbar.</td></tr>`;
  }

  function updateDisclosure(analyses) {
    const target = document.querySelector('#meal-events');
    const disclosure = document.querySelector('#meal-events-disclosure');
    const summary = document.querySelector('#meal-events-summary');
    if (!target) return;
    if (!analyses.length) {
      target.innerHTML = '<div class="empty-state">Keine Mahlzeit mit positiven Kohlenhydraten und vollständig auswertbarem CGM-Verlauf.</div>';
      if (summary) summary.textContent = 'Keine auswertbaren Mahlzeiten';
      if (disclosure) disclosure.open = true;
      return;
    }
    compactMealCards();
    if (summary) {
      summary.textContent = `${analyses.length} ${analyses.length === 1 ? 'Mahlzeiteneintrag' : 'Mahlzeiteneinträge'} anzeigen`;
    }
    if (disclosure?.dataset.empty === 'true') {
      disclosure.open = false;
      delete disclosure.dataset.empty;
    }
  }

  function refreshMealMeans(analyses) {
    if (typeof gcState === 'undefined' || typeof root?.GlucoseCoachMealPageUi?.applyLayout !== 'function') return;
    const previousDiary = gcState.diary;
    gcState.diary = analyses.map((analysis) => analysis.entry);
    try {
      root.GlucoseCoachMealPageUi.applyLayout();
    } finally {
      gcState.diary = previousDiary;
    }
    for (const value of document.querySelectorAll('#food-comparison-means .meal-comparison-mean-grid strong')) {
      value.textContent = value.textContent.replace(/ · n=\d+$/, '');
    }
  }

  function updateMethodText() {
    const intro = document.querySelector('#meal-method-explanation p.muted') ||
      document.querySelector('#meal-analysis article.card.full > p.muted');
    if (!intro) return;
    intro.textContent = 'Berücksichtigt werden nur Mahlzeiten mit einer positiven Kohlenhydratangabe und ' +
      'einem vollständig auswertbaren CGM-Verlauf bis zu einem über 20 Minuten und mindestens 8 mg/dl ' +
      'stabil bestätigten Rückgang. Wurde zu den Kohlenhydraten kein Insulin abgegeben, beginnt das ' +
      'Peakfenster beim Essensbeginn. Ein positiver Insulineintrag ohne positive KH-Angabe bleibt immer ' +
      'ein Korrekturbolus und wird nie als Mahlzeitenbolus verwendet. Das beschreibt die beobachtete ' +
      'Kurve und nicht den pharmakologischen Wirkeintritt des Insulins. Nicht auswertbare Mahlzeiten ' +
      'werden in dieser Ansicht nicht angezeigt.';
  }

  function rerenderMealPanel(analyses) {
    if (typeof gcState === 'undefined' || typeof gcMeals !== 'function') return;
    const previousDiary = gcState.diary;
    gcState.diary = analyses.map((analysis) => analysis.entry);
    try {
      gcMeals();
    } finally {
      gcState.diary = previousDiary;
    }
    updateDisclosure(analyses);
    decorateCarbOnlyCards(analyses);
    renderComparisons(analyses);
    refreshMealMeans(analyses);
    updateMethodText();
  }

  function installBrowserPatch() {
    if (
      isNode ||
      typeof document === 'undefined' ||
      typeof gcRender !== 'function' ||
      !carbApi ||
      root?.__glucoseCoachCarbOnlyMealsCompatInstalled
    ) return;
    root.__glucoseCoachCarbOnlyMealsCompatInstalled = true;

    if (typeof GlucoseCoachV3 !== 'undefined') {
      GlucoseCoachV3.analyzeMealAdaptivePeak = analyzeMealPreservingInternalResult;
      GlucoseCoachV3.analyzeMealTwoHourPeak = analyzeMealPreservingInternalResult;
    }
    carbApi.analyzeMealAdaptivePeak = analyzeMealPreservingInternalResult;
    carbApi.analyzeMealTwoHourPeak = analyzeMealPreservingInternalResult;

    const previousRender = gcRender;
    gcRender = function renderWithCarbOnlyCompatibility() {
      previousRender();
      rerenderMealPanel(currentUsableAnalyses());
    };
    gcRender();
  }

  const api = {
    analyzeMealAdaptivePeak: analyzeMealPreservingInternalResult,
    analyzeMealTwoHourPeak: analyzeMealPreservingInternalResult,
    analyzeMeals: carbApi?.analyzeMeals,
    buildFoodComparisons: carbApi?.buildFoodComparisons,
    buildRecommendations: carbApi?.buildRecommendations,
    rerenderMealPanel,
  };

  if (isNode) module.exports = api;
  if (root) root.GlucoseCoachCarbOnlyMealsCompat = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
