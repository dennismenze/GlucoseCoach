(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const EVENING_START_HOUR = 20;
  const MEAL_CONTEXT_START_HOUR = 18;
  const NIGHT_MIN_CGM_POINTS = 12;
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
  const baseFeedback = root?.GlucoseCoachFeedbackUi || (
    typeof module !== 'undefined' && module.exports && typeof require === 'function'
      ? require('./app-feedback-ui.js')
      : null
  );

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function round(value, digits = 1) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function median(values) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return null;
    const middle = Math.floor(valid.length / 2);
    return valid.length % 2
      ? valid[middle]
      : (valid[middle - 1] + valid[middle]) / 2;
  }

  function parseMinute(value) {
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

  function exactCgmRows(clinical) {
    const map = new Map();
    for (const row of clinical?.cgm || []) {
      const minute = finite(row?.[0]);
      const value = finite(row?.[1]);
      if (minute === null || value === null) continue;
      map.set(minute, [minute, value]);
    }
    return [...map.values()].sort((a, b) => a[0] - b[0]);
  }

  function allCorrectionBoluses(clinical) {
    const rows = [];
    for (const row of clinical?.boluses || []) {
      const minute = finite(row?.[0]);
      const carbs = finite(row?.[1]);
      const units = finite(row?.[2]);
      if (minute === null || units === null || units <= 0 || (carbs !== null && carbs > 0)) continue;
      rows.push({ minute, units, source: 'Pumpe' });
    }
    for (const row of clinical?.manualInsulin || []) {
      const minute = finite(row?.[0]);
      const units = finite(row?.[2]);
      if (minute === null || units === null || units <= 0) continue;
      rows.push({ minute, units, source: 'manuell' });
    }
    const deduplicated = [];
    for (const event of rows.sort((a, b) => a.minute - b.minute)) {
      const duplicate = deduplicated.some(
        (other) => Math.abs(other.minute - event.minute) <= 1 &&
          Math.abs(other.units - event.units) < 0.01,
      );
      if (!duplicate) deduplicated.push(event);
    }
    return deduplicated;
  }

  function localDateKey(minute) {
    const date = new Date(minute * MINUTE_MS);
    const part = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
  }

  function dateAt(key, hour, minute = 0) {
    const [year, month, day] = key.split('-').map(Number);
    return Math.round(new Date(year, month - 1, day, hour, minute).getTime() / MINUTE_MS);
  }

  function hasMealContext(diary, clinical, start, end) {
    const diaryMeal = (diary || []).some((entry) => {
      if (!MEAL_OCCASIONS.has(entry?.occasion)) return false;
      const minute = parseMinute(entry.when);
      return Number.isFinite(minute) && minute >= start && minute <= end;
    });
    if (diaryMeal) return true;

    const pumpMeal = (clinical?.boluses || []).some((row) => {
      const minute = finite(row?.[0]);
      const carbs = finite(row?.[1]);
      return minute !== null && carbs !== null && carbs > 0 && minute >= start && minute <= end;
    });
    if (pumpMeal) return true;

    const cgmCarbs = (clinical?.cgmCarbs || []).some((row) => {
      const minute = finite(row?.[0]);
      const carbs = finite(row?.[1]);
      return minute !== null && carbs !== null && carbs > 0 && minute >= start && minute <= end;
    });
    if (cgmCarbs) return true;

    return (clinical?.foodEvents || []).some((row) => {
      const minute = finite(row?.[0]);
      return minute !== null && minute >= start && minute <= end;
    });
  }

  function buildCombinedAnalysisDiary(localDiary = [], clinical = {}, glookoMode = null) {
    const mode = glookoMode || root?.GlucoseCoachGlookoMode;
    if (typeof mode?.buildAnalysisDiary === 'function') {
      return mode.buildAnalysisDiary(localDiary, clinical);
    }
    return Array.isArray(localDiary) ? localDiary : [];
  }

  function buildNightRiseAnalysis({ diary = [], clinical = {} } = {}) {
    const cgm = exactCgmRows(clinical);
    const corrections = allCorrectionBoluses(clinical);
    const findNightRise = baseFeedback?.findNightRise;
    const findConfirmedDecline = baseFeedback?.findConfirmedDecline;
    const keys = [...new Set(
      cgm
        .filter((row) => new Date(row[0] * MINUTE_MS).getHours() >= EVENING_START_HOUR)
        .map((row) => localDateKey(row[0])),
    )].sort();

    const result = {
      nightsWithCgm: 0,
      excludedForMeal: 0,
      eligibleNights: 0,
      rises: [],
      events: [],
      correctedRises: 0,
      correctedEvenings: 0,
      declinesAfterCorrection: 0,
      medianEveningCorrectionUnits: null,
      medianCorrectionUnitsUntilDecline: null,
    };

    for (const key of keys) {
      const start = dateAt(key, EVENING_START_HOUR);
      const mealContextStart = dateAt(key, MEAL_CONTEXT_START_HOUR);
      const end = dateAt(key, 24);
      const rows = cgm.filter((row) => row[0] >= start && row[0] < end);
      if (rows.length < NIGHT_MIN_CGM_POINTS) continue;
      result.nightsWithCgm += 1;

      const mealContext = hasMealContext(diary, clinical, mealContextStart, end);
      if (mealContext) result.excludedForMeal += 1;
      else result.eligibleNights += 1;

      const rise = !mealContext && typeof findNightRise === 'function'
        ? findNightRise(rows)
        : null;
      const eventCorrections = corrections.filter(
        (event) => event.minute >= start && event.minute < end,
      );
      const firstCorrection = eventCorrections[0] || null;
      const decline = firstCorrection && typeof findConfirmedDecline === 'function'
        ? findConfirmedDecline(rows, firstCorrection.minute)
        : null;
      const correctionUnits = round(
        eventCorrections.reduce((sum, event) => sum + event.units, 0),
        2,
      ) || 0;
      const correctionUnitsUntilDecline = firstCorrection
        ? round(eventCorrections
          .filter((event) => event.minute <= (decline?.confirmedMinute ?? end))
          .reduce((sum, event) => sum + event.units, 0), 2)
        : 0;
      const night = {
        key,
        start,
        mealContextStart,
        mealContext,
        ...(rise || {
          baselineMinute: null,
          baseline: null,
          riseMinute: null,
          peakMinute: null,
          peak: null,
          rise: null,
        }),
        corrections: eventCorrections,
        correctionCount: eventCorrections.length,
        correctionUnits,
        correctionUnitsUntilDecline,
        firstCorrectionMinute: firstCorrection?.minute ?? null,
        decline,
        minutesCorrectionToDecline: decline && firstCorrection
          ? decline.declineMinute - firstCorrection.minute
          : null,
      };

      if (rise) {
        result.rises.push(night);
        if (eventCorrections.length) result.correctedRises += 1;
      }
      if (eventCorrections.length) {
        result.correctedEvenings += 1;
        if (decline) result.declinesAfterCorrection += 1;
      }
      if (rise || eventCorrections.length) result.events.push(night);
    }

    result.medianEveningCorrectionUnits = round(median(
      result.events
        .filter((event) => event.correctionCount > 0)
        .map((event) => event.correctionUnits),
    ), 2);
    result.medianCorrectionUnitsUntilDecline = round(median(
      result.events
        .filter((event) => event.decline && event.correctionUnitsUntilDecline > 0)
        .map((event) => event.correctionUnitsUntilDecline),
    ), 2);
    return result;
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
    const target = document.querySelector('#night-rise-content');
    if (!target) return;

    const title = target.closest('#night-rise-card')?.querySelector('h2');
    if (title) title.textContent = 'Abendliche Anstiege und Korrekturen ab 20 Uhr';

    const { diary, clinical } = currentDiaryAndClinical();
    const result = buildNightRiseAnalysis({ diary, clinical });
    const summary = [
      ['Abende mit ausreichenden CGM-Daten', result.nightsWithCgm],
      ['ohne Mahlzeitenkontext ab 18 Uhr', result.eligibleNights],
      ['mahlzeitenfreier Anstieg erkannt', result.rises.length],
      ['mit Korrektur ab 20 Uhr', result.correctedEvenings],
      ['mit später bestätigtem Rückgang', result.declinesAfterCorrection],
      ['gesamte Korrekturmenge 20–24 Uhr', result.medianEveningCorrectionUnits === null
        ? '–'
        : `${formatNumber(result.medianEveningCorrectionUnits, 2)} E im Median`],
    ];
    const events = result.events.length
      ? result.events.slice(-14).reverse().map((event) => {
        const curve = event.mealContext
          ? 'Mahlzeitenkontext ab 18 Uhr; kein mahlzeitenfreier Anstieg ausgewertet'
          : Number.isFinite(event.rise)
            ? `Anstieg um ${formatNumber(event.rise, 0)} mg/dl bis ` +
              `${formatTime(event.peakMinute)} Uhr`
            : 'kein Anstieg nach den festgelegten Schwellenwerten erkannt';
        const correctionDetails = event.corrections.map((correction) =>
          `${formatTime(correction.minute)} Uhr ${formatNumber(correction.units, 2)} E`,
        ).join(' + ');
        const correction = event.correctionCount
          ? `${formatNumber(event.correctionUnits, 2)} E in ` +
            `${event.correctionCount} Korrektur(en): ${correctionDetails}`
          : 'keine Korrektur ab 20 Uhr';
        const decline = event.correctionCount
          ? event.decline
            ? `stabil bestätigter Rückgang ${formatNumber(event.minutesCorrectionToDecline, 0)} ` +
              'Min. nach erster Korrektur'
            : 'kein stabil bestätigter Rückgang bis 24 Uhr'
          : 'Rückgang nach Korrektur nicht anwendbar';
        return `<section class="night-rise-event"><strong>${formatDate(event.start)} · ` +
          'Korrekturfenster ab 20:00 Uhr</strong>' +
          `<p>${curve} · ${correction} · ${decline}</p></section>`;
      }).join('')
      : '<p class="muted">Noch keine Korrektur ab 20 Uhr und kein mahlzeitenfreier ' +
        'Anstieg im Zeitfenster erkannt.</p>';

    target.innerHTML = '<div class="analysis-grid insulin-summary">' +
      summary.map(([label, value]) => `<div><span>${escapeHtml(label)}</span>` +
        `<strong>${escapeHtml(value)}</strong></div>`).join('') +
      `</div><div style="margin-top:12px">${events}</div>` +
      '<details class="feedback-cause-details"><summary>Definition und Grenzen anzeigen</summary>' +
      '<p>Als Korrektur zählt jeder positive Pumpenbolus ohne positive Kohlenhydratangabe; ' +
      'die Typbezeichnung wie „Normal“ oder „Korrektur“ ist dafür unerheblich. Positive ' +
      'manuelle Insulingaben werden ebenfalls als Korrektur erfasst. Alle solchen Gaben ' +
      'zwischen 20:00 und 24:00 Uhr werden gezählt, auch wenn zuvor Mahlzeitenkontext vorlag. ' +
      'Mahlzeiten- oder Kohlenhydratangaben zwischen 18:00 und 24:00 Uhr schließen nur die ' +
      'Bewertung als mahlzeitenfreien Anstieg aus; sie ändern nicht die Klassifikation eines ' +
      'kohlenhydratfreien Bolus. Der Median verwendet die gesamte Korrekturmenge je Abend bis ' +
      '24:00 Uhr und endet nicht beim ersten beobachteten Rückgang. Der Verlauf allein beweist ' +
      'keine Ursache oder Insulinwirkung.</p></details>';
  }

  function applyCombinedFeedbackAnalyses() {
    if (typeof document === 'undefined') return;
    renderMealTiming();
    renderNightRise();
  }

  function installBrowserPatch() {
    if (root?.GlucoseCoachFeedbackUi) {
      root.GlucoseCoachFeedbackUi.buildNightRiseAnalysis = buildNightRiseAnalysis;
    }
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

  const api = {
    buildCombinedAnalysisDiary,
    buildNightRiseAnalysis,
    allCorrectionBoluses,
    applyCombinedFeedbackAnalyses,
    EVENING_START_HOUR,
    MEAL_CONTEXT_START_HOUR,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachFeedbackGlooko = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
