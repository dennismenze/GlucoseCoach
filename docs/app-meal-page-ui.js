(function (root) {
  'use strict';

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function mean(values) {
    const valid = values.map(finite).filter(Number.isFinite);
    return valid.length
      ? valid.reduce((sum, value) => sum + value, 0) / valid.length
      : null;
  }

  function normalizeLabel(value) {
    return String(value ?? '').trim().toLocaleLowerCase('de-DE');
  }

  function completeFor(analyses, fields) {
    return analyses.filter(
      (analysis) => analysis?.complete && fields.every((field) => finite(analysis[field]) !== null),
    );
  }

  function calculateMealMeanGroups(analyses = []) {
    const groups = new Map();
    for (const analysis of analyses || []) {
      const label = String(analysis?.entry?.food ?? '').trim();
      const key = normalizeLabel(label);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { key, label, all: [], complete: [] });
      const group = groups.get(key);
      group.all.push(analysis);
      if (analysis?.complete) group.complete.push(analysis);
    }

    return [...groups.values()]
      .filter((group) => group.all.length >= 2)
      .map((group) => {
        const rise = completeFor(group.complete, ['minutesToRise']);
        const peak = completeFor(
          group.complete,
          ['peak', 'peakFromBolus', 'minutesToPeak'],
        );
        const turn = completeFor(
          group.complete,
          ['turnFromBolus', 'turnFromMeal'],
        );
        return {
          key: group.key,
          label: group.label,
          entries: group.all.length,
          analyzed: group.complete.length,
          rise: {
            n: rise.length,
            fromMeal: mean(rise.map((analysis) => analysis.minutesToRise)),
          },
          peak: {
            n: peak.length,
            value: mean(peak.map((analysis) => analysis.peak)),
            fromBolus: mean(peak.map((analysis) => analysis.peakFromBolus)),
            fromMeal: mean(peak.map((analysis) => analysis.minutesToPeak)),
          },
          turn: {
            n: turn.length,
            fromBolus: mean(turn.map((analysis) => analysis.turnFromBolus)),
            fromMeal: mean(turn.map((analysis) => analysis.turnFromMeal)),
          },
        };
      });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function formatNumber(value, digits = 1) {
    return Number.isFinite(value)
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(value)
      : '–';
  }

  function formatRise(item) {
    if (!item?.n || !Number.isFinite(item.fromMeal)) return 'nicht bestimmbar · n=0';
    return `Ø ${formatNumber(item.fromMeal)} min nach Essen · n=${item.n}`;
  }

  function formatPeak(item) {
    if (
      !item?.n ||
      !Number.isFinite(item.value) ||
      !Number.isFinite(item.fromBolus) ||
      !Number.isFinite(item.fromMeal)
    ) return 'nicht bestimmbar · n=0';
    return `Ø ${formatNumber(item.value)} mg/dl · ` +
      `${formatNumber(item.fromBolus)} min nach Mahlzeitenbolus · ` +
      `${formatNumber(item.fromMeal)} min nach Essen · n=${item.n}`;
  }

  function formatTurn(item) {
    if (
      !item?.n ||
      !Number.isFinite(item.fromBolus) ||
      !Number.isFinite(item.fromMeal)
    ) return 'nicht bestimmbar · n=0';
    return `Ø ${formatNumber(item.fromBolus)} min nach Mahlzeitenbolus · ` +
      `${formatNumber(item.fromMeal)} min nach Essen · n=${item.n}`;
  }

  function ensureStyles() {
    if (document.querySelector('#meal-page-ui-styles')) return;
    const style = document.createElement('style');
    style.id = 'meal-page-ui-styles';
    style.textContent = `
      .meal-comparison-means { display:grid; gap:10px; margin-top:16px; }
      .meal-comparison-means > h3 { margin:0 0 2px; }
      .meal-comparison-mean-card {
        border:1px solid var(--line);
        border-radius:14px;
        padding:13px;
        background:rgba(255,255,255,.35);
      }
      .meal-comparison-mean-head {
        display:flex;
        flex-wrap:wrap;
        justify-content:space-between;
        gap:8px 14px;
        align-items:baseline;
      }
      .meal-comparison-mean-head small { color:var(--muted); }
      .meal-comparison-mean-grid {
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:9px;
        margin-top:10px;
      }
      .meal-comparison-mean-grid > div {
        min-width:0;
        border:1px solid var(--line);
        border-radius:10px;
        padding:9px;
        background:var(--surface-strong);
      }
      .meal-comparison-mean-grid span {
        display:block;
        color:var(--muted);
        font-size:.72rem;
      }
      .meal-comparison-mean-grid strong {
        display:block;
        margin-top:4px;
        line-height:1.35;
      }
      #meal-analysis .explanation-disclosure {
        margin-top:12px;
        border:1px solid var(--line);
        border-radius:12px;
        background:rgba(255,255,255,.24);
        overflow:hidden;
      }
      #meal-analysis .explanation-disclosure > summary {
        cursor:pointer;
        padding:10px 12px;
        color:var(--muted);
        font-size:.84rem;
        font-weight:800;
      }
      #meal-analysis .explanation-disclosure[open] > summary {
        border-bottom:1px solid var(--line);
      }
      #meal-analysis .explanation-disclosure > p { margin:12px; }
      @media (max-width:720px) {
        .meal-comparison-mean-grid { grid-template-columns:1fr; }
      }
      @media (prefers-color-scheme:dark) {
        .meal-comparison-mean-card,
        #meal-analysis .explanation-disclosure { background:rgba(17,26,39,.24); }
      }
    `;
    document.head.appendChild(style);
  }

  function currentAnalyses() {
    if (typeof gcState === 'undefined') return [];
    const api = typeof GlucoseCoachV3 !== 'undefined' ? GlucoseCoachV3 : root?.GlucoseCoachV3;
    const analyze = api?.analyzeMeals ||
      (typeof analyzeMeals === 'function' ? analyzeMeals : null);
    if (typeof analyze !== 'function') return [];
    return analyze(
      gcState.diary || [],
      gcState.clinical?.cgm || [],
      gcState.clinical?.boluses || [],
    );
  }

  function ensureMeansContainer() {
    const body = document.querySelector('#food-comparison');
    const tableWrap = body?.closest('.table-wrap');
    if (!tableWrap) return null;
    let container = document.querySelector('#food-comparison-means');
    if (!container) {
      container = document.createElement('div');
      container.id = 'food-comparison-means';
      container.className = 'meal-comparison-means';
      tableWrap.insertAdjacentElement('afterend', container);
    }
    return container;
  }

  function renderComparisonMeans(analyses) {
    const container = ensureMeansContainer();
    if (!container) return [];
    const groups = calculateMealMeanGroups(analyses);
    container.hidden = groups.length === 0;
    if (!groups.length) {
      container.replaceChildren();
      return groups;
    }

    container.innerHTML = '<h3>Arithmetische Mittelwerte der Einzelangaben</h3>' +
      groups.map((group) => `
        <section class="meal-comparison-mean-card" data-food-key="${escapeHtml(group.key)}">
          <div class="meal-comparison-mean-head">
            <strong>${escapeHtml(group.label)}</strong>
            <small>${group.analyzed} von ${group.entries} Einträgen vollständig auswertbar</small>
          </div>
          <div class="meal-comparison-mean-grid">
            <div data-meal-mean="rise" data-n="${group.rise.n}">
              <span>Erster nachhaltiger Anstieg</span>
              <strong>${escapeHtml(formatRise(group.rise))}</strong>
            </div>
            <div data-meal-mean="peak" data-n="${group.peak.n}">
              <span>Peak</span>
              <strong>${escapeHtml(formatPeak(group.peak))}</strong>
            </div>
            <div data-meal-mean="turn" data-n="${group.turn.n}">
              <span>CGM-Wendepunkt-Proxy</span>
              <strong>${escapeHtml(formatTurn(group.turn))}</strong>
            </div>
          </div>
        </section>`,
      ).join('');
    return groups;
  }

  function createDisclosure(id, summaryText, anchor, elements) {
    if (!anchor) return null;
    let details = document.querySelector(`#${id}`);
    if (!details) {
      if (!elements.length) return null;
      details = document.createElement('details');
      details.id = id;
      details.className = 'explanation-disclosure';
      const summary = document.createElement('summary');
      summary.textContent = summaryText;
      details.appendChild(summary);
      anchor.insertAdjacentElement('afterend', details);
    }
    for (const element of elements) {
      if (element && element.parentElement !== details) details.appendChild(element);
    }
    return details;
  }

  function organizeExplanations() {
    const summary = document.querySelector('#meal-summary');
    const firstCard = summary?.closest('article.card');
    if (summary && firstCard) {
      const intro = firstCard.querySelector('#meal-method-explanation p.muted') ||
        [...firstCard.children].find((element) => element.matches?.('p.muted'));
      createDisclosure(
        'meal-method-explanation',
        'Methodik und Grenzen anzeigen',
        summary,
        [intro].filter(Boolean),
      );
    }

    const note = document.querySelector('#food-comparison-note');
    const tableWrap = document.querySelector('#food-comparison')?.closest('.table-wrap');
    const means = document.querySelector('#food-comparison-means');
    const anchor = means && !means.hidden ? means : tableWrap;
    createDisclosure(
      'food-comparison-explanation',
      'Berechnung des Lebensmittelvergleichs anzeigen',
      anchor,
      [note].filter(Boolean),
    );
  }

  function applyLayout() {
    if (typeof document === 'undefined') return;
    ensureStyles();
    const analyses = currentAnalyses();
    renderComparisonMeans(analyses);
    organizeExplanations();
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    if (root?.__glucoseCoachMealPageUiInstalled) {
      applyLayout();
      return;
    }
    if (root) root.__glucoseCoachMealPageUiInstalled = true;
    const previousRender = gcRender;
    gcRender = function renderWithCompactMealPage() {
      previousRender();
      applyLayout();
    };
    applyLayout();
  }

  const api = {
    calculateMealMeanGroups,
    formatRise,
    formatPeak,
    formatTurn,
    applyLayout,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachMealPageUi = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
