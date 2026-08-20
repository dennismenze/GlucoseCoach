(function (root) {
  'use strict';

  let selectedDate = 'all';
  let lastAnalysis = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function formatDateKey(key) {
    const [year, month, day] = String(key).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime())
      ? String(key)
      : new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
  }

  function ensureStyles() {
    if (document.querySelector('#insulin-summary-ui-styles')) return;
    const style = document.createElement('style');
    style.id = 'insulin-summary-ui-styles';
    style.textContent = `
      .insulin-date-controls { display:flex; flex-wrap:wrap; gap:12px; align-items:end; margin:14px 0; }
      .insulin-date-controls label { min-width:240px; }
      .insulin-date-controls select { width:100%; }
      .insulin-mean-grid { margin-top:12px; }
      .insulin-mean-grid > div { min-width:0; }
      .insulin-events-disclosure { margin-top:14px; }
      .insulin-events-disclosure > summary,
      .insulin-event > summary { cursor:pointer; }
      .insulin-events-disclosure > summary { font-weight:700; padding:12px 14px; border:1px solid var(--line); border-radius:12px; }
      .insulin-events-disclosure[open] > summary { margin-bottom:12px; }
      .insulin-event { padding:0; overflow:hidden; }
      .insulin-event > summary { padding:14px; list-style-position:inside; }
      .insulin-event > .insulin-event-grid,
      .insulin-event > p { margin-left:14px; margin-right:14px; }
      .insulin-event > p { margin-bottom:14px; }
      .insulin-event-actions { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
      @media (max-width:720px) { .insulin-date-controls label { min-width:100%; } }
    `;
    document.head.appendChild(style);
  }

  function ensureMeanCard() {
    let card = document.querySelector('#insulin-means-card');
    if (card) return card;
    const grid = document.querySelector('#insulin-action .grid');
    const firstCard = grid?.querySelector('article.card.full');
    if (!grid || !firstCard) return null;

    card = document.createElement('article');
    card.id = 'insulin-means-card';
    card.className = 'card full';
    card.innerHTML = `
      <h2>Mittelwerte der auswertbaren Korrekturboli</h2>
      <p class="muted compact">Zusätzliche arithmetische Mittelwerte aus streng isolierten Korrekturereignissen mit erkennbarem Effekt. <code>n</code> zeigt je Kennzahl, wie viele Ereignisse tatsächlich einfließen; fehlende oder zensierte Werte werden nicht künstlich auf fünf Stunden gesetzt.</p>
      <div class="insulin-date-controls">
        <label>Datum für Mittelwerte und Einzelboli
          <select id="insulin-event-date"><option value="all">alle Tage</option></select>
        </label>
        <span id="insulin-mean-scope" class="muted compact"></span>
      </div>
      <div id="insulin-means" class="analysis-grid insulin-mean-grid"></div>`;
    firstCard.insertAdjacentElement('afterend', card);
    card.querySelector('#insulin-event-date').addEventListener('change', (event) => {
      selectedDate = event.target.value;
      renderMeanCards();
      applyEventFilter();
    });
    return card;
  }

  function updateDateOptions(events) {
    const core = root.GlucoseCoachInsulinSummary;
    const select = ensureMeanCard()?.querySelector('#insulin-event-date');
    if (!core || !select) return;
    const counts = new Map();
    for (const event of events) {
      const key = core.localDayKey(event.minute);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const dates = [...counts.keys()].sort().reverse();
    if (selectedDate !== 'all' && !counts.has(selectedDate)) selectedDate = 'all';
    select.innerHTML = [
      '<option value="all">alle Tage</option>',
      ...dates.map((key) => {
        const count = counts.get(key);
        return `<option value="${escapeHtml(key)}">${escapeHtml(formatDateKey(key))} (${count} ${count === 1 ? 'Bolus' : 'Boli'})</option>`;
      }),
    ].join('');
    select.value = selectedDate;
  }

  function renderMeanCards() {
    const core = root.GlucoseCoachInsulinSummary;
    const target = document.querySelector('#insulin-means');
    const scope = document.querySelector('#insulin-mean-scope');
    if (!core || !target || !lastAnalysis) return;
    const result = core.calculateMeanCards(lastAnalysis.events, selectedDate);
    const noun = result.eventCount === 1 ? 'auswertbares Ereignis' : 'auswertbare Ereignisse';
    if (scope) {
      scope.textContent = selectedDate === 'all'
        ? `${result.eventCount} ${noun} über alle Tage`
        : `${result.eventCount} ${noun} am ${formatDateKey(selectedDate)}`;
    }
    if (!result.eventCount) {
      target.innerHTML = '<div class="notice info">Für diese Auswahl gibt es kein streng isoliertes Korrekturereignis mit erkennbarem Effekt.</div>';
      return;
    }
    target.innerHTML = result.cards.map((card) => `
      <div class="insulin-mean-card" data-mean-key="${escapeHtml(card.key)}">
        <span>${escapeHtml(card.label)}</span>
        <strong class="insulin-mean-value">${card.metrics.map(core.formatMetric).map(escapeHtml).join(' · ')}</strong>
      </div>`).join('');
  }

  function ensureEventDisclosure() {
    const target = document.querySelector('#insulin-events');
    if (!target) return null;
    let disclosure = document.querySelector('#insulin-events-disclosure');
    if (disclosure) return disclosure;

    disclosure = document.createElement('details');
    disclosure.id = 'insulin-events-disclosure';
    disclosure.className = 'insulin-events-disclosure';
    disclosure.innerHTML = `
      <summary id="insulin-events-summary">Einzelne Boli anzeigen</summary>
      <div class="insulin-event-actions">
        <button type="button" class="secondary" id="insulin-expand-visible">Sichtbare Details ausklappen</button>
        <button type="button" class="secondary" id="insulin-collapse-visible">Sichtbare Details einklappen</button>
      </div>`;
    target.insertAdjacentElement('beforebegin', disclosure);
    disclosure.appendChild(target);
    disclosure.querySelector('#insulin-expand-visible').onclick = () => {
      target.querySelectorAll('.insulin-event:not([hidden])').forEach((item) => { item.open = true; });
    };
    disclosure.querySelector('#insulin-collapse-visible').onclick = () => {
      target.querySelectorAll('.insulin-event:not([hidden])').forEach((item) => { item.open = false; });
    };
    return disclosure;
  }

  function compactEventCards(events) {
    const core = root.GlucoseCoachInsulinSummary;
    const target = document.querySelector('#insulin-events');
    if (!core || !target) return;
    const byId = new Map(events.map((event) => [String(event.id), event]));
    for (const article of [...target.querySelectorAll('article.insulin-event')]) {
      const details = document.createElement('details');
      details.className = article.className;
      for (const attribute of article.attributes) {
        if (attribute.name !== 'class') details.setAttribute(attribute.name, attribute.value);
      }
      const event = byId.get(String(article.dataset.eventId || ''));
      details.dataset.date = event ? core.localDayKey(event.minute) : '';
      const head = article.querySelector(':scope > .analysis-head');
      const summary = document.createElement('summary');
      summary.className = 'analysis-head';
      if (head) while (head.firstChild) summary.appendChild(head.firstChild);
      details.appendChild(summary);
      for (const child of [...article.children]) if (child !== head) details.appendChild(child);
      article.replaceWith(details);
    }
  }

  function applyEventFilter() {
    const target = document.querySelector('#insulin-events');
    if (!target) return;
    let visibleCount = 0;
    for (const event of target.querySelectorAll('.insulin-event')) {
      event.hidden = selectedDate !== 'all' && event.dataset.date !== selectedDate;
      if (event.hidden) event.open = false;
      else visibleCount += 1;
    }
    const summary = document.querySelector('#insulin-events-summary');
    if (summary) {
      const scope = selectedDate === 'all' ? 'alle Tage' : formatDateKey(selectedDate);
      summary.textContent = `${visibleCount} ${visibleCount === 1 ? 'Bolus' : 'Boli'} für ${scope} anzeigen`;
    }
  }

  function renderEnhancements() {
    if (
      !root.GlucoseCoachInsulinSummary ||
      typeof GlucoseCoachV3 === 'undefined' ||
      typeof GlucoseCoachV3.analyzeInsulinAction !== 'function'
    ) return;
    lastAnalysis = GlucoseCoachV3.analyzeInsulinAction(gcState.clinical || {}, gcState.diary || []);
    ensureMeanCard();
    updateDateOptions(lastAnalysis.events);
    renderMeanCards();
    ensureEventDisclosure();
    compactEventCards(lastAnalysis.events);
    applyEventFilter();
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    ensureStyles();
    const previousRender = gcRender;
    gcRender = function renderWithInsulinSummaryUi() {
      previousRender();
      renderEnhancements();
    };
    renderEnhancements();
  }

  if (typeof document !== 'undefined') installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
