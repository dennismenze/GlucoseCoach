(function () {
  'use strict';

  const core = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-insulin-core.js')
    : globalThis.GlucoseCoachInsulinCore;
  const modelApi = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-insulin-model.js')
    : globalThis.GlucoseCoachInsulinModel;
  if (!core || !modelApi) throw new Error('Insulin-Analysemodule sind nicht geladen.');

  const { C, DEFAULT_SETTINGS, normalizeSettings, analyzeBolusEvents, clamp } = core;
  const { buildInsulinEffectModel, buildInsulinSubgroups } = modelApi;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'\"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[character]));
  }

  function fmt(value, digits = 0) {
    return value === null || value === undefined || !Number.isFinite(Number(value))
      ? '–'
      : new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value));
  }

  function minutes(value) {
    return Number.isFinite(value) ? `${fmt(value, 0)} min` : '–';
  }

  function hoursMinutes(value) {
    if (!Number.isFinite(value)) return '–';
    const hours = Math.floor(value / 60);
    const minutesPart = Math.round(value % 60);
    if (!hours) return `${minutesPart} min`;
    return `${hours} h ${String(minutesPart).padStart(2, '0')} min`;
  }

  function rangeText(statistics, formatter = minutes) {
    if (!statistics || !Number.isFinite(statistics.median)) return '–';
    const range = Number.isFinite(statistics.q1) && Number.isFinite(statistics.q3)
      ? ` · IQR ${formatter(statistics.q1)}–${formatter(statistics.q3)}`
      : '';
    return `${formatter(statistics.median)}${range}`;
  }

  function dateTime(minute) {
    if (!Number.isFinite(minute)) return '–';
    return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(minute * C.MINUTE_MS));
  }

  function qualityClass(quality) {
    return quality === 'hoch' ? 'ok' : quality === 'mittel' ? 'partial' : 'wait';
  }

  function reasonText(event) {
    if (!event.reasons.length) return 'keine der definierten Störvariablen erkannt';
    return event.reasons.map((reason) => reason.label).join('; ');
  }

  function loadSettings() {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(C.SETTINGS_KEY) || 'null'));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(C.SETTINGS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  }

  function showPanel(panelId) {
    if (typeof gcShow === 'function') {
      gcShow(panelId);
      return;
    }
    document.querySelectorAll('.panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === panelId);
    });
    document.querySelectorAll('nav button[data-panel]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.panel === panelId));
    });
  }

  function ensurePanel() {
    if (typeof document === 'undefined') return;
    if (!document.querySelector('link[href="insulin-effect.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'insulin-effect.css';
      document.head.appendChild(link);
    }
    const navigation = document.querySelector('nav[aria-label="Bereiche"]');
    if (navigation && !navigation.querySelector('[data-panel="insulin-effect"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.panel = 'insulin-effect';
      button.setAttribute('aria-selected', 'false');
      button.textContent = 'Insulinwirkung';
      navigation.insertBefore(button, navigation.querySelector('[data-panel="diary"]') || null);
      button.addEventListener('click', () => showPanel('insulin-effect'));
    }
    if (document.querySelector('#insulin-effect')) return;
    const panel = document.createElement('section');
    panel.id = 'insulin-effect';
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="notice warn insulin-boundary">
        <strong>Schätzung der effektiven CGM-Senkungsreaktion, nicht der pharmakologischen Insulinwirkung.</strong>
        Die Auswertung sucht bevorzugt isolierte Korrekturboli ohne protokollierte Kohlenhydrate,
        weiteres Insulin, Sport oder andere erkannte Störvariablen. Ein stabiler CGM-Wert kann
        trotz fortbestehender Insulinwirkung entstehen. Die Ergebnisse sind keine Dosis- oder
        Pumpeneinstellungsempfehlung.
      </div>
      <div class="source-row insulin-settings-row">
        <div>
          <h2>Persönliche Insulinwirkungsanalyse</h2>
          <p class="muted compact">Beginn, stärkste Senkungsrate, Nadir, stabile Phase und Ende der erkennbaren Senkungsphase werden ab dem tatsächlichen Boluszeitpunkt berechnet.</p>
        </div>
        <div class="insulin-settings">
          <label>Insulinpräparat (optional)<input id="insulin-preparation" type="text" maxlength="80" placeholder="z. B. Fiasp"></label>
          <label>Analysefenster<select id="insulin-action-window"><option value="240">4 Stunden</option><option value="300" selected>5 Stunden</option><option value="360">6 Stunden</option></select></label>
        </div>
      </div>
      <div id="insulin-model-status" class="notice info"></div>
      <div id="insulin-model-metrics" class="grid insulin-metrics"></div>
      <div class="grid" style="margin-top:16px">
        <article class="card wide">
          <h2>Geschätzte relative Senkungsintensität</h2>
          <p class="muted">Jedes geeignete Ereignis wird auf seine stärkste beobachtete Senkungsrate normiert. 100 % bedeutet das individuelle Maximum dieses Ereignisses, nicht 100 % des noch aktiven Insulins.</p>
          <div class="table-wrap"><table class="quality-table"><thead><tr><th>Zeit ab Bolus</th><th>Ereignisse</th><th>Verlauf</th><th>Median</th><th>IQR</th></tr></thead><tbody id="insulin-effect-curve"></tbody></table></div>
        </article>
        <aside class="card side">
          <h2>Datenauswahl</h2>
          <ul class="facts">
            <li><span>Korrekturboli erkannt</span><strong id="insulin-correction-count">0</strong></li>
            <li><span>für Modell geeignet</span><strong id="insulin-eligible-count">0</strong></li>
            <li><span>Mindestzahl</span><strong>${C.MODEL_MIN_EVENTS}</strong></li>
            <li><span>Vorheriges Insulin ausgeschlossen</span><strong>${C.PREVIOUS_INSULIN_EXCLUSION_MINUTES} min</strong></li>
            <li><span>Weiteres Insulin ausgeschlossen</span><strong>${C.NEXT_INSULIN_EXCLUSION_MINUTES} min</strong></li>
            <li><span>Startglukose mindestens</span><strong>${C.START_GLUCOSE_MIN} mg/dl</strong></li>
          </ul>
        </aside>
        <article class="card full">
          <h2>Vergleich nach Tageszeit</h2>
          <div class="table-wrap"><table class="quality-table"><thead><tr><th>Gruppe</th><th>Ereignisse</th><th>Senkungsbeginn</th><th>stärkste Rate</th><th>Ende Senkungsphase</th></tr></thead><tbody id="insulin-time-groups"></tbody></table></div>
        </article>
        <article class="card full">
          <h2>Vergleich nach Bolusgröße</h2>
          <div class="table-wrap"><table class="quality-table"><thead><tr><th>Gruppe</th><th>Ereignisse</th><th>Senkungsbeginn</th><th>stärkste Rate</th><th>Ende Senkungsphase</th></tr></thead><tbody id="insulin-dose-groups"></tbody></table></div>
        </article>
        <article class="card full">
          <div class="source-row">
            <div><h2>Beobachtete Bolusreaktionen</h2><p id="insulin-event-count" class="muted compact"></p></div>
            <label>Ereignisse<select id="insulin-event-filter"><option value="correction" selected>Korrekturboli</option><option value="model">nur Modellereignisse</option><option value="all">alle positiven Boli</option></select></label>
          </div>
          <div id="insulin-event-list" class="analysis-list"></div>
        </article>
      </div>`;
    const diaryPanel = document.querySelector('#diary');
    diaryPanel?.parentNode?.insertBefore(panel, diaryPanel);
  }

  function renderModel(model, settings) {
    const metrics = document.querySelector('#insulin-model-metrics');
    const status = document.querySelector('#insulin-model-status');
    if (!metrics || !status) return;
    const preparation = escapeHtml(settings.preparation || 'nicht angegeben');
    if (!model.sufficient) {
      status.className = 'notice warn';
      status.innerHTML = `<strong>Noch keine belastbare persönliche Wirkungskurve.</strong> ${model.eligibleEvents} von ${model.correctionBoluses} Korrekturboli erfüllen die strengen Isolations- und Qualitätsregeln; mindestens ${C.MODEL_MIN_EVENTS} werden benötigt. Insulinpräparat: ${preparation}.`;
    } else {
      status.className = 'notice info';
      status.innerHTML = `<strong>Geschätzte effektive CGM-Senkungsreaktion aus isolierten Korrekturboli.</strong> ${model.eligibleEvents} Ereignisse, Vertrauensstufe ${model.confidence}. Insulinpräparat: ${preparation}. Die Werte beschreiben den beobachteten CGM-Verlauf, nicht die pharmakologische Konzentration und keine Pumpeneinstellung.`;
    }
    const cards = [
      ['auswertbare Korrekturboli', model.eligibleEvents, `${model.correctionBoluses} Korrekturboli insgesamt`],
      ['erkennbare Senkung ab Bolus', rangeText(model.onset), `${model.onset.n} Ereignisse`],
      ['stärkste Senkungsrate', rangeText(model.peak), `Median ${fmt(model.maximumRate.median, 2)} mg/dl/min`],
      ['erste stabile Phase', rangeText(model.stable), `${model.stable.n} Ereignisse`],
      ['Ende erkennbarer Senkungsphase', rangeText(model.end, hoursMinutes), `${model.end.n} nicht zensierte Ereignisse`],
      ['Dauer ab Senkungsbeginn', rangeText(model.duration, hoursMinutes), 'nur Ereignisse mit erkennbarem Ende'],
      ['Abfall bis zum Nadir', rangeText(model.nadirDrop, (value) => `${fmt(value, 0)} mg/dl`), `${model.nadirDrop.n} Ereignisse`],
      ['nicht bis zum Ende beobachtbar', model.endCensoredPercent === null ? '–' : `${fmt(model.endCensoredPercent, 0)} %`, `Fenster ${settings.actionWindowMinutes} min`],
    ];
    metrics.innerHTML = cards.map(([label, value, sub]) => `<article class="card metric insulin-metric"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></article>`).join('');
  }

  function renderCurve(model) {
    const body = document.querySelector('#insulin-effect-curve');
    if (!body) return;
    body.innerHTML = model.curve.map((point) => {
      const width = Number.isFinite(point.median) ? clamp(point.median, 0, 100) : 0;
      return `<tr><td>${point.offset} min</td><td>${point.n}</td><td><div class="effect-bar"><span style="width:${width}%"></span></div></td><td>${Number.isFinite(point.median) ? `${fmt(point.median, 0)} %` : '–'}</td><td>${Number.isFinite(point.q1) ? `${fmt(point.q1, 0)}–${fmt(point.q3, 0)} %` : '–'}</td></tr>`;
    }).join('');
  }

  function renderSubgroups(groups) {
    const render = (selector, rows) => {
      const body = document.querySelector(selector);
      if (!body) return;
      body.innerHTML = rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.events}</td><td>${rangeText(row.onset)}</td><td>${rangeText(row.peak)}</td><td>${rangeText(row.end, hoursMinutes)}</td></tr>`).join('')
        || '<tr><td colspan="5">Noch keine auswertbaren Gruppen.</td></tr>';
    };
    render('#insulin-time-groups', groups.timeOfDay);
    render('#insulin-dose-groups', groups.doseBand);
  }

  function renderEvents(events) {
    const filter = document.querySelector('#insulin-event-filter')?.value || 'correction';
    const target = document.querySelector('#insulin-event-list');
    const count = document.querySelector('#insulin-event-count');
    if (!target || !count) return;
    const filtered = events.filter((event) => filter === 'all' || (filter === 'model' ? event.modelEligible : event.correctionLike))
      .sort((a, b) => b.minute - a.minute).slice(0, 60);
    count.textContent = `${filtered.length} von ${events.length} Ereignissen angezeigt`;
    target.innerHTML = filtered.map((event) => {
      const status = event.modelEligible ? 'Modell' : event.quality;
      const peak = event.maxDeclineRate === null ? '–' : `${minutes(event.maxEffectMinutes)} · ${fmt(event.maxDeclineRate, 2)} mg/dl/min`;
      const nadir = event.nadir === null ? '–' : `${fmt(event.nadir, 0)} mg/dl · ${minutes(event.nadirMinutes)}`;
      const end = event.endMinutes === null ? `nicht bis ${event.contextMinutes} min erkennbar` : hoursMinutes(event.endMinutes);
      return `<article class="analysis-item insulin-event" data-event-id="${event.id}"><div class="analysis-head"><div><strong>${dateTime(event.minute)} · ${fmt(event.dose, 2)} E</strong><small>${event.correctionLike ? 'Korrekturbolus' : 'Mahlzeitenbolus'} · ${escapeHtml(event.source)} · ${escapeHtml(event.deliveryType)}</small></div><span class="status ${qualityClass(event.quality)}">${status}</span></div><div class="analysis-grid insulin-event-grid"><div><span>Ausgangswert</span><strong>${event.baseline === null ? '–' : `${fmt(event.baseline, 0)} mg/dl`}</strong></div><div><span>Vortrend</span><strong>${event.preSlope === null ? '–' : `${fmt(event.preSlope, 2)} mg/dl/min`}</strong></div><div><span>erkennbarer Senkungsbeginn</span><strong>${minutes(event.onsetMinutes)}</strong></div><div><span>stärkste Senkungsrate</span><strong>${peak}</strong></div><div><span>Nadir</span><strong>${nadir}</strong></div><div><span>erste stabile Phase</span><strong>${minutes(event.stableMinutes)}</strong></div><div><span>Ende Senkungsphase</span><strong>${end}</strong></div><div><span>CGM-Abdeckung / Qualität</span><strong>${fmt(event.coverage, 1)} % · ${event.score}/100</strong></div></div><p class="muted compact"><strong>Kontext:</strong> ${escapeHtml(reasonText(event))}</p></article>`;
    }).join('') || '<div class="empty-state">Keine Ereignisse für diesen Filter.</div>';
  }

  function renderInsulinEffect() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined') return;
    const settings = loadSettings();
    const events = analyzeBolusEvents(gcState.clinical, gcState.diary, settings);
    const model = buildInsulinEffectModel(events, settings);
    renderModel(model, settings);
    renderCurve(model);
    renderSubgroups(buildInsulinSubgroups(events));
    renderEvents(events);
    const correctionCount = document.querySelector('#insulin-correction-count');
    const modelCount = document.querySelector('#insulin-eligible-count');
    if (correctionCount) correctionCount.textContent = String(model.correctionBoluses);
    if (modelCount) modelCount.textContent = String(model.eligibleEvents);
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    ensurePanel();
    const settings = loadSettings();
    const preparationInput = document.querySelector('#insulin-preparation');
    const windowSelect = document.querySelector('#insulin-action-window');
    if (preparationInput) preparationInput.value = settings.preparation;
    if (windowSelect) windowSelect.value = String(settings.actionWindowMinutes);
    const persist = () => {
      saveSettings({ preparation: preparationInput?.value || '', actionWindowMinutes: Number(windowSelect?.value || C.DEFAULT_ACTION_WINDOW_MINUTES) });
      renderInsulinEffect();
    };
    preparationInput?.addEventListener('change', persist);
    windowSelect?.addEventListener('change', persist);
    document.querySelector('#insulin-event-filter')?.addEventListener('change', renderInsulinEffect);

    const previousRender = gcRender;
    gcRender = function renderWithInsulinEffect() {
      previousRender();
      renderInsulinEffect();
    };

    if (typeof gcQuality === 'function') {
      const previousQuality = gcQuality;
      gcQuality = function qualityWithInsulinEffect() {
        previousQuality();
        const body = document.querySelector('#quality-body');
        if (!body) return;
        const rows = [
          ['Insulinwirkungsanalyse', 'isolierte Korrekturboli', 'Mahlzeiten, weiteres Insulin, Sport, temporäre Basaländerungen, Niedrigwarnungen, bereits fallender Vortrend und unvollständige CGM-Abdeckung senken die Qualitätsstufe oder schließen ein Ereignis aus.'],
          ['Erkennbarer Senkungsbeginn', '3 Werte / ≥5 mg/dl', 'Drei aufeinanderfolgende lokale Steigungen müssen fallend sein; über das Bestätigungsfenster müssen mindestens 5 mg/dl Abfall vorliegen.'],
          ['Ende der Senkungsphase', '30 min unter 10 %', 'Nach der stärksten Senkungsrate muss die fallende Rate sechs Messpunkte lang unter 10 % des Ereignismaximums bleiben und darf anschließend nicht relevant zurückkehren.'],
        ];
        for (const values of rows) {
          const row = document.createElement('tr');
          row.innerHTML = values.map((value) => `<td>${value}</td>`).join('');
          body.appendChild(row);
        }
      };
    }
    gcRender();
  }

  const api = { ensurePanel, renderInsulinEffect, loadSettings, saveSettings, fmt, minutes, hoursMinutes, rangeText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.GlucoseCoachInsulinUI = api;
  installBrowserPatch();
})();
