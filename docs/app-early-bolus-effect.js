(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const PRE_MINUTES = 30;
  const POST_MINUTES = 75;
  const OTHER_BOLUS_LOOKBACK_MINUTES = 90;
  const OTHER_BOLUS_LOOKAHEAD_MINUTES = 75;
  const MEAL_LOOKBACK_MINUTES = 180;
  const MEAL_LOOKAHEAD_MINUTES = 90;
  const EXERCISE_LOOKBACK_MINUTES = 60;
  const EXERCISE_LOOKAHEAD_MINUTES = 75;
  const MIN_CGM_COVERAGE = 0.80;
  const MAX_CGM_GAP_MINUTES = 15;
  const MIN_PRE_POINTS = 5;
  const MIN_BASELINE_MGDL = 70;
  const MIN_PRE_SLOPE_MGDL_PER_MINUTE = 0.05;
  const MAX_PRE_SLOPE_MGDL_PER_MINUTE = 2;
  const MAX_PROJECTED_SLOPE_MGDL_PER_MINUTE = 1.5;
  const MAX_PRE_DECELERATION_MGDL_PER_MINUTE = 0.3;
  const PRE_DECLINE_TOLERANCE_MGDL = 2;
  const TREND_PROJECTION_MINUTES = 45;
  const ONSET_MIN_OFFSET_MINUTES = 15;
  const ONSET_MAX_OFFSET_MINUTES = 60;
  const ONSET_EFFECT_MGDL = 5;
  const ONSET_CONFIRMED_MGDL = 8;
  const ONSET_POINTS = 4;
  const ONSET_CONFIRMATION_MINUTES = 14;
  const MIN_AGGREGATE_EVENTS = 3;
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);

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

  function parseTime(value) {
    const source = String(value ?? '').trim();
    if (!source) return null;
    const german = source.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})/);
    if (german) {
      const date = new Date(
        Number(german[3]),
        Number(german[2]) - 1,
        Number(german[1]),
        Number(german[4]),
        Number(german[5]),
      );
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
    }
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
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

  function exactCgmRows(cgm) {
    const map = new Map();
    for (const row of cgm || []) {
      const minute = finite(row?.[0]);
      const value = finite(row?.[1]);
      if (minute === null || value === null) continue;
      map.set(minute, [minute, value]);
    }
    return [...map.values()].sort((a, b) => a[0] - b[0]);
  }

  function pumpBoluses(clinical) {
    return (clinical?.boluses || [])
      .filter((row) => finite(row?.[0]) !== null && finite(row?.[2]) > 0)
      .map((row, index) => ({
        id: `pump-${Number(row[0])}-${index}`,
        minute: Number(row[0]),
        carbs: finite(row[1]),
        units: Number(row[2]),
        source: 'Pumpe',
      }));
  }

  function manualBoluses(clinical) {
    return (clinical?.manualInsulin || [])
      .filter((row) => finite(row?.[0]) !== null && finite(row?.[2]) > 0)
      .map((row, index) => ({
        id: `manual-${Number(row[0])}-${index}`,
        minute: Number(row[0]),
        carbs: null,
        units: Number(row[2]),
        source: 'manuell',
      }));
  }

  function allBoluses(clinical) {
    const events = [...pumpBoluses(clinical), ...manualBoluses(clinical)]
      .sort((a, b) => a.minute - b.minute);
    const deduplicated = [];
    for (const event of events) {
      const duplicate = deduplicated.some(
        (other) => Math.abs(other.minute - event.minute) <= 1 &&
          Math.abs(other.units - event.units) < 0.01,
      );
      if (!duplicate) deduplicated.push(event);
    }
    return deduplicated;
  }

  function localDayKey(minute) {
    const date = new Date(minute * MINUTE_MS);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function contextIndex(clinical, diary) {
    return {
      meals: (diary || [])
        .filter((entry) => MEAL_OCCASIONS.has(entry?.occasion))
        .map((entry) => parseTime(entry.when))
        .filter(Number.isFinite),
      illnessDays: new Set(
        (diary || [])
          .filter((entry) => entry?.illness === 'ja')
          .map((entry) => parseTime(entry.when))
          .filter(Number.isFinite)
          .map(localDayKey),
      ),
      diaryActivity: (diary || [])
        .map((entry) => ({ minute: parseTime(entry?.when), value: String(entry?.activity || '') }))
        .filter((item) => Number.isFinite(item.minute) && item.value.trim()),
      diaryHypo: (diary || [])
        .map((entry) => ({
          minute: parseTime(entry?.when),
          text: `${entry?.occasion || ''} ${entry?.food || ''} ${entry?.notes || ''}`,
        }))
        .filter((item) => Number.isFinite(item.minute) && /unterzucker|hypo|traubenzucker|saft|zucker/i.test(item.text)),
      foodEvents: clinical?.foodEvents || [],
      cgmCarbs: clinical?.cgmCarbs || [],
      exerciseEvents: clinical?.exerciseEvents || [],
      basalEvents: clinical?.basalEvents || [],
      alarms: clinical?.alarms || [],
    };
  }

  function rowsBetween(rows, start, end) {
    return rows.filter((row) => row[0] >= start && row[0] <= end);
  }

  function eventWithin(rows, start, end, predicate = () => true) {
    return (rows || []).some(
      (row) => Array.isArray(row) && Number(row[0]) >= start && Number(row[0]) <= end && predicate(row),
    );
  }

  function positiveCarbContext(event, allEvents, context) {
    const start = event.minute - MEAL_LOOKBACK_MINUTES;
    const end = event.minute + MEAL_LOOKAHEAD_MINUTES;
    return allEvents.some(
      (other) => finite(other.carbs) > 0 && other.minute >= start && other.minute <= end,
    ) || context.meals.some((minute) => minute >= start && minute <= end) ||
      eventWithin(context.foodEvents, start, end) ||
      eventWithin(context.cgmCarbs, start, end, (row) => finite(row?.[1]) > 0);
  }

  function basalDisturbance(context, start, end) {
    return (context.basalEvents || []).some((row) => {
      if (!Array.isArray(row) || Number(row[0]) < start || Number(row[0]) > end) return false;
      const label = String(row[1] || '').toLocaleLowerCase('de-DE');
      const percentage = finite(row[3]);
      const rate = finite(row[4]);
      return /temp|tempor|unterbrech|suspend|stop|reduz|erhöh|activity|sport/.test(label) ||
        (percentage !== null && Math.abs(percentage - 100) > 0.1) ||
        rate === 0;
    });
  }

  function pumpDisturbance(context, start, end) {
    return (context.alarms || []).some((row) => {
      if (!Array.isArray(row) || Number(row[0]) < start || Number(row[0]) > end) return false;
      return /okklusion|kanül|reservoir|insulinabgabe|unterbrochen|fehler/i.test(String(row[1] || ''));
    });
  }

  function maxGap(rows) {
    let result = 0;
    for (let index = 1; index < rows.length; index += 1) {
      result = Math.max(result, rows[index][0] - rows[index - 1][0]);
    }
    return result;
  }

  function smoothRows(rows) {
    return rows.map((row, index) => {
      const values = rows
        .slice(Math.max(0, index - 1), Math.min(rows.length, index + 2))
        .map((candidate) => candidate[1]);
      return [row[0], median(values)];
    });
  }

  function linearSlope(rows) {
    if (rows.length < 2) return null;
    const xMean = rows.reduce((sum, row) => sum + row[0], 0) / rows.length;
    const yMean = rows.reduce((sum, row) => sum + row[1], 0) / rows.length;
    const numerator = rows.reduce(
      (sum, row) => sum + (row[0] - xMean) * (row[1] - yMean),
      0,
    );
    const denominator = rows.reduce(
      (sum, row) => sum + (row[0] - xMean) ** 2,
      0,
    );
    return denominator ? numerator / denominator : 0;
  }

  function onsetFromEffect(effectRows) {
    for (let index = 0; index <= effectRows.length - ONSET_POINTS; index += 1) {
      const group = effectRows.slice(index, index + ONSET_POINTS);
      if (group[0].offset < ONSET_MIN_OFFSET_MINUTES) continue;
      if (group[0].offset > ONSET_MAX_OFFSET_MINUTES) break;
      if (group.at(-1).offset - group[0].offset < ONSET_CONFIRMATION_MINUTES) continue;
      if (
        group[0].effect >= ONSET_EFFECT_MGDL &&
        group.slice(1).every((row) => row.effect >= ONSET_EFFECT_MGDL - 2) &&
        group.at(-1).effect >= ONSET_CONFIRMED_MGDL
      ) {
        return group[0];
      }
    }
    return null;
  }

  function analyzeEvent(event, allEvents, exactCgm, context) {
    const start = event.minute - PRE_MINUTES;
    const end = event.minute + POST_MINUTES;
    const rawWindow = rowsBetween(exactCgm, start, end);
    const smoothedWindow = smoothRows(rawWindow);
    const pre = smoothedWindow.filter((row) => row[0] <= event.minute);
    const post = smoothedWindow.filter((row) => row[0] >= event.minute);
    const expectedPoints = Math.floor((end - start) / 5) + 1;
    const coverage = expectedPoints ? rawWindow.length / expectedPoints : 0;
    const gap = maxGap(rawWindow);
    const baseline = median(pre.slice(-3).map((row) => row[1]));
    const preSlope = linearSlope(pre);
    const earlyPreSlope = linearSlope(
      pre.filter((row) => row[0] >= event.minute - PRE_MINUTES && row[0] <= event.minute - 15),
    );
    const latePreSlope = linearSlope(
      pre.filter((row) => row[0] >= event.minute - 15 && row[0] <= event.minute),
    );

    const exclusionReasons = [];
    const otherBolus = allEvents.some(
      (other) => other.id !== event.id &&
        other.minute >= event.minute - OTHER_BOLUS_LOOKBACK_MINUTES &&
        other.minute <= event.minute + OTHER_BOLUS_LOOKAHEAD_MINUTES,
    );
    const exercise = eventWithin(
      context.exerciseEvents,
      event.minute - EXERCISE_LOOKBACK_MINUTES,
      event.minute + EXERCISE_LOOKAHEAD_MINUTES,
    ) || context.diaryActivity.some(
      (item) => item.minute >= event.minute - EXERCISE_LOOKBACK_MINUTES &&
        item.minute <= event.minute + EXERCISE_LOOKAHEAD_MINUTES,
    );
    const hypoTreatment = context.diaryHypo.some(
      (item) => item.minute >= event.minute - 60 && item.minute <= end,
    );
    if (positiveCarbContext(event, allEvents, context)) exclusionReasons.push('Mahlzeiten-/KH-Kontext im frühen Fenster');
    if (otherBolus) exclusionReasons.push('weiterer Bolus im frühen Isolationsfenster');
    if (exercise) exclusionReasons.push('Sport/Aktivität im frühen Einflussfenster');
    if (hypoTreatment) exclusionReasons.push('mögliche Hypobehandlung im frühen Einflussfenster');
    if (context.illnessDays.has(localDayKey(event.minute))) exclusionReasons.push('Krankheit am Ereignistag');
    if (basalDisturbance(context, event.minute - 60, end)) {
      exclusionReasons.push('veränderte oder unterbrochene Basalabgabe');
    }
    if (pumpDisturbance(context, event.minute - 60, end)) {
      exclusionReasons.push('Pumpen-/Pod-Störung im frühen Einflussfenster');
    }
    if (pre.length < MIN_PRE_POINTS) exclusionReasons.push('zu wenige CGM-Werte vor dem Bolus');
    if (coverage < MIN_CGM_COVERAGE) exclusionReasons.push('CGM-Abdeckung unter 80 %');
    if (gap > MAX_CGM_GAP_MINUTES) exclusionReasons.push('CGM-Lücke über 15 Minuten');
    if (!Number.isFinite(baseline)) exclusionReasons.push('kein belastbarer Ausgangswert');
    if (Number.isFinite(baseline) && baseline < MIN_BASELINE_MGDL) {
      exclusionReasons.push('Ausgangswert unter 70 mg/dl');
    }
    if (!Number.isFinite(preSlope) || !Number.isFinite(earlyPreSlope) || !Number.isFinite(latePreSlope)) {
      exclusionReasons.push('Ausgangstrend nicht belastbar');
    } else {
      if (
        preSlope < MIN_PRE_SLOPE_MGDL_PER_MINUTE ||
        preSlope > MAX_PRE_SLOPE_MGDL_PER_MINUTE
      ) exclusionReasons.push('kein moderat ansteigender Ausgangstrend');
      if (latePreSlope < 0) exclusionReasons.push('CGM fällt bereits unmittelbar vor dem Bolus');
      if (earlyPreSlope - latePreSlope > MAX_PRE_DECELERATION_MGDL_PER_MINUTE) {
        exclusionReasons.push('CGM-Anstieg wird bereits vor dem Bolus deutlich schwächer');
      }
      if (pre.length >= 3 && pre.at(-1)[1] < pre.at(-3)[1] - PRE_DECLINE_TOLERANCE_MGDL) {
        exclusionReasons.push('kurzer Rückgang bereits vor dem Bolus');
      }
    }

    const eligible = exclusionReasons.length === 0;
    const projectedSlope = Number.isFinite(preSlope)
      ? Math.max(0, Math.min(MAX_PROJECTED_SLOPE_MGDL_PER_MINUTE, preSlope))
      : 0;
    const effectRows = eligible
      ? post.map((row) => {
          const offset = row[0] - event.minute;
          const expected = baseline + projectedSlope * Math.min(Math.max(offset, 0), TREND_PROJECTION_MINUTES);
          return {
            minute: row[0],
            offset,
            observed: row[1],
            expected,
            effect: expected - row[1],
          };
        })
      : [];
    const onset = onsetFromEffect(effectRows);

    return {
      ...event,
      eligibleEarlyEffect: eligible,
      detectableEarlyEffect: Boolean(eligible && onset),
      earlyEffectExclusionReasons: [...new Set(exclusionReasons)],
      earlyEffectOnset: onset?.offset ?? null,
      earlyEffectAtOnset: onset ? round(onset.effect, 1) : null,
      earlyEffectCoverage: round(coverage * 100, 1),
      earlyEffectMaxCgmGap: gap,
      earlyEffectBaseline: round(baseline, 1),
      earlyEffectPreSlope: round(preSlope, 3),
      earlyEffectEarlyPreSlope: round(earlyPreSlope, 3),
      earlyEffectLatePreSlope: round(latePreSlope, 3),
    };
  }

  function confidenceFor(onset) {
    if (!onset || onset.n < MIN_AGGREGATE_EVENTS) return 'nicht ausreichend';
    let level = onset.n >= 12 ? 3 : onset.n >= 6 ? 2 : 1;
    if (Number.isFinite(onset.q1) && Number.isFinite(onset.q3) && onset.q3 - onset.q1 > 20) {
      level -= 1;
    }
    return ['niedrig', 'niedrig', 'mittel', 'hoch'][Math.max(0, level)];
  }

  function analyzeEarlyBolusEffect(clinical = {}, diary = []) {
    const exactCgm = exactCgmRows(clinical.cgm);
    const events = allBoluses(clinical);
    const context = contextIndex(clinical, diary);
    const corrections = events.filter((event) => !(finite(event.carbs) > 0));
    const analyses = corrections.map((event) => analyzeEvent(event, events, exactCgm, context));
    const eligible = analyses.filter((event) => event.eligibleEarlyEffect);
    const detectable = analyses.filter((event) => event.detectableEarlyEffect);
    const onset = distribution(detectable.map((event) => event.earlyEffectOnset));
    return {
      events: analyses,
      aggregate: {
        totalBoluses: events.length,
        correctionBoluses: corrections.length,
        eligibleCorrections: eligible.length,
        analyzedCorrections: detectable.length,
        excludedCorrections: analyses.length - eligible.length,
        sufficient: detectable.length >= MIN_AGGREGATE_EVENTS,
        confidence: confidenceFor(onset),
        onset,
      },
    };
  }

  function formatNumber(value, digits = 0) {
    return Number.isFinite(Number(value))
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value))
      : '–';
  }

  function formatMean(item) {
    if (!item || !item.n || !Number.isFinite(item.mean)) return 'nicht bestimmbar';
    return `Ø ${formatNumber(item.mean, 0)} min · ${item.n} Verläufe`;
  }

  function formatOnset(aggregate) {
    const onset = aggregate?.onset || {};
    if (!aggregate?.sufficient || !onset.n || !Number.isFinite(onset.median)) {
      return `zu wenige geeignete Verläufe (${onset.n || 0})`;
    }
    return `${formatNumber(onset.median, 0)} min · mittlere 50 %: ` +
      `${formatNumber(onset.q1, 0)}–${formatNumber(onset.q3, 0)} min · ${onset.n} Verläufe`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function combinedDiary(localDiary, clinical) {
    const mode = root?.GlucoseCoachGlookoMode;
    if (typeof mode?.buildAnalysisDiary === 'function') {
      return mode.buildAnalysisDiary(localDiary || [], clinical || {});
    }
    return Array.isArray(localDiary) ? localDiary : [];
  }

  function renderEarlyEffect() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined') return;
    const card = document.querySelector('#all-bolus-phases-card');
    const target = card?.querySelector('#all-bolus-phase-summary');
    if (!card || !target) return;
    const clinical = gcState.clinical && typeof gcState.clinical === 'object'
      ? gcState.clinical
      : {};
    const diary = combinedDiary(gcState.diary || [], clinical);
    const early = analyzeEarlyBolusEffect(clinical, diary).aggregate;
    const phaseApi = root?.GlucoseCoachV3?.analyzeAllBolusPhases ||
      root?.GlucoseCoachAllBolusPhases?.analyzeAllBolusPhases;
    const phases = typeof phaseApi === 'function' ? phaseApi(clinical).aggregate : {};

    const title = card.querySelector('h2');
    if (title) title.textContent = 'Frühe Gegenwirkung und spätere CGM-Kurvenphasen';
    const cards = [
      ['positive Boli geprüft', phases.totalBoluses ?? early.totalBoluses],
      ['mit ausreichendem CGM-Fenster', phases.cgmUsableBoluses ?? '–'],
      ['frühe trendbereinigte Gegenwirkung', formatOnset(early)],
      ['spätere Abflachung des Netto-Anstiegs', formatMean(phases.slowdown)],
      ['späterer Wendepunkt', formatMean(phases.turn)],
      ['stabiler Rückgang beginnt', formatMean(phases.decline)],
    ];
    target.innerHTML = cards.map(([label, value]) =>
      `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    ).join('');

    let details = card.querySelector('#all-bolus-explanation');
    if (!details) {
      details = document.createElement('details');
      details.id = 'all-bolus-explanation';
      details.className = 'explanation-disclosure';
      target.insertAdjacentElement('afterend', details);
    }
    details.innerHTML = '<summary>Berechnung und Grenzen anzeigen</summary>' +
      '<p>Die frühe Zahl wird ausschließlich aus Korrekturboli ohne positive KH-Angabe ' +
      'berechnet. Verwendet werden nur kurze Verläufe mit ansteigendem Ausgangstrend, ohne ' +
      'Mahlzeitenkontext in den drei Stunden davor, ohne weiteren Bolus von 90 Minuten davor ' +
      'bis 75 Minuten danach und mit ausreichender CGM-Abdeckung. Gesucht wird ab Minute 15 ' +
      'die erste über mehrere Werte bestätigte Abweichung unter dem aus dem Vortrend ' +
      'fortgeschriebenen CGM-Verlauf. Das ist der früheste in den Daten erkennbare Nettoeffekt, ' +
      'nicht der pharmakologisch exakt gemessene Wirkeintritt. Die spätere Abflachung wartet ' +
      'dagegen erst auf den steilsten 15-Minuten-Anstieg und anschließend mehrere bestätigende ' +
      'Werte; sie liegt deshalb typischerweise deutlich später und darf nicht als Wirkbeginn ' +
      'interpretiert werden.</p>';
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    if (root?.__glucoseCoachEarlyBolusEffectInstalled) {
      renderEarlyEffect();
      return;
    }
    if (root) root.__glucoseCoachEarlyBolusEffectInstalled = true;
    const previousRender = gcRender;
    gcRender = function renderWithEarlyBolusEffect() {
      previousRender();
      renderEarlyEffect();
    };
    if (typeof GlucoseCoachV3 !== 'undefined') {
      Object.assign(GlucoseCoachV3, { analyzeEarlyBolusEffect });
    }
    renderEarlyEffect();
  }

  const api = {
    analyzeEarlyBolusEffect,
    onsetFromEffect,
    allBoluses,
    MIN_AGGREGATE_EVENTS,
    PRE_MINUTES,
    POST_MINUTES,
    ONSET_MIN_OFFSET_MINUTES,
    ONSET_MAX_OFFSET_MINUTES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachEarlyBolusEffect = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
