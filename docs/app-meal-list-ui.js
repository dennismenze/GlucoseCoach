(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  let selectedMealDate = 'all';
  let selectedDiaryDate = 'all';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function localDayKeyFromMinute(minute) {
    const date = new Date(Number(minute) * MINUTE_MS);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function localDayKeyFromWhen(value) {
    const source = String(value ?? '').trim();
    const direct = source.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatDateKey(key) {
    const [year, month, day] = String(key).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime())
      ? String(key)
      : new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
  }

  function ensureStyles() {
    if (document.querySelector('#meal-list-ui-styles')) return;
    const style = document.createElement('style');
    style.id = 'meal-list-ui-styles';
    style.textContent = `
      .compact-list-controls { display:flex; flex-wrap:wrap; gap:12px; align-items:end; margin:12px 0; }
      .compact-list-controls label { min-width:220px; }
      .compact-list-controls select { width:100%; }
      .compact-list-disclosure { margin-top:10px; }
      .compact-list-disclosure > summary,
      .meal-event > summary,
      .diary-entry > summary { cursor:pointer; }
      .compact-list-disclosure > summary { font-weight:700; padding:12px 14px; border:1px solid var(--line); border-radius:12px; }
      .compact-list-disclosure[open] > summary { margin-bottom:12px; }
      .compact-list-actions { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
      .meal-event,
      .diary-entry { padding:0; overflow:hidden; }
      .meal-event > summary,
      .diary-entry > summary { padding:14px; list-style-position:inside; }
      .meal-event > .analysis-grid { margin-left:14px; margin-right:14px; margin-bottom:14px; }
      .diary-entry > p,
      .diary-entry > button { margin-left:14px; margin-right:14px; }
      .diary-entry > button { margin-bottom:14px; }
      @media (max-width:720px) { .compact-list-controls label { min-width:100%; } }
    `;
    document.head.appendChild(style);
  }

  function sortedMealAnalyses() {
    if (
      typeof GlucoseCoachV3 === 'undefined' ||
      typeof GlucoseCoachV3.analyzeMeals !== 'function'
    ) return [];
    return GlucoseCoachV3.analyzeMeals(
      gcState.diary || [],
      gcState.clinical?.cgm || [],
      gcState.clinical?.boluses || [],
    ).sort((a, b) => (b.minute || 0) - (a.minute || 0));
  }

  function sortedDiaryEntries() {
    return [...(gcState.diary || [])].sort((a, b) => String(b.when).localeCompare(String(a.when)));
  }

  function ensureControls(target, options) {
    let controls = document.querySelector(`#${options.controlsId}`);
    if (!controls) {
      controls = document.createElement('div');
      controls.id = options.controlsId;
      controls.className = 'compact-list-controls';
      controls.innerHTML = `
        <label>${escapeHtml(options.label)}
          <select id="${escapeHtml(options.selectId)}"><option value="all">alle Tage</option></select>
        </label>`;
      target.insertAdjacentElement('beforebegin', controls);
      controls.querySelector('select').addEventListener('change', (event) => {
        options.setSelected(event.target.value);
        options.applyFilter();
      });
    }
    return controls;
  }

  function updateDateOptions(select, keys, selected, setSelected, noun) {
    const counts = new Map();
    for (const key of keys) if (key) counts.set(key, (counts.get(key) || 0) + 1);
    const dates = [...counts.keys()].sort().reverse();
    if (selected !== 'all' && !counts.has(selected)) {
      selected = 'all';
      setSelected(selected);
    }
    select.innerHTML = [
      '<option value="all">alle Tage</option>',
      ...dates.map((key) => {
        const count = counts.get(key);
        return `<option value="${escapeHtml(key)}">${escapeHtml(formatDateKey(key))} (${count} ${count === 1 ? noun.singular : noun.plural})</option>`;
      }),
    ].join('');
    select.value = selected;
  }

  function ensureDisclosure(target, options) {
    let disclosure = document.querySelector(`#${options.disclosureId}`);
    if (disclosure) return disclosure;
    disclosure = document.createElement('details');
    disclosure.id = options.disclosureId;
    disclosure.className = 'compact-list-disclosure';
    disclosure.innerHTML = `
      <summary id="${escapeHtml(options.summaryId)}">${escapeHtml(options.initialSummary)}</summary>
      <div class="compact-list-actions">
        <button type="button" class="secondary compact-expand">Sichtbare Details ausklappen</button>
        <button type="button" class="secondary compact-collapse">Sichtbare Details einklappen</button>
      </div>`;
    target.insertAdjacentElement('beforebegin', disclosure);
    disclosure.appendChild(target);
    disclosure.querySelector('.compact-expand').onclick = () => {
      target.querySelectorAll(`${options.itemSelector}:not([hidden])`).forEach((item) => { item.open = true; });
    };
    disclosure.querySelector('.compact-collapse').onclick = () => {
      target.querySelectorAll(`${options.itemSelector}:not([hidden])`).forEach((item) => { item.open = false; });
    };
    return disclosure;
  }

  function compactMealCards(analyses) {
    const target = document.querySelector('#meal-events');
    if (!target) return;
    const articles = [...target.querySelectorAll(':scope > article.analysis-item')];
    articles.forEach((article, index) => {
      const details = document.createElement('details');
      details.className = `${article.className} meal-event`;
      const analysis = analyses[index];
      details.dataset.date = analysis ? localDayKeyFromMinute(analysis.minute) : '';
      const head = article.querySelector(':scope > .analysis-head');
      const summary = document.createElement('summary');
      summary.className = 'analysis-head';
      if (head) while (head.firstChild) summary.appendChild(head.firstChild);
      details.appendChild(summary);
      for (const child of [...article.children]) if (child !== head) details.appendChild(child);
      article.replaceWith(details);
    });
  }

  function compactDiaryCards(entries) {
    const target = document.querySelector('#entries');
    if (!target) return;
    const articles = [...target.querySelectorAll(':scope > article.entry')];
    articles.forEach((article, index) => {
      const details = document.createElement('details');
      details.className = `${article.className} diary-entry`;
      const entry = entries[index];
      details.dataset.date = entry ? localDayKeyFromWhen(entry.when) : '';
      const head = article.querySelector(':scope > .entry-head');
      const summary = document.createElement('summary');
      summary.className = 'entry-head';
      if (head) while (head.firstChild) summary.appendChild(head.firstChild);
      details.appendChild(summary);
      for (const child of [...article.children]) if (child !== head) details.appendChild(child);
      article.replaceWith(details);
    });
  }

  function filterItems(targetSelector, itemSelector, selected, summarySelector, noun, scopeLabel) {
    const target = document.querySelector(targetSelector);
    if (!target) return;
    let visible = 0;
    for (const item of target.querySelectorAll(itemSelector)) {
      item.hidden = selected !== 'all' && item.dataset.date !== selected;
      if (item.hidden) item.open = false;
      else visible += 1;
    }
    const summary = document.querySelector(summarySelector);
    if (summary) {
      const scope = selected === 'all' ? 'alle Tage' : formatDateKey(selected);
      summary.textContent = `${visible} ${visible === 1 ? noun.singular : noun.plural} für ${scope} ${scopeLabel}`;
    }
  }

  function applyMealFilter() {
    filterItems(
      '#meal-events', '.meal-event', selectedMealDate, '#meal-events-compact-summary',
      { singular: 'Mahlzeit', plural: 'Mahlzeiten' }, 'anzeigen',
    );
  }

  function applyDiaryFilter() {
    filterItems(
      '#entries', '.diary-entry', selectedDiaryDate, '#diary-entries-compact-summary',
      { singular: 'Tagebucheintrag', plural: 'Tagebucheinträge' }, 'anzeigen',
    );
  }

  function renderMealEnhancement() {
    const target = document.querySelector('#meal-events');
    if (!target) return;
    const analyses = sortedMealAnalyses();
    const controls = ensureControls(target, {
      controlsId: 'meal-list-controls',
      selectId: 'meal-event-date',
      label: 'Datum der Mahlzeiten',
      setSelected: (value) => { selectedMealDate = value; },
      applyFilter: applyMealFilter,
    });
    updateDateOptions(
      controls.querySelector('select'),
      analyses.map((item) => localDayKeyFromMinute(item.minute)),
      selectedMealDate,
      (value) => { selectedMealDate = value; },
      { singular: 'Mahlzeit', plural: 'Mahlzeiten' },
    );
    ensureDisclosure(target, {
      disclosureId: 'meal-events-compact',
      summaryId: 'meal-events-compact-summary',
      initialSummary: 'Mahlzeiten anzeigen',
      itemSelector: '.meal-event',
    });
    compactMealCards(analyses);
    applyMealFilter();
  }

  function renderDiaryEnhancement() {
    const target = document.querySelector('#entries');
    if (!target) return;
    const entries = sortedDiaryEntries();
    const controls = ensureControls(target, {
      controlsId: 'diary-list-controls',
      selectId: 'diary-entry-date',
      label: 'Datum der Tagebucheinträge',
      setSelected: (value) => { selectedDiaryDate = value; },
      applyFilter: applyDiaryFilter,
    });
    updateDateOptions(
      controls.querySelector('select'),
      entries.map((entry) => localDayKeyFromWhen(entry.when)),
      selectedDiaryDate,
      (value) => { selectedDiaryDate = value; },
      { singular: 'Eintrag', plural: 'Einträge' },
    );
    ensureDisclosure(target, {
      disclosureId: 'diary-entries-compact',
      summaryId: 'diary-entries-compact-summary',
      initialSummary: 'Tagebucheinträge anzeigen',
      itemSelector: '.diary-entry',
    });
    compactDiaryCards(entries);
    applyDiaryFilter();
  }

  function renderEnhancements() {
    renderMealEnhancement();
    renderDiaryEnhancement();
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    ensureStyles();
    const previousRender = gcRender;
    gcRender = function renderWithCompactMealLists() {
      previousRender();
      renderEnhancements();
    };
    renderEnhancements();
  }

  if (typeof document !== 'undefined') installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
