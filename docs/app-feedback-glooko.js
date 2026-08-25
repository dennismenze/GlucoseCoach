(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;

  function buildCombinedAnalysisDiary(localDiary = [], clinical = {}, glookoMode = null) {
    const mode = glookoMode || root?.GlucoseCoachGlookoMode;
    if (typeof mode?.buildAnalysisDiary === 'function') {
      return mode.buildAnalysisDiary(localDiary, clinical);
    }
    return Array.isArray(localDiary) ? localDiary : [];
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function formatNumber(value, digits = 1) {
    return Number.isFinite(Number(value))
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value))
      : '–';
  }

  function formatDate(minute) {
    return Number.isFinite(minute)
      ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })
        .format(new Date(minute * MINUTE_MS))
      : '–';
  }

  function formatTime(minute) {
    return Number.isFinite(minute)
      ? new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
        .format(new Date(minute * MINUTE_MS))
      : '–';
  }

  function currentDiaryAndClinical() {
    if (typeof gcState === 'undefined') return { diary: [], clinical: {} };
    const clinical = gcState.clinical && typeof gcState.clinical === 'object'
      ? gcState.clinical
      : {};
    return {
      diary: buildCombinedAnalysisDiary(gcState.diary || [], clinical),
      clinical,
    };
  }

  function renderMealTiming() {
    const feedback = root?.GlucoseCoachFeedbackUi;
    const target = document.querySelector('#meal-timing-insights');
    const analyze = typeof analyzeMeals === 'function'
      ? analyzeMeals
      : root?.GlucoseCoachV3?.analyzeMeals;
    if (!target || typeof feedback?.buildMealTimingInsights !== 'function' || typeof analyze !== 'function') {
      return;
    }

    const { diary, clinical } = currentDiaryAndClinical();
    const analyses = analyze(diary, clinical.cgm || [], clinical.boluses || []);
    const insights = feedback.buildMealTimingInsights(analyses);
    if (!insights.length) {
      target.innerHTML = '<p class="muted">Noch keine Mahlzeit ist mindestens zweimal mit ' +
        'vollständigem Peak und zugeordnetem Mahlzeitenbolus auswertbar.</p>';
      return;
    }

    target.innerHTML = insights.map((insight) => {
      const result = insight.comparable
        ? `<p><strong>Kleinster beobachteter Median:</strong> ${escapeHtml(insight.best.label)} ` +
          `mit ${formatNumber(insight.best.medianPeakDelta, 0)} mg/dl Peak-Anstieg aus ` +
          `${insight.best.observations} Beobachtungen.</p>`
        : '<p class="muted">Für eine belastbare Gegenüberstellung fehlen noch mindestens vier ' +
          'Beobachtungen in wenigstens zwei unterschiedlichen Zeitbereichen.</p>';
      const bands = insight.bands.map((band) =>
        `<div><span>${escapeHtml(band.label)} · ${band.observations} Beobachtung(en)</span>` +
        `<strong>${formatNumber(band.medianPeakDelta, 0)} mg/dl Peak-Anstieg</strong></div>`,
      ).join('');
      return `<section class="timing-insight"><h3>${escapeHtml(insight.label)}</h3>${result}` +
        `<div class="timing-band-list">${bands}</div></section>`;
    }).join('') +
      '<details class="feedback-cause-details"><summary>Grenzen der Auswertung anzeigen</summary>' +
      '<p>Verglichen werden nur tatsächlich beobachtete Zeitbereiche. Ausgangswert, Portion, ' +
      'Zusammensetzung, Krankheit, Aktivität und spätere Korrekturboli können den Peak ebenfalls ' +
      'verändern. Daraus entsteht keine automatische Insulinanweisung.</p></details>';
  }

  function renderNightRise() {
    const feedback = root?.GlucoseCoachFeedbackUi;
    const target = document.querySelector('#night-rise-content');
    if (!target || typeof feedback?.buildNightRiseAnalysis !== 'function') return;

    const { diary, clinical } = currentDiaryAndClinical();
    const result = feedback.buildNightRiseAnalysis({ diary, clinical });
    const summary = [
      ['Nächte mit ausreichenden CGM-Daten', result.nightsWithCgm],
      ['ohne Mahlzeitenkontext auswertbar', result.eligibleNights],
      ['Anstieg erkannt', result.rises.length],
      ['mit Korrekturbolus', result.correctedRises],
      ['bestätigter Rückgang nach Korrektur', result.declinesAfterCorrection],
      ['beobachtete Korrekturmenge bis Rückgang', result.medianCorrectionUnitsUntilDecline === null
        ? '–'
        : `${formatNumber(result.medianCorrectionUnitsUntilDecline, 2)} E im Median`],
    ];
    const events = result.rises.length
      ? result.rises.slice(-8).reverse().map((event) => {
        const correction = event.correctionCount
          ? `${formatNumber(event.correctionUnits, 2)} E in ${event.correctionCount} Korrektur(en)`
          : 'keine Korrektur erfasst';
        const decline = event.decline
          ? `bestätigter Rückgang ${formatNumber(event.minutesCorrectionToDecline, 0)} Min. nach erster Korrektur`
          : 'kein bestätigter Rückgang nach einer Korrektur im Zeitfenster';
        return `<section class="night-rise-event"><strong>${formatDate(event.start)} · ab ` +
          `${formatTime(event.start)} Uhr</strong><p>Anstieg um ${formatNumber(event.rise, 0)} mg/dl ` +
          `bis ${formatTime(event.peakMinute)} Uhr · ${correction} · ${decline}</p></section>`;
      }).join('')
      : '<p class="muted">Noch kein entsprechender Verlauf erkannt. Nächte mit einer ' +
        'protokollierten Mahlzeit in den drei Stunden davor werden nicht einbezogen.</p>';

    target.innerHTML = '<div class="analysis-grid insulin-summary">' +
      summary.map(([label, value]) => `<div><span>${escapeHtml(label)}</span>` +
        `<strong>${escapeHtml(value)}</strong></div>`).join('') +
      `</div><div style="margin-top:12px">${events}</div>` +
      '<details class="feedback-cause-details"><summary>Mögliche Ursachen anzeigen</summary>' +
      '<p>Der Verlauf allein beweist keine Ursache. Mögliche Mitursachen sind hormonelle ' +
      'Gegenregulation nach dem Einschlafen – einschließlich Wachstumshormon –, Krankheit oder ' +
      'Stress, verzögerte Aufnahme einer früheren Mahlzeit, geringe Aktivität, eine nicht passende ' +
      'Basalabdeckung sowie Katheter-, Pumpen- oder Sensorprobleme. Die App weist nur vorhandene ' +
      'Kontexte und beobachtete Korrekturen aus.</p></details>';
  }

  function applyCombinedFeedbackAnalyses() {
    if (typeof document === 'undefined') return;
    renderMealTiming();
    renderNightRise();
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    if (root?.__glucoseCoachFeedbackGlookoInstalled) {
      applyCombinedFeedbackAnalyses();
      return;
    }
    if (root) root.__glucoseCoachFeedbackGlookoInstalled = true;
    const previousRender = gcRender;
    gcRender = function renderWithCombinedFeedbackAnalyses() {
      previousRender();
      applyCombinedFeedbackAnalyses();
    };
    applyCombinedFeedbackAnalyses();
  }

  const api = { buildCombinedAnalysisDiary, applyCombinedFeedbackAnalyses };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachFeedbackGlooko = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
