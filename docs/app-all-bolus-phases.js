(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const PRE_MINUTES = 30;
  const PHASE_WINDOW_MINUTES = 180;
  const MIN_AVAILABLE_POST_MINUTES = 30;
  const MIN_PRE_POINTS = 4;
  const MIN_POST_POINTS = 6;
  const MIN_CGM_COVERAGE = 0.70;
  const MAX_CGM_GAP_MINUTES = 15;
  const SLOPE_WINDOW_MINUTES = 15;
  const CLEAR_RISE_MGDL_PER_15_MIN = 6;
  const SLOWDOWN_FRACTION = 0.65;
  const SLOWDOWN_MIN_DROP_FROM_PEAK = 3;
  const SLOWDOWN_CONFIRM_POINTS = 3;
  const SLOWDOWN_CONFIRM_SPAN_MINUTES = 8;
  const TURN_CONFIRM_POINTS = 4;
  const TURN_CONFIRM_MINUTES = 15;
  const TURN_CONFIRM_MAX_MINUTES = 25;
  const TURN_MAX_POINT_GAP_MINUTES = 7;
  const TURN_DROP_MGDL = 8;
  const DECLINE_ONSET_DROP_MGDL = 3;
  const STEP_TOLERANCE_MGDL = 1;
  const REBOUND_TOLERANCE_MGDL = 1;

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

  function meanDistribution(values) {
    const valid = values.filter(Number.isFinite);
    return {
      n: valid.length,
      mean: valid.length
        ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 1)
        : null,
      median: round(median(valid), 1),
      q1: round(quantile(valid, 0.25), 1),
      q3: round(quantile(valid, 0.75), 1),
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
        units: Number(row[2]),
        carbs: finite(row[1]),
        source: 'Pumpe',
      }));
  }

  function manualBoluses(clinical) {
    return (clinical?.manualInsulin || [])
      .filter((row) => finite(row?.[0]) !== null && finite(row?.[2]) > 0)
      .map((row, index) => ({
        id: `manual-${Number(row[0])}-${index}`,
        minute: Number(row[0]),
        units: Number(row[2]),
        carbs: null,
        source: 'manuell',
      }));
  }

  function allPositiveBoluses(clinical) {
    const events = [...pumpBoluses(clinical), ...manualBoluses(clinical)]
      .sort((a, b) => a.minute - b.minute);
    const deduplicated = [];
    for (const event of events) {
      const duplicate = deduplicated.find((other) =>
        Math.abs(other.minute - event.minute) <= 1 &&
        Math.abs(other.units - event.units) < 0.01,
      );
      if (!duplicate) deduplicated.push(event);
    }
    return deduplicated;
  }

  function lowerBound(rows, target) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (rows[middle][0] < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function upperBound(rows, target) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (rows[middle][0] <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function rowsBetween(rows, start, end) {
    const first = lowerBound(rows, start);
    const last = upperBound(rows, end);
    return rows.slice(first, last);
  }

  function maxGap(rows) {
    let gap = 0;
    for (let index = 1; index < rows.length; index += 1) {
      gap = Math.max(gap, rows[index][0] - rows[index - 1][0]);
    }
    return gap;
  }

  function smoothRows(rows) {
    return rows.map((row, index) => {
      const values = rows
        .slice(Math.max(0, index - 1), Math.min(rows.length, index + 2))
        .map((candidate) => candidate[1]);
      return [row[0], median(values)];
    });
  }

  function closest(rows, target, tolerance = 7) {
    if (!rows.length) return null;
    const index = lowerBound(rows, target);
    const candidates = [rows[index - 1], rows[index]].filter(Boolean);
    const best = candidates.sort(
      (a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target),
    )[0] || null;
    return best && Math.abs(best[0] - target) <= tolerance ? best : null;
  }

  function slopeRows(rows, eventMinute) {
    const result = [];
    for (const row of rows) {
      const offset = row[0] - eventMinute;
      if (offset < SLOPE_WINDOW_MINUTES) continue;
      const previous = closest(rows, row[0] - SLOPE_WINDOW_MINUTES);
      if (!previous) continue;
      result.push({
        minute: row[0],
        offset,
        changePer15: row[1] - previous[1],
        value: row[1],
      });
    }
    return result;
  }

  function findRiseSlowdown(slopes) {
    let peak = null;
    for (let index = 0; index < slopes.length; index += 1) {
      const current = slopes[index];
      if (current.offset > 120) break;
      if (!peak || current.changePer15 > peak.changePer15) peak = current;
      if (!peak || peak.changePer15 < CLEAR_RISE_MGDL_PER_15_MIN) continue;
      if (current.offset < peak.offset + 10) continue;

      const threshold = Math.max(2, peak.changePer15 * SLOWDOWN_FRACTION);
      const sequence = slopes.slice(index, index + SLOWDOWN_CONFIRM_POINTS);
      if (sequence.length < SLOWDOWN_CONFIRM_POINTS) continue;
      if (sequence.at(-1).offset - sequence[0].offset < SLOWDOWN_CONFIRM_SPAN_MINUTES) continue;
      const changes = sequence.map((row) => row.changePer15);
      if (
        changes.every((value) => value <= threshold) &&
        median(changes) > 0 &&
        peak.changePer15 - median(changes) >= SLOWDOWN_MIN_DROP_FROM_PEAK
      ) {
        return {
          minute: current.minute,
          offset: current.offset,
          peakRise: round(peak.changePer15, 1),
          slowedRise: round(median(changes), 1),
        };
      }
    }
    return null;
  }

  function declineConfirmation(rows, startIndex) {
    const candidate = rows[startIndex];
    const future = [];
    let previousMinute = candidate[0];
    for (let index = startIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (row[0] - candidate[0] > TURN_CONFIRM_MAX_MINUTES) break;
      if (row[0] - previousMinute > TURN_MAX_POINT_GAP_MINUTES) break;
      future.push(row);
      previousMinute = row[0];
      if (future.length === TURN_CONFIRM_POINTS) break;
    }
    if (future.length < TURN_CONFIRM_POINTS) return null;
    if (future.at(-1)[0] - candidate[0] < TURN_CONFIRM_MINUTES) return null;
    return future;
  }

  function findTurnAndDecline(rows, eventMinute, startOffset) {
    const first = rows.findIndex((row) => row[0] >= eventMinute + startOffset);
    if (first < 0) return null;

    for (let index = first; index < rows.length; index += 1) {
      const candidate = rows[index];
      const future = declineConfirmation(rows, index);
      if (!future) continue;
      const sequence = [candidate, ...future];
      const steps = future.map((row, stepIndex) => row[1] - sequence[stepIndex][1]);
      const confirmedDrop = candidate[1] - future.at(-1)[1];
      const highestFuture = Math.max(...future.map((row) => row[1]));
      if (
        steps.filter((delta) => delta <= STEP_TOLERANCE_MGDL).length >= TURN_CONFIRM_POINTS - 1 &&
        confirmedDrop >= TURN_DROP_MGDL &&
        highestFuture <= candidate[1] + REBOUND_TOLERANCE_MGDL
      ) {
        const decline = future.find(
          (row) => candidate[1] - row[1] >= DECLINE_ONSET_DROP_MGDL,
        ) || future[0];
        return {
          turnMinute: candidate[0],
          turnOffset: candidate[0] - eventMinute,
          declineMinute: decline[0],
          declineOffset: decline[0] - eventMinute,
          confirmedDrop: round(confirmedDrop, 1),
        };
      }
    }
    return null;
  }

  function analyzeBolusPhases(event, nextEvent, exactCgm) {
    const naturalEnd = event.minute + PHASE_WINDOW_MINUTES;
    const end = nextEvent && nextEvent.minute < naturalEnd
      ? nextEvent.minute - 1
      : naturalEnd;
    const availablePostMinutes = Math.max(0, end - event.minute);
    const start = event.minute - PRE_MINUTES;
    const rawWindow = rowsBetween(exactCgm, start, end);
    const pre = rawWindow.filter((row) => row[0] <= event.minute);
    const post = rawWindow.filter((row) => row[0] >= event.minute);
    const expectedPoints = Math.floor((end - start) / 5) + 1;
    const coverage = expectedPoints > 0 ? rawWindow.length / expectedPoints : 0;
    const gap = maxGap(rawWindow);
    const reasons = [];
    if (availablePostMinutes < MIN_AVAILABLE_POST_MINUTES) reasons.push('nächster Bolus vor 30 Minuten');
    if (pre.length < MIN_PRE_POINTS) reasons.push('zu wenige CGM-Werte vor dem Bolus');
    if (post.length < MIN_POST_POINTS) reasons.push('zu wenige CGM-Werte nach dem Bolus');
    if (coverage < MIN_CGM_COVERAGE) reasons.push('CGM-Abdeckung unter 70 %');
    if (gap > MAX_CGM_GAP_MINUTES) reasons.push('CGM-Lücke über 15 Minuten');

    const usable = reasons.length === 0;
    let slowdown = null;
    let turn = null;
    if (usable) {
      const smoothed = smoothRows(rawWindow);
      const smoothedPost = smoothed.filter((row) => row[0] >= event.minute);
      slowdown = findRiseSlowdown(slopeRows(smoothedPost, event.minute));
      if (slowdown) {
        turn = findTurnAndDecline(smoothedPost, event.minute, slowdown.offset);
      }
    }

    return {
      ...event,
      phaseCgmUsable: usable,
      phaseExclusionReasons: reasons,
      phaseCoverage: round(coverage * 100, 1),
      phaseMaxCgmGap: gap,
      phaseWindowMinutes: availablePostMinutes,
      phaseTruncatedByNextBolus: Boolean(nextEvent && nextEvent.minute < naturalEnd),
      riseSlowdown: slowdown?.offset ?? null,
      risePeakRate: slowdown?.peakRise ?? null,
      slowedRiseRate: slowdown?.slowedRise ?? null,
      turnPoint: turn?.turnOffset ?? null,
      significantDecline: turn?.declineOffset ?? null,
      confirmedDeclineDrop: turn?.confirmedDrop ?? null,
    };
  }

  function analyzeAllBolusPhases(clinical = {}) {
    const exactCgm = exactCgmRows(clinical.cgm);
    const boluses = allPositiveBoluses(clinical);
    const events = boluses.map((event, index) =>
      analyzeBolusPhases(event, boluses[index + 1] || null, exactCgm),
    );
    const aggregate = {
      totalBoluses: events.length,
      cgmUsableBoluses: events.filter((event) => event.phaseCgmUsable).length,
      risingBoluses: events.filter((event) => Number.isFinite(event.riseSlowdown)).length,
      completePhaseEvents: events.filter(
        (event) => Number.isFinite(event.significantDecline),
      ).length,
      truncatedByNextBolus: events.filter((event) => event.phaseTruncatedByNextBolus).length,
      slowdown: meanDistribution(events.map((event) => event.riseSlowdown)),
      turn: meanDistribution(events.map((event) => event.turnPoint)),
      decline: meanDistribution(events.map((event) => event.significantDecline)),
    };
    return { events, aggregate };
  }

  function formatNumber(value, digits = 0) {
    return Number.isFinite(value)
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(value)
      : '–';
  }

  function formatMean(item) {
    if (!item || !item.n || !Number.isFinite(item.mean)) return 'nicht bestimmbar · n=0';
    return `Ø ${formatNumber(item.mean, 0)} min · n=${item.n}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  let cachedClinical = null;
  let cachedSignature = '';
  let cachedResult = null;

  function signature(clinical) {
    return [
      clinical?.cgm?.length || 0,
      clinical?.boluses?.length || 0,
      clinical?.manualInsulin?.length || 0,
      clinical?.updatedAt || '',
    ].join('|');
  }

  function cachedAnalysis(clinical) {
    const currentSignature = signature(clinical);
    if (clinical === cachedClinical && currentSignature === cachedSignature && cachedResult) {
      return cachedResult;
    }
    cachedClinical = clinical;
    cachedSignature = currentSignature;
    cachedResult = analyzeAllBolusPhases(clinical);
    return cachedResult;
  }

  function ensurePhaseCard() {
    let card = document.querySelector('#all-bolus-phases-card');
    if (card) return card;
    const firstCard = document.querySelector('#insulin-action .grid > article.card.full');
    if (!firstCard) return null;
    card = document.createElement('article');
    card.id = 'all-bolus-phases-card';
    card.className = 'card full';
    card.innerHTML = `
      <h2>Beobachteter Wirkeintritt über alle Boli</h2>
      <p class="muted compact">Jeder positive Bolus wird als Kandidat geprüft. Die Auswertung endet beim nächsten Bolus oder spätestens nach drei Stunden. Die drei Zeiten werden nur aus Verläufen mit ausreichender CGM-Abdeckung und einem zunächst klaren Anstieg berechnet; deshalb besitzt jede Kennzahl ein eigenes <code>n</code>.</p>
      <div id="all-bolus-phase-summary" class="analysis-grid insulin-summary"></div>
      <p id="all-bolus-phase-note" class="muted compact"></p>`;
    firstCard.insertAdjacentElement('afterend', card);
    return card;
  }

  function updateContextText() {
    const notice = document.querySelector('#insulin-action .notice.warn');
    if (notice) {
      notice.innerHTML =
        '<strong>Beobachteter Kurvenproxy, keine pharmakologische Messung:</strong> ' +
        'Die neue Drei-Phasen-Schätzung verwendet alle positiven Boli als Kandidaten und mittelt, ' +
        'wann ein vorhandener Anstieg schwächer wird, der Wendepunkt erreicht ist und ein ' +
        'anhaltender Abfall beginnt. Nahrung, Basalabgabe, Aktivität, Krankheit, Gegenregulation ' +
        'und Messverzögerung bleiben mögliche Mitursachen. Die streng isolierte Korrekturbolus-Analyse ' +
        'wird darunter weiterhin separat angezeigt.';
    }
    const aggregateTitle = document.querySelector('#insulin-aggregate')?.closest('article')?.querySelector('h2');
    if (aggregateTitle) aggregateTitle.textContent = 'Sekundär: streng isolierte Korrekturboli';
    const meanTitle = document.querySelector('#insulin-means-card h2');
    if (meanTitle) meanTitle.textContent = 'Sekundär: Mittelwerte streng isolierter Korrekturboli';
    const rulesTitle = document.querySelector('#insulin-aggregate')
      ?.closest('article')?.nextElementSibling?.querySelector('h2');
    if (rulesTitle) rulesTitle.textContent = 'Qualitätsregeln der Sekundäranalyse';
  }

  function renderAllBolusPhases() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined') return;
    const card = ensurePhaseCard();
    if (!card) return;
    const result = cachedAnalysis(gcState.clinical || {});
    const aggregate = result.aggregate;
    const target = card.querySelector('#all-bolus-phase-summary');
    if (target) {
      const cards = [
        ['positive Boli geprüft', aggregate.totalBoluses],
        ['mit ausreichendem CGM-Fenster', aggregate.cgmUsableBoluses],
        ['Anstieg wird schwächer', formatMean(aggregate.slowdown)],
        ['Plateau / Wendepunkt', formatMean(aggregate.turn)],
        ['anhaltender Abfall beginnt', formatMean(aggregate.decline)],
        ['vollständige Drei-Phasen-Verläufe', aggregate.completePhaseEvents],
      ];
      target.innerHTML = cards.map(([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
      ).join('');
    }
    const note = card.querySelector('#all-bolus-phase-note');
    if (note) {
      note.textContent =
        `${aggregate.truncatedByNextBolus} von ${aggregate.totalBoluses} Kandidaten wurden vor ` +
        'Ablauf der drei Stunden am nächsten Bolus beendet. Ein Ereignis fließt nur bis zu diesem ' +
        'Zeitpunkt ein. „Anstieg wird schwächer“ setzt einen vorherigen Anstieg von mindestens ' +
        `${CLEAR_RISE_MGDL_PER_15_MIN} mg/dl pro 15 Minuten voraus; der Wendepunkt und der ` +
        `anhaltende Abfall werden durch mindestens ${TURN_DROP_MGDL} mg/dl bestätigten Rückgang ` +
        'abgesichert. Die Minuten sind arithmetische Mittelwerte ab der jeweiligen Bolusabgabe.';
    }
    updateContextText();
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    const previousRender = gcRender;
    gcRender = function renderWithAllBolusPhases() {
      previousRender();
      renderAllBolusPhases();
    };
    if (typeof GlucoseCoachV3 !== 'undefined') {
      Object.assign(GlucoseCoachV3, {
        analyzeAllBolusPhases,
        analyzeBolusPhases,
        GC_ALL_BOLUS_PHASE_WINDOW_MINUTES: PHASE_WINDOW_MINUTES,
      });
    }
    renderAllBolusPhases();
  }

  const api = {
    analyzeAllBolusPhases,
    analyzeBolusPhases,
    allPositiveBoluses,
    meanDistribution,
    formatMean,
    GC_ALL_BOLUS_PHASE_WINDOW_MINUTES: PHASE_WINDOW_MINUTES,
    GC_ALL_BOLUS_PHASE_MIN_CGM_COVERAGE: MIN_CGM_COVERAGE,
    GC_ALL_BOLUS_PHASE_CLEAR_RISE: CLEAR_RISE_MGDL_PER_15_MIN,
    GC_ALL_BOLUS_PHASE_DECLINE_DROP: TURN_DROP_MGDL,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachAllBolusPhases = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
