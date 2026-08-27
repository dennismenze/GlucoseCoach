(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const MIN_MEAL_RISE_EVENTS = 2;
  const MIN_BOLUS_COUNTERACTION_EVENTS = 2;
  const MAX_ABSOLUTE_OFFSET_MINUTES = 60;

  const TIMING_BUCKETS = [
    { key: 'early', min: Number.NEGATIVE_INFINITY, max: -20, label: 'mindestens 20 Min. vor dem Essen' },
    { key: 'before', min: -19, max: -10, label: '10–19 Min. vor dem Essen' },
    { key: 'around', min: -9, max: 5, label: 'kurz vor bis 5 Min. nach dem Essen' },
    { key: 'after', min: 6, max: 20, label: '6–20 Min. nach dem Essen' },
    { key: 'late', min: 21, max: Number.POSITIVE_INFINITY, label: 'mehr als 20 Min. nach dem Essen' },
  ];

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function round(value, digits = 0) {
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

  function quantile(values, fraction) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return null;
    if (valid.length === 1) return valid[0];
    const position = (valid.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return valid[lower];
    const weight = position - lower;
    return valid[lower] * (1 - weight) + valid[upper] * weight;
  }

  function distribution(values) {
    const valid = values.filter(Number.isFinite);
    return {
      n: valid.length,
      median: round(median(valid), 0),
      q1: round(quantile(valid, 0.25), 0),
      q3: round(quantile(valid, 0.75), 0),
    };
  }

  function normalizeFood(value) {
    return String(value ?? '').trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
  }

  function timingBucket(offset) {
    const numeric = finite(offset);
    if (numeric === null) return null;
    return TIMING_BUCKETS.find((bucket) => numeric >= bucket.min && numeric <= bucket.max) || null;
  }

  function formatNumber(value, digits = 0) {
    return Number.isFinite(Number(value))
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value))
      : '–';
  }

  function formatBolusTiming(offset) {
    const minutes = round(finite(offset), 0);
    if (minutes === null) return 'nicht bestimmbar';
    if (minutes < 0) return `${Math.abs(minutes)} Min. vor dem Essen`;
    if (minutes > 0) return `${minutes} Min. nach Essensbeginn`;
    return 'zum Essensbeginn';
  }

  function formatBolusTimingRange(lowerOffset, upperOffset) {
    const lower = round(Math.min(lowerOffset, upperOffset), 0);
    const upper = round(Math.max(lowerOffset, upperOffset), 0);
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
    if (lower === upper) return formatBolusTiming(lower);
    if (upper < 0) return `${Math.abs(upper)}–${Math.abs(lower)} Min. vor dem Essen`;
    if (lower > 0) return `${lower}–${upper} Min. nach Essensbeginn`;
    if (lower === 0) return `zum Essensbeginn bis ${upper} Min. danach`;
    if (upper === 0) return `${Math.abs(lower)} Min. vorher bis zum Essensbeginn`;
    return `${Math.abs(lower)} Min. vorher bis ${upper} Min. danach`;
  }

  function aggregateBolusCounteraction(bolusPhases) {
    const aggregate = bolusPhases?.aggregate || bolusPhases || {};
    const slowdown = aggregate?.slowdown || {};
    const n = finite(slowdown.n) || 0;
    const medianValue = finite(slowdown.median);
    const q1 = finite(slowdown.q1);
    const q3 = finite(slowdown.q3);
    return {
      sufficient: n >= MIN_BOLUS_COUNTERACTION_EVENTS && medianValue !== null,
      n,
      median: medianValue === null ? null : round(medianValue, 0),
      q1: q1 === null ? null : round(q1, 0),
      q3: q3 === null ? null : round(q3, 0),
    };
  }

  function buildObservedBands(events) {
    const bands = TIMING_BUCKETS.map((bucket) => {
      const matching = events.filter((event) => event.bucket?.key === bucket.key);
      return {
        key: bucket.key,
        label: bucket.label,
        observations: matching.length,
        medianPeakDelta: round(median(matching.map((event) => event.peakDelta)), 0),
        medianTwoHourDelta: round(
          median(matching.map((event) => event.twoHourDelta).filter(Number.isFinite)),
          0,
        ),
      };
    }).filter((band) => band.observations > 0);

    const candidates = bands.filter(
      (band) => band.observations >= 2 && Number.isFinite(band.medianPeakDelta),
    );
    const best = [...candidates].sort(
      (a, b) => a.medianPeakDelta - b.medianPeakDelta || b.observations - a.observations,
    )[0] || null;

    return {
      bands,
      best,
      comparable: events.length >= 4 && bands.length >= 2 && Boolean(best),
    };
  }

  function confidenceForAlignment(rise, counteraction, observedConsistent) {
    if (rise.n < MIN_MEAL_RISE_EVENTS || !counteraction.sufficient) return 'nicht ausreichend';
    let score = 0;
    if (rise.n >= 4) score += 1;
    if (rise.n >= 7) score += 1;
    if (counteraction.n >= 4) score += 1;
    if (counteraction.n >= 8) score += 1;
    if (
      Number.isFinite(counteraction.q1) && Number.isFinite(counteraction.q3) &&
      counteraction.q3 - counteraction.q1 <= 20
    ) score += 1;
    if (observedConsistent) score += 1;
    if (score >= 5) return 'hoch';
    if (score >= 3) return 'mittel';
    return 'niedrig';
  }

  function buildMealBolusAlignmentInsights(analyses = [], bolusPhases = null) {
    const groups = new Map();
    for (const analysis of analyses || []) {
      const label = String(analysis?.entry?.food ?? '').trim();
      const key = normalizeFood(label);
      const offset = finite(analysis?.bolusOffset);
      if (!key || offset === null) continue;
      if (!groups.has(key)) groups.set(key, { key, label, events: [] });
      groups.get(key).events.push({
        offset,
        complete: Boolean(analysis?.complete),
        peakDelta: finite(analysis?.peakDelta),
        twoHourDelta: finite(analysis?.twoHourDelta),
        minutesToRise: finite(analysis?.minutesToRise),
        minute: finite(analysis?.minute),
        bucket: timingBucket(offset),
      });
    }

    const counteraction = aggregateBolusCounteraction(bolusPhases);
    return [...groups.values()]
      .filter((group) => group.events.length >= 2)
      .map((group) => {
        const peakEvents = group.events.filter(
          (event) => event.complete && event.bucket && event.peakDelta !== null,
        );
        const observed = buildObservedBands(peakEvents);
        const rise = distribution(
          group.events
            .map((event) => event.minutesToRise)
            .filter((value) => Number.isFinite(value) && value >= 0),
        );

        let alignment = {
          available: false,
          reason: rise.n < MIN_MEAL_RISE_EVENTS
            ? 'too-few-rise-events'
            : 'bolus-counteraction-unavailable',
          offsetMinutes: null,
          label: null,
          rangeLabel: null,
          rise,
          counteraction,
          observedConsistent: false,
          confidence: 'nicht ausreichend',
        };

        if (rise.n >= MIN_MEAL_RISE_EVENTS && counteraction.sufficient) {
          const rawOffset = rise.median - counteraction.median;
          if (Math.abs(rawOffset) <= MAX_ABSOLUTE_OFFSET_MINUTES) {
            const lower = Number.isFinite(rise.q1) && Number.isFinite(counteraction.q3)
              ? rise.q1 - counteraction.q3
              : rawOffset;
            const upper = Number.isFinite(rise.q3) && Number.isFinite(counteraction.q1)
              ? rise.q3 - counteraction.q1
              : rawOffset;
            const targetBucket = timingBucket(rawOffset);
            const observedConsistent = Boolean(
              observed.best && targetBucket && observed.best.key === targetBucket.key,
            );
            alignment = {
              available: true,
              reason: null,
              offsetMinutes: round(rawOffset, 0),
              label: formatBolusTiming(rawOffset),
              rangeLowerOffset: round(lower, 0),
              rangeUpperOffset: round(upper, 0),
              rangeLabel: formatBolusTimingRange(lower, upper),
              rise,
              counteraction,
              targetBucket: targetBucket?.key || null,
              observedConsistent,
              confidence: confidenceForAlignment(rise, counteraction, observedConsistent),
            };
          } else {
            alignment.reason = 'outside-analysis-window';
          }
        }

        return {
          key: group.key,
          label: group.label,
          observations: group.events.length,
          riseObservations: rise.n,
          peakObservations: peakEvents.length,
          bands: observed.bands,
          best: observed.best,
          comparable: observed.comparable,
          alignment,
        };
      })
      .filter((insight) => insight.riseObservations >= 2 || insight.peakObservations >= 2)
      .sort((a, b) => b.observations - a.observations || a.label.localeCompare(b.label, 'de'));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function ensureStyles() {
    if (typeof document === 'undefined' || document.querySelector('#meal-bolus-alignment-styles')) return;
    const style = document.createElement('style');
    style.id = 'meal-bolus-alignment-styles';
    style.textContent = `
      .meal-bolus-target { margin:8px 0; font-size:1.08rem; }
      .meal-bolus-explanation { margin:8px 0; }
      .meal-bolus-meta { margin:8px 0 0; color:var(--muted); }
      .meal-bolus-observations { margin-top:10px; }
      .meal-bolus-observations > summary { cursor:pointer; font-weight:800; }
      .meal-bolus-observations .timing-band-list { margin-top:8px; }
    `;
    document.head.appendChild(style);
  }

  function renderObservedComparison(insight) {
    if (!insight.bands.length) {
      return '<p class="muted">Für den zusätzlichen Peakvergleich fehlen vollständige Verläufe.</p>';
    }
    const rows = insight.bands.map((band) =>
      `<div><span>${escapeHtml(band.label)} · ${band.observations} Beobachtung(en)</span>` +
      `<strong>${formatNumber(band.medianPeakDelta, 0)} mg/dl Peak-Anstieg</strong></div>`,
    ).join('');
    const result = insight.comparable
      ? `<p>Der kleinste bisher beobachtete Peak-Median lag bei <strong>` +
        `${escapeHtml(insight.best.label)}</strong>: ${formatNumber(insight.best.medianPeakDelta, 0)} ` +
        `mg/dl aus ${insight.best.observations} Beobachtungen.</p>`
      : '<p class="muted">Noch nicht genügend vollständige Wiederholungen in mindestens zwei ' +
        'unterschiedlichen Zeitbereichen für einen belastbaren Peakvergleich.</p>';
    return `${result}<div class="timing-band-list">${rows}</div>`;
  }

  function formulaText(alignment) {
    const rise = alignment.rise.median;
    const counteraction = alignment.counteraction.median;
    const offset = alignment.offsetMinutes;
    if (offset < 0) {
      return `${formatNumber(counteraction, 0)} Min. bis zur beobachtbaren Gegenwirkung minus ` +
        `${formatNumber(rise, 0)} Min. bis zum typischen Mahlzeitenanstieg ergeben ` +
        `${formatNumber(Math.abs(offset), 0)} Min. Vorlauf.`;
    }
    if (offset > 0) {
      return `Der typische Mahlzeitenanstieg beginnt ${formatNumber(rise - counteraction, 0)} Min. ` +
        'später als die beobachtbare Gegenwirkung; daraus ergibt sich der Zeitpunkt nach Essensbeginn.';
    }
    return 'Typischer Mahlzeitenanstieg und beobachtbare Gegenwirkung haben denselben Zeitabstand.';
  }

  function renderAlignmentInsight(insight) {
    const alignment = insight.alignment;
    if (!alignment.available) {
      let missing = 'Noch kein konkreter Vorlauf berechenbar.';
      if (alignment.reason === 'too-few-rise-events') {
        missing += ` Der Beginn des Glukoseanstiegs ist erst in ${alignment.rise.n} ` +
          'geeigneten Verlauf/Verläufen bestimmbar; benötigt werden mindestens zwei.';
      } else if (alignment.reason === 'bolus-counteraction-unavailable') {
        missing += ` In den vorhandenen Bolusverläufen ist ein bereits laufender CGM-Anstieg erst ` +
          `in ${alignment.counteraction.n} Verlauf/Verläufen nach der Insulinabgabe klar schwächer ` +
          'geworden; benötigt werden mindestens zwei. Eine fünfstündige Isolation ist dafür nicht erforderlich.';
      } else {
        missing += ' Das rechnerische Ergebnis liegt außerhalb des analysierten ' +
          'Bolusfensters von 60 Minuten vor bis 60 Minuten nach Essensbeginn.';
      }
      return `<section class="timing-insight"><h3>${escapeHtml(insight.label)}</h3>` +
        `<p><strong>${escapeHtml(missing)}</strong></p>` +
        `<details class="meal-bolus-observations"><summary>Bisherige Peak-Verläufe anzeigen</summary>` +
        `${renderObservedComparison(insight)}</details></section>`;
    }

    const support = alignment.observedConsistent && insight.best
      ? `Der bisherige Peakvergleich passt zu dieser Schätzung: Im zugehörigen Zeitbereich ` +
        `war der Peak-Median mit ${formatNumber(insight.best.medianPeakDelta, 0)} mg/dl am kleinsten.`
      : insight.comparable && insight.best
        ? `Der bisherige Peakvergleich bestätigt diesen exakten Zeitpunkt noch nicht eindeutig; ` +
          `sein bislang kleinster Median lag im Bereich „${escapeHtml(insight.best.label)}“.`
        : 'Am berechneten Zeitpunkt liegen noch nicht genügend vollständige Wiederholungen für ' +
          'einen eigenständigen Peakvergleich vor.';

    return `<section class="timing-insight"><h3>${escapeHtml(insight.label)}</h3>` +
      `<p class="meal-bolus-target"><strong>Geschätzter Mahlzeitenbolus: ` +
      `${escapeHtml(alignment.label)}.</strong></p>` +
      `<p class="meal-bolus-explanation">Bei dieser Mahlzeit beginnt der Glukoseanstieg ` +
      `typischerweise nach ${formatNumber(alignment.rise.median, 0)} Min. ` +
      `(n=${alignment.rise.n}). In ${alignment.counteraction.n} auswertbaren Bolusverläufen mit zunächst klar ` +
      `ansteigender CGM-Kurve wurde der Anstieg nach ` +
      `${formatNumber(alignment.counteraction.median, 0)} Min. deutlich schwächer. Wenn der ` +
      `Mahlzeitenbolus bei dieser Mahlzeit ${escapeHtml(alignment.label)} abgegeben wird, fällt ` +
      `diese erste beobachtbare Gegenwirkung rechnerisch ungefähr mit dem Beginn des ` +
      `Mahlzeitenanstiegs zusammen.</p>` +
      `<p class="meal-bolus-meta">${escapeHtml(formulaText(alignment))} ` +
      `Schätzbereich: ${escapeHtml(alignment.rangeLabel || alignment.label)} · ` +
      `Datenlage: ${escapeHtml(alignment.confidence)}. ${support}</p>` +
      `<details class="meal-bolus-observations"><summary>Berechnung und beobachtete Verläufe anzeigen</summary>` +
      `${renderObservedComparison(insight)}</details></section>`;
  }

  function combinedDiary(localDiary, clinical) {
    const mode = root?.GlucoseCoachGlookoMode;
    if (typeof mode?.buildAnalysisDiary === 'function') {
      return mode.buildAnalysisDiary(localDiary || [], clinical || {});
    }
    return Array.isArray(localDiary) ? localDiary : [];
  }

  function ensureTimingCard() {
    let card = document.querySelector('#meal-timing-card');
    if (card) return card;
    const comparison = document.querySelector('#food-comparison')?.closest('article.card');
    if (!comparison) return null;
    card = document.createElement('article');
    card.id = 'meal-timing-card';
    card.className = 'card full';
    card.innerHTML = '<h2>Geschätzter Mahlzeitenbolus-Vorlauf</h2><div id="meal-timing-insights"></div>';
    comparison.insertAdjacentElement('afterend', card);
    return card;
  }

  function renderMealBolusAlignment() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined') return;
    const card = ensureTimingCard();
    const target = card?.querySelector('#meal-timing-insights');
    if (!card || !target) return;
    const title = card.querySelector('h2');
    if (title) title.textContent = 'Geschätzter Mahlzeitenbolus-Vorlauf';

    const clinical = gcState.clinical && typeof gcState.clinical === 'object'
      ? gcState.clinical
      : {};
    const diary = combinedDiary(gcState.diary || [], clinical);
    const analyzeMealsFunction = typeof analyzeMeals === 'function'
      ? analyzeMeals
      : root?.GlucoseCoachV3?.analyzeMeals;
    const analyzeBolusPhasesFunction = root?.GlucoseCoachV3?.analyzeAllBolusPhases ||
      root?.GlucoseCoachAllBolusPhases?.analyzeAllBolusPhases;
    if (typeof analyzeMealsFunction !== 'function') return;

    const analyses = analyzeMealsFunction(diary, clinical.cgm || [], clinical.boluses || []);
    const bolusPhases = typeof analyzeBolusPhasesFunction === 'function'
      ? analyzeBolusPhasesFunction(clinical)
      : null;
    const insights = buildMealBolusAlignmentInsights(analyses, bolusPhases);
    if (!insights.length) {
      target.innerHTML = '<p class="muted">Noch keine Mahlzeit ist oft genug mit erkennbarem ' +
        'Glukoseanstieg und zugeordnetem Mahlzeitenbolus auswertbar.</p>';
      return;
    }
    target.innerHTML = insights.map(renderAlignmentInsight).join('') +
      '<details class="feedback-cause-details"><summary>Grenzen der Schätzung anzeigen</summary>' +
      '<p>Der Vorlauf verbindet zwei persönliche CGM-Beobachtungen: den typischen Beginn des ' +
      'Anstiegs bei dieser Mahlzeit und den Zeitabstand, nach dem ein bereits laufender Anstieg ' +
      'in auswertbaren Verläufen nach einem positiven Bolus deutlich schwächer wurde. Dafür ist ' +
      'keine fünfstündige Isolation erforderlich; die frühe Auswertung endet beim nächsten Bolus ' +
      'oder spätestens nach drei Stunden. Das Abflachen kann außer durch Insulin auch durch ' +
      'Nahrungsverlauf, Basalabgabe, Aktivität, Krankheit, Gegenregulation und Sensorverzögerung ' +
      'beeinflusst sein. Die Zahl ist eine retrospektive Schätzung, keine automatische Änderung ' +
      'von Dosis oder Pumpeneinstellung.</p></details>';
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    if (root?.__glucoseCoachMealBolusAlignmentInstalled) {
      renderMealBolusAlignment();
      return;
    }
    if (root) root.__glucoseCoachMealBolusAlignmentInstalled = true;
    ensureStyles();
    const previousRender = gcRender;
    gcRender = function renderWithMealBolusAlignment() {
      previousRender();
      renderMealBolusAlignment();
    };
    renderMealBolusAlignment();
  }

  const api = {
    buildMealBolusAlignmentInsights,
    aggregateBolusCounteraction,
    formatBolusTiming,
    formatBolusTimingRange,
    timingBucket,
    renderAlignmentInsight,
    renderMealBolusAlignment,
    MIN_MEAL_RISE_EVENTS,
    MIN_BOLUS_COUNTERACTION_EVENTS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachMealBolusAlignment = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
