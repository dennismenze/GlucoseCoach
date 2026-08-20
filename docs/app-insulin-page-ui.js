(function (root) {
  'use strict';

  const PROFILE_MAX_MINUTES = 300;
  const PROFILE_MAX_PERCENT = 100;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function parseLocaleNumber(value) {
    const source = String(value ?? '').trim();
    if (!source || source === '–') return null;
    const normalized = source
      .replace(/\s/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')
      .replace(/[^0-9+\-.]/g, '');
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function parseMinutes(value) {
    const source = String(value ?? '').trim();
    if (!source || source === '–') return null;
    const hours = source.match(/(\d+)\s*h/);
    const minutes = source.match(/(\d+)\s*min/);
    if (!hours && !minutes) return null;
    return Number(hours?.[1] || 0) * 60 + Number(minutes?.[1] || 0);
  }

  function profileRows() {
    const body = document.querySelector('#insulin-profile');
    if (!body) return [];
    return [...body.querySelectorAll('tr')]
      .map((row) => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) return null;
        const range = String(cells[3].textContent || '').replace(/\s*%\s*$/, '').split('–');
        const offset = parseMinutes(cells[0].textContent);
        const n = parseLocaleNumber(cells[1].textContent);
        const median = parseLocaleNumber(cells[2].textContent);
        const q1 = parseLocaleNumber(range[0]);
        const q3 = parseLocaleNumber(range[1]);
        if (![offset, n, median, q1, q3].every(Number.isFinite)) return null;
        return {
          offset,
          n,
          median,
          q1,
          q3,
          offsetLabel: cells[0].textContent.trim(),
          nLabel: cells[1].textContent.trim(),
          medianLabel: cells[2].textContent.trim(),
          rangeLabel: cells[3].textContent.trim(),
        };
      })
      .filter(Boolean);
  }

  function ensureStyles() {
    if (document.querySelector('#insulin-page-ui-styles')) return;
    const style = document.createElement('style');
    style.id = 'insulin-page-ui-styles';
    style.textContent = `
      .insulin-profile-chart {
        width: min(100%, 760px);
        height: 210px;
        margin: 14px auto 0;
      }
      .insulin-profile-chart[hidden],
      .insulin-profile-legend[hidden] { display: none; }
      .insulin-profile-chart svg { display: block; width: 100%; height: 100%; }
      .insulin-profile-grid-line { stroke: var(--line); stroke-width: 1; }
      .insulin-profile-axis-label { fill: var(--muted); font-size: 12px; }
      .insulin-profile-band { fill: var(--accent-soft); opacity: .9; }
      .insulin-profile-line {
        fill: none;
        stroke: var(--accent);
        stroke-width: 3;
        stroke-linecap: round;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }
      .insulin-profile-point {
        fill: var(--accent);
        stroke: var(--surface-strong);
        stroke-width: 2;
        vector-effect: non-scaling-stroke;
      }
      .insulin-profile-point:focus { outline: none; stroke-width: 4; }
      .insulin-profile-legend {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 14px;
        margin-top: 8px;
        color: var(--muted);
        font-size: .78rem;
      }
      .insulin-profile-legend span { display: inline-flex; align-items: center; gap: 6px; }
      .insulin-profile-legend i { display: inline-block; width: 24px; height: 8px; border-radius: 999px; }
      .insulin-profile-legend .median-key { height: 3px; background: var(--accent); }
      .insulin-profile-legend .band-key { background: var(--accent-soft); border: 1px solid var(--line); }
      .explanation-disclosure {
        margin-top: 12px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: rgba(255,255,255,.24);
        overflow: hidden;
      }
      .explanation-disclosure > summary {
        cursor: pointer;
        padding: 10px 12px;
        color: var(--muted);
        font-size: .84rem;
        font-weight: 800;
      }
      .explanation-disclosure[open] > summary { border-bottom: 1px solid var(--line); }
      .explanation-disclosure > p { margin: 12px; }
      .explanation-disclosure > .notice { margin: 12px; }
      @media (max-width: 560px) {
        .insulin-profile-chart { height: 178px; }
        .insulin-profile-axis-label { font-size: 11px; }
      }
      @media (prefers-color-scheme: dark) {
        .explanation-disclosure { background: rgba(17,26,39,.24); }
      }
    `;
    document.head.appendChild(style);
  }

  function removeObsoleteSections() {
    const aggregateCard = document.querySelector('#insulin-aggregate')?.closest('article.card');
    if (aggregateCard) {
      aggregateCard.classList.remove('wide');
      aggregateCard.classList.add('full');
      let placeholder = document.querySelector('#insulin-quality-rules-placeholder');
      if (!placeholder) {
        placeholder = document.createElement('span');
        placeholder.id = 'insulin-quality-rules-placeholder';
        placeholder.hidden = true;
        aggregateCard.insertAdjacentElement('afterend', placeholder);
      }
    }

    for (const card of [...document.querySelectorAll('#insulin-action .grid > aside.card')]) {
      const heading = card.querySelector('h2')?.textContent || '';
      if (/Qualitätsregeln/.test(heading) || card.querySelector('#insulin-groups')) {
        card.remove();
      }
    }
  }

  function ensureProfileStructure() {
    const body = document.querySelector('#insulin-profile');
    const card = body?.closest('article.card') || document.querySelector('#insulin-profile-card');
    if (!card) return null;
    card.id = 'insulin-profile-card';
    card.classList.remove('wide');
    card.classList.add('full');
    const heading = card.querySelector('h2');
    if (heading) heading.textContent = 'Normierte persönliche Wirkungskurve';

    const tableWrap = body?.closest('.table-wrap');
    if (tableWrap) {
      tableWrap.hidden = true;
      tableWrap.setAttribute('aria-hidden', 'true');
    }

    let chart = card.querySelector('#insulin-profile-chart');
    if (!chart) {
      chart = document.createElement('div');
      chart.id = 'insulin-profile-chart';
      chart.className = 'insulin-profile-chart';
      const empty = card.querySelector('#insulin-profile-empty');
      if (empty) empty.insertAdjacentElement('beforebegin', chart);
      else card.appendChild(chart);
    }

    let legend = card.querySelector('#insulin-profile-legend');
    if (!legend) {
      legend = document.createElement('div');
      legend.id = 'insulin-profile-legend';
      legend.className = 'insulin-profile-legend';
      legend.innerHTML =
        '<span><i class="median-key"></i>Median</span>' +
        '<span><i class="band-key"></i>mittlere 50 %</span>';
      chart.insertAdjacentElement('afterend', legend);
    }
    return { card, chart, legend };
  }

  function renderProfileChart() {
    const structure = ensureProfileStructure();
    if (!structure) return;
    const { chart, legend, card } = structure;
    const bins = profileRows();
    const empty = card.querySelector('#insulin-profile-empty');
    const hasData = bins.length > 0;
    chart.hidden = !hasData;
    legend.hidden = !hasData;
    if (empty) empty.hidden = hasData;
    if (!hasData) {
      chart.replaceChildren();
      return;
    }

    const width = 720;
    const height = 220;
    const margin = { left: 46, right: 14, top: 12, bottom: 34 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const xMax = Math.max(PROFILE_MAX_MINUTES, ...bins.map((bin) => bin.offset));
    const clampPercent = (value) => Math.max(0, Math.min(PROFILE_MAX_PERCENT, value));
    const x = (value) => margin.left + value / xMax * plotWidth;
    const y = (value) => margin.top + (PROFILE_MAX_PERCENT - clampPercent(value)) /
      PROFILE_MAX_PERCENT * plotHeight;
    const number = (value) => Number(value.toFixed(2));

    const xTicks = [0, 60, 120, 180, 240, 300].filter((value) => value <= xMax);
    const yTicks = [0, 50, 100];
    const grid = [
      ...yTicks.map((value) =>
        `<line class="insulin-profile-grid-line" x1="${margin.left}" y1="${number(y(value))}" ` +
        `x2="${width - margin.right}" y2="${number(y(value))}"></line>` +
        `<text class="insulin-profile-axis-label" x="${margin.left - 8}" y="${number(y(value) + 4)}" ` +
        `text-anchor="end">${value} %</text>`,
      ),
      ...xTicks.map((value) => {
        const label = value === 0 ? '0' : `${value / 60} h`;
        return `<line class="insulin-profile-grid-line" x1="${number(x(value))}" y1="${margin.top}" ` +
          `x2="${number(x(value))}" y2="${height - margin.bottom}"></line>` +
          `<text class="insulin-profile-axis-label" x="${number(x(value))}" y="${height - 10}" ` +
          `text-anchor="middle">${label}</text>`;
      }),
    ].join('');

    const upper = bins.map((bin) => `${number(x(bin.offset))},${number(y(bin.q3))}`);
    const lower = [...bins].reverse().map(
      (bin) => `${number(x(bin.offset))},${number(y(bin.q1))}`,
    );
    const band = bins.length > 1
      ? `<path class="insulin-profile-band" d="M ${upper.join(' L ')} L ${lower.join(' L ')} Z"></path>`
      : '';
    const medianPath = `M ${bins.map(
      (bin) => `${number(x(bin.offset))},${number(y(bin.median))}`,
    ).join(' L ')}`;
    const points = bins.map((bin) => {
      const title = `${bin.offsetLabel} · Median ${bin.medianLabel} · ` +
        `mittlere 50 % ${bin.rangeLabel} · n=${bin.nLabel}`;
      return `<circle class="insulin-profile-point" data-profile-point="true" ` +
        `data-offset-label="${escapeHtml(bin.offsetLabel)}" data-events="${escapeHtml(bin.nLabel)}" ` +
        `data-median="${escapeHtml(bin.medianLabel)}" data-middle-fifty="${escapeHtml(bin.rangeLabel)}" ` +
        `cx="${number(x(bin.offset))}" cy="${number(y(bin.median))}" r="4" tabindex="0">` +
        `<title>${escapeHtml(title)}</title></circle>`;
    }).join('');

    chart.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="insulin-profile-title insulin-profile-desc">
        <title id="insulin-profile-title">Normierte persönliche Wirkungskurve</title>
        <desc id="insulin-profile-desc">Median als Linie und mittlere 50 Prozent als Band über fünf Stunden nach dem Bolus.</desc>
        ${grid}
        ${band}
        <path class="insulin-profile-line" d="${medianPath}"></path>
        ${points}
      </svg>`;
  }

  function createDisclosure(id, summaryText, anchor, elements) {
    if (!anchor || !elements.length) return null;
    let details = document.querySelector(`#${id}`);
    if (!details) {
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
    const firstCard = document.querySelector('#insulin-action .grid > article.card.full');
    if (firstCard) {
      createDisclosure(
        'insulin-primary-explanation',
        'Methodik und Grenzen anzeigen',
        firstCard.querySelector('#insulin-summary'),
        [firstCard.querySelector('.notice.warn'), firstCard.querySelector('#insulin-method-note')].filter(Boolean),
      );
    }

    const phaseCard = document.querySelector('#all-bolus-phases-card');
    if (phaseCard) {
      const intro = [...phaseCard.children].find(
        (element) => element.matches?.('p.muted.compact') && element.id !== 'all-bolus-phase-note',
      );
      createDisclosure(
        'all-bolus-explanation',
        'Berechnung und Grenzen anzeigen',
        phaseCard.querySelector('#all-bolus-phase-summary'),
        [intro, phaseCard.querySelector('#all-bolus-phase-note')].filter(Boolean),
      );
    }

    const meansCard = document.querySelector('#insulin-means-card');
    if (meansCard) {
      const intro = [...meansCard.children].find((element) => element.matches?.('p.muted.compact'));
      createDisclosure(
        'insulin-means-explanation',
        'Berechnung der Mittelwerte anzeigen',
        meansCard.querySelector('#insulin-means'),
        [intro].filter(Boolean),
      );
    }

    const profileCard = document.querySelector('#insulin-profile-card');
    if (profileCard) {
      const intro = [...profileCard.children].find((element) => element.matches?.('p.muted.compact'));
      createDisclosure(
        'insulin-profile-explanation',
        'Berechnung der Kurve anzeigen',
        profileCard.querySelector('#insulin-profile-legend'),
        [intro].filter(Boolean),
      );
    }

    const events = document.querySelector('#insulin-events');
    const eventsCard = events?.closest('article.card');
    if (eventsCard) {
      const intro = [...eventsCard.children].find((element) => element.matches?.('p.muted'));
      createDisclosure(
        'insulin-events-explanation',
        'Hinweise zur Einzelauswertung anzeigen',
        eventsCard.querySelector('h2'),
        [intro].filter(Boolean),
      );
    }
  }

  function applyLayout() {
    if (typeof document === 'undefined') return;
    ensureStyles();
    removeObsoleteSections();
    renderProfileChart();
    organizeExplanations();
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    const previousRender = gcRender;
    gcRender = function renderWithCompactInsulinPage() {
      previousRender();
      applyLayout();
    };
    applyLayout();
  }

  const api = { applyLayout, profileRows, parseMinutes, parseLocaleNumber };
  if (root) root.GlucoseCoachInsulinPageUi = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
