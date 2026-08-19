(function () {
  'use strict';

  const TWO_HOUR_REFERENCE_MINUTES = 120;
  const MEAL_CONTEXT_MINUTES = 300;
  const BOLUS_LOOKBACK_MINUTES = 60;
  const DECLINE_CONFIRMATION_POINTS = 4;
  const DECLINE_CONFIRMATION_MINUTES = 20;
  const DECLINE_MAX_POINT_GAP_MINUTES = 7;
  const DECLINE_DROP_MGDL = 8;
  const DECLINE_REBOUND_TOLERANCE_MGDL = 3;
  const DECLINE_STEP_TOLERANCE_MGDL = 1;
  const MINUTE_MS = 60_000;
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);

  const nodeCore = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-v3-core.js')
    : null;
  const baseApi = nodeCore || (typeof GlucoseCoachV3 !== 'undefined' ? GlucoseCoachV3 : {});
  const baseRecommendations = baseApi.buildRecommendations;

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

  function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function median(values) {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function closest(rows, target) {
    return [...rows].sort(
      (a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target),
    )[0] || null;
  }

  function positiveBoluses(boluses, start, end) {
    return [...(boluses || [])]
      .filter((row) => Number.isFinite(Number(row?.[0])))
      .filter((row) => row[0] >= start && row[0] <= end && Number(row[2]) > 0)
      .sort((a, b) => a[0] - b[0]);
  }

  function contiguousConfirmation(rows, startIndex) {
    const candidate = rows[startIndex];
    const future = [];
    let previousMinute = candidate[0];

    for (let index = startIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (row[0] - candidate[0] > DECLINE_CONFIRMATION_MINUTES + 5) break;
      if (row[0] - previousMinute > DECLINE_MAX_POINT_GAP_MINUTES) break;
      future.push(row);
      previousMinute = row[0];
      if (future.length === DECLINE_CONFIRMATION_POINTS) break;
    }

    if (future.length < DECLINE_CONFIRMATION_POINTS) return null;
    if (future.at(-1)[0] - candidate[0] < DECLINE_CONFIRMATION_MINUTES - 5) return null;
    return future;
  }

  function findSustainedDecline(rows, earliestMinute) {
    const firstEligibleIndex = rows.findIndex((row) => row[0] >= earliestMinute);
    if (firstEligibleIndex < 0) return null;

    for (let index = firstEligibleIndex; index < rows.length; index += 1) {
      const candidate = rows[index];
      const future = contiguousConfirmation(rows, index);
      if (!future) continue;

      const sequence = [candidate, ...future];
      const nonIncreasingSteps = future
        .map((row, deltaIndex) => row[1] - sequence[deltaIndex][1])
        .filter((delta) => delta <= DECLINE_STEP_TOLERANCE_MGDL).length;
      const highestConfirmationValue = Math.max(...future.map((row) => row[1]));
      const remaining = rows.slice(index + 1);
      const highestLaterValue = remaining.length
        ? Math.max(...remaining.map((row) => row[1]))
        : candidate[1];
      const confirmedDrop = candidate[1] - future.at(-1)[1];

      if (
        highestConfirmationValue <= candidate[1] &&
        nonIncreasingSteps >= DECLINE_CONFIRMATION_POINTS - 1 &&
        confirmedDrop >= DECLINE_DROP_MGDL &&
        highestLaterValue <= candidate[1] + DECLINE_REBOUND_TOLERANCE_MGDL
      ) {
        return candidate;
      }
    }

    return null;
  }

  function analyzeMealAdaptivePeak(entry, cgm, boluses, nextMealMinute = null) {
    const minute = parseTime(entry.when);
    if (minute === null) return { entry, complete: false, status: 'invalid-time' };

    const naturalContextEnd = minute + MEAL_CONTEXT_MINUTES;
    const contextEnd = Math.min(
      naturalContextEnd,
      Number.isFinite(nextMealMinute) && nextMealMinute > minute
        ? nextMealMinute - 1
        : Number.POSITIVE_INFINITY,
    );
    const truncatedByNextMeal = contextEnd < naturalContextEnd;

    const windowRows = (cgm || []).filter(
      (row) => row[0] >= minute - BOLUS_LOOKBACK_MINUTES &&
        row[0] <= contextEnd &&
        row[1] !== null,
    );
    if (!windowRows.length) {
      return {
        entry,
        minute,
        complete: false,
        status: 'missing-cgm',
        nextMealMinute,
        contextEnd,
        truncatedByNextMeal,
      };
    }

    const pre = windowRows.filter((row) => row[0] <= minute);
    const post = windowRows.filter((row) => row[0] >= minute + 5);
    const firstTwoHours = post.filter((row) => row[0] <= minute + TWO_HOUR_REFERENCE_MINUTES);

    if (!pre.length || firstTwoHours.length < 18) {
      return {
        entry,
        minute,
        complete: false,
        status: truncatedByNextMeal && contextEnd < minute + TWO_HOUR_REFERENCE_MINUTES
          ? 'overlapping-meal'
          : 'partial-cgm',
        cgmPoints: firstTwoHours.length,
        nextMealMinute,
        contextEnd,
        truncatedByNextMeal,
      };
    }

    const baseline = pre.at(-1)[1];
    const two = closest(
      post.filter((row) => row[0] >= minute + 105 && row[0] <= minute + 135),
      minute + TWO_HOUR_REFERENCE_MINUTES,
    );

    let rise = null;
    for (let index = 0; index <= post.length - 3; index += 1) {
      const first = post[index];
      const second = post[index + 1];
      const third = post[index + 2];
      if (
        first[1] >= baseline + 5 &&
        second[1] >= baseline + 3 &&
        third[1] >= baseline + 3
      ) {
        rise = first;
        break;
      }
    }

    const bolusesInContext = positiveBoluses(
      boluses,
      minute - BOLUS_LOOKBACK_MINUTES,
      contextEnd,
    );
    const lastBolusInContext = bolusesInContext.at(-1) || null;
    const declineSearchStart = lastBolusInContext
      ? Math.max(minute + 5, lastBolusInContext[0] + 10)
      : minute + 5;
    const turn = findSustainedDecline(post, declineSearchStart);
    const bolus = turn
      ? [...bolusesInContext].filter((row) => row[0] <= turn[0]).at(-1) || null
      : null;

    const peakRows = turn && bolus
      ? windowRows.filter((row) => row[0] >= bolus[0] && row[0] <= turn[0])
      : [];
    const peakRow = peakRows.length
      ? peakRows.reduce((best, row) => row[1] > best[1] ? row : best, peakRows[0])
      : null;
    const bolusStartRow = bolus ? closest(windowRows, bolus[0]) : null;

    let status = 'partial-analysis';
    if (!bolusesInContext.length) status = 'missing-bolus';
    else if (!turn && truncatedByNextMeal) status = 'overlapping-meal';
    else if (!turn) status = 'no-stable-decline';
    else if (!bolus || !peakRow || !two) status = 'partial-analysis';
    else status = 'complete';

    const complete = status === 'complete';

    return {
      entry,
      minute,
      complete,
      status,
      baseline,
      minutesToRise: rise ? rise[0] - minute : null,
      peak: peakRow?.[1] ?? null,
      minutesToPeak: peakRow ? peakRow[0] - minute : null,
      peakFromBolus: peakRow && bolus ? peakRow[0] - bolus[0] : null,
      peakDelta: peakRow ? peakRow[1] - baseline : null,
      peakDeltaFromBolus: peakRow && bolusStartRow
        ? peakRow[1] - bolusStartRow[1]
        : null,
      twoHour: two?.[1] ?? null,
      twoHourDelta: two ? two[1] - baseline : null,
      bolus,
      bolusOffset: bolus ? bolus[0] - minute : null,
      bolusCountBeforeTurn: turn
        ? bolusesInContext.filter((row) => row[0] <= turn[0]).length
        : 0,
      turnMinute: turn?.[0] ?? null,
      turnFromMeal: turn ? turn[0] - minute : null,
      turnFromBolus: turn && bolus ? turn[0] - bolus[0] : null,
      turnAfterPeak: turn && peakRow ? turn[0] >= peakRow[0] : null,
      nextMealMinute,
      contextEnd,
      truncatedByNextMeal,
      mealContextMinutes: MEAL_CONTEXT_MINUTES,
    };
  }

  function analyzeMealsAdaptivePeak(diary, cgm, boluses) {
    const meals = (diary || [])
      .filter((entry) => MEAL_OCCASIONS.has(entry.occasion))
      .map((entry) => ({ entry, minute: parseTime(entry.when) }));
    const chronological = meals
      .filter((item) => item.minute !== null)
      .sort((a, b) => a.minute - b.minute);
    const nextMealByEntry = new Map();
    chronological.forEach((item, index) => {
      nextMealByEntry.set(item.entry, chronological[index + 1]?.minute ?? null);
    });

    return meals.map(({ entry }) =>
      analyzeMealAdaptivePeak(entry, cgm, boluses, nextMealByEntry.get(entry) ?? null),
    );
  }

  function buildFoodComparisonsAdaptivePeak(analyses) {
    const groups = new Map();
    for (const analysis of analyses || []) {
      const key = String(analysis.entry?.food ?? '').trim().toLocaleLowerCase('de-DE');
      if (!key) continue;
      if (!groups.has(key)) {
        groups.set(key, { label: analysis.entry.food.trim(), all: [], complete: [] });
      }
      const group = groups.get(key);
      group.all.push(analysis);
      if (analysis.complete) group.complete.push(analysis);
    }

    return [...groups.values()]
      .filter((group) => group.all.length >= 2)
      .map((group) => ({
        label: group.label,
        entries: group.all.length,
        analyzed: group.complete.length,
        medianPeakDelta: round(median(group.complete.map((item) => item.peakDelta)), 0),
        medianMinutesToPeak: round(median(group.complete.map((item) => item.minutesToPeak)), 0),
        medianMinutesBolusToPeak: round(
          median(group.complete.map((item) => item.peakFromBolus)),
          0,
        ),
        medianTwoHourDelta: round(
          median(group.complete.map((item) => item.twoHourDelta)),
          0,
        ),
        peakContextMinutes: MEAL_CONTEXT_MINUTES,
      }));
  }

  function buildRecommendationsAdaptivePeak(input) {
    if (typeof baseRecommendations !== 'function') return [];
    const cards = baseRecommendations(input);
    const groups = input?.foodGroups || [];

    return cards.map((card) => {
      const group = groups.find((candidate) =>
        card.title === `${candidate.label}: wiederholter persönlicher Vergleich`,
      );
      if (!group || group.analyzed < 2) return card;

      return {
        ...card,
        finding:
          `${group.analyzed} Wiederholungen zeigen im Median einen Peak-Anstieg von ` +
          `${group.medianPeakDelta ?? '–'} mg/dl nach ${group.medianMinutesToPeak ?? '–'} min ` +
          `ab Essen und ${group.medianMinutesBolusToPeak ?? '–'} min nach dem letzten Bolus ` +
          'vor dem anhaltenden Rückgang.',
        boundary:
          'Der Peak ist der höchste persönliche CGM-Wert zwischen dem letzten positiven Bolus ' +
          'vor dem stabil bestätigten Rückgang und diesem Rückgang. Weitere Boli setzen den ' +
          'Peak-Start neu; eine neue protokollierte Mahlzeit beendet den Kontext. Das ist ' +
          'beobachtend und keine Dosisempfehlung.',
      };
    });
  }

  function formatNumber(value, digits = 0) {
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value));
  }

  function formatOffset(offset, reference) {
    if (!Number.isFinite(offset)) return null;
    if (offset === 0) return reference === 'Essen' ? 'zum Essen' : 'zum letzten Bolus';
    return `${formatNumber(Math.abs(offset), 0)} min ${offset < 0 ? 'vor' : 'nach'} ${reference}`;
  }

  function formatPeakValue(analysis) {
    if (!Number.isFinite(analysis.peak)) return 'nicht bestimmbar';
    const parts = [`${formatNumber(analysis.peak, 0)} mg/dl`];
    if (Number.isFinite(analysis.peakFromBolus)) {
      parts.push(`${formatNumber(analysis.peakFromBolus, 0)} min nach letztem Bolus`);
    }
    if (Number.isFinite(analysis.minutesToPeak)) {
      parts.push(`${formatNumber(analysis.minutesToPeak, 0)} min nach Essen`);
    }
    return parts.join(' · ');
  }

  function formatBolusValue(analysis) {
    if (!analysis.bolus) return 'kein passender positiver Bolus vor Rückgang gefunden';
    const parts = [`${formatNumber(analysis.bolus[2], 2)} E`];
    if (Number.isFinite(analysis.bolusOffset)) {
      parts.push(formatOffset(analysis.bolusOffset, 'Essen'));
    }
    return parts.join(' · ');
  }

  function formatTurnValue(analysis) {
    if (!Number.isFinite(analysis.turnMinute)) return 'nicht stabil erkennbar';
    const parts = [];
    if (Number.isFinite(analysis.turnFromBolus)) {
      parts.push(`${formatNumber(analysis.turnFromBolus, 0)} min nach letztem Bolus`);
    }
    if (Number.isFinite(analysis.turnFromMeal)) {
      parts.push(`${formatNumber(analysis.turnFromMeal, 0)} min nach Essen`);
    }
    return parts.join(' · ');
  }

  function updateExplanatoryText() {
    const intro = document.querySelector('#meal-analysis article.card.full p.muted');
    if (intro) {
      intro.textContent =
        'Der Mahlzeiten-Peak ist nicht mehr auf zwei Stunden begrenzt. Bis zu fünf Stunden ' +
        'nach dem protokollierten Essensbeginn wird zuerst ein anhaltender Rückgangs-Proxy ' +
        'gesucht. Der Peak ist anschließend der höchste CGM-Wert zwischen dem letzten positiven ' +
        'Bolus vor diesem Rückgang und dem Rückgang selbst. Kommt vorher ein weiterer Bolus, ' +
        'setzt er den Peak-Start neu. Eine weitere protokollierte Mahlzeit beendet den Kontext. ' +
        `Der Rückgang wird mit ${DECLINE_CONFIRMATION_MINUTES} Minuten Hysterese, mindestens ` +
        `${DECLINE_DROP_MGDL} mg/dl bestätigtem Abfall und maximal ` +
        `${DECLINE_REBOUND_TOLERANCE_MGDL} mg/dl späterem Rebound abgesichert. ` +
        'Der separate 2-h-Wert bleibt nur ein Referenzwert. Das ist kein Nachweis eines ' +
        'pharmakologischen Insulin-Wirkbeginns.';
    }

    const headers = document.querySelector('#food-comparison')
      ?.closest('table')?.querySelectorAll('thead th');
    if (headers?.length >= 6) {
      headers[3].textContent = 'Peak-Anstieg';
      headers[4].textContent = 'Essen→Peak';
      headers[5].textContent = 'letzter Bolus→Peak';
      if (headers.length < 7) {
        const header = document.createElement('th');
        header.textContent = '2-h-Änderung';
        headers[0].parentElement.appendChild(header);
      }
    }

    const note = document.querySelector('#food-comparison-note');
    if (note) {
      note.textContent =
        'Mediane werden nur aus persönlichen, vollständig auswertbaren Ereignissen berechnet. ' +
        'Der Peak darf auch nach mehr als zwei oder drei Stunden liegen, sofern vor dem stabilen ' +
        'Rückgang keine neue Mahlzeit protokolliert wurde. Bei mehreren Boli zählt jeweils das ' +
        'Segment ab dem letzten Bolus vor dem Rückgang.';
    }
  }

  function updateFoodComparisonTable(analyses) {
    const groups = buildFoodComparisonsAdaptivePeak(analyses);
    const rows = document.querySelectorAll('#food-comparison tr');
    rows.forEach((row, index) => {
      const group = groups[index];
      if (!group) return;
      const cells = row.querySelectorAll('td');
      if (cells.length < 6) return;
      cells[3].textContent = group.analyzed ? `${formatNumber(group.medianPeakDelta, 0)} mg/dl` : 'wartet auf Daten';
      cells[4].textContent = group.analyzed ? `${formatNumber(group.medianMinutesToPeak, 0)} min` : '–';
      cells[5].textContent = group.analyzed ? `${formatNumber(group.medianMinutesBolusToPeak, 0)} min` : '–';
      if (cells.length < 7) {
        const cell = document.createElement('td');
        row.appendChild(cell);
      }
      row.cells[6].textContent = group.analyzed && Number.isFinite(group.medianTwoHourDelta)
        ? `${formatNumber(group.medianTwoHourDelta, 0)} mg/dl`
        : '–';
    });
  }

  function updateMealCards() {
    if (typeof gcState === 'undefined') return;
    const analyses = analyzeMealsAdaptivePeak(
      gcState.diary,
      gcState.clinical.cgm,
      gcState.clinical.boluses,
    ).sort((a, b) => (b.minute || 0) - (a.minute || 0));
    const items = document.querySelectorAll('#meal-events .analysis-item');

    items.forEach((item, index) => {
      const analysis = analyses[index];
      if (!analysis) return;
      const cells = item.querySelectorAll('.analysis-grid > div');
      if (cells.length < 6) return;

      cells[2].querySelector('span').textContent = 'Peak nach letztem Bolus vor Rückgang';
      cells[2].querySelector('strong').textContent = formatPeakValue(analysis);
      cells[4].querySelector('span').textContent = 'maßgeblicher letzter Bolus';
      cells[4].querySelector('strong').textContent = formatBolusValue(analysis);
      cells[5].querySelector('span').textContent = 'CGM-Wendepunkt-Proxy (anhaltender Rückgang)';
      cells[5].querySelector('strong').textContent = formatTurnValue(analysis);
    });

    updateFoodComparisonTable(analyses);

    const summaryLabels = document.querySelectorAll('#meal-summary > div > span');
    if (summaryLabels.length >= 4) {
      summaryLabels[3].textContent = 'mit anhaltendem Rückgangs-Proxy';
    }
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined') return;

    const previousMealsView = typeof gcMeals === 'function' ? gcMeals : null;
    const previousQualityView = typeof gcQuality === 'function' ? gcQuality : null;

    if (typeof analyzeMeals !== 'undefined') analyzeMeals = analyzeMealsAdaptivePeak;
    if (typeof buildFoodComparisons !== 'undefined') {
      buildFoodComparisons = buildFoodComparisonsAdaptivePeak;
    }
    if (typeof buildRecommendations !== 'undefined') {
      buildRecommendations = buildRecommendationsAdaptivePeak;
    }

    if (previousMealsView) {
      gcMeals = function adaptivePeakMealsView() {
        previousMealsView();
        updateMealCards();
        updateExplanatoryText();
      };
    }

    if (previousQualityView) {
      gcQuality = function adaptivePeakQualityView() {
        previousQualityView();
        const body = document.querySelector('#quality-body');
        if (!body) return;

        const peakRow = document.createElement('tr');
        peakRow.innerHTML =
          '<td>Mahlzeiten-Peakfenster</td>' +
          '<td>letzter Bolus → Rückgang · max. 5 h</td>' +
          '<td>Der Peak ist der höchste CGM-Wert nach dem letzten positiven Bolus vor dem stabil bestätigten Rückgang. Ein weiterer Bolus setzt den Start neu; eine neue Mahlzeit beendet den Kontext.</td>';
        body.appendChild(peakRow);

        const declineRow = document.createElement('tr');
        declineRow.innerHTML =
          '<td>Anhaltender Rückgangs-Proxy</td>' +
          `<td>${DECLINE_CONFIRMATION_MINUTES} min Hysterese</td>` +
          `<td>Vier Folgewerte müssen mindestens ${DECLINE_DROP_MGDL} mg/dl Abfall bestätigen; ` +
          `ein späterer Rebound über ${DECLINE_REBOUND_TOLERANCE_MGDL} mg/dl bis zum Kontextende verwirft den Kandidaten.</td>`;
        body.appendChild(declineRow);
      };
    }

    if (typeof GlucoseCoachV3 !== 'undefined') {
      Object.assign(GlucoseCoachV3, {
        analyzeMealAdaptivePeak,
        analyzeMealTwoHourPeak: analyzeMealAdaptivePeak,
        analyzeMeals: analyzeMealsAdaptivePeak,
        buildFoodComparisons: buildFoodComparisonsAdaptivePeak,
        buildRecommendations: buildRecommendationsAdaptivePeak,
        GC_TWO_HOUR_REFERENCE_MINUTES: TWO_HOUR_REFERENCE_MINUTES,
        GC_MEAL_CONTEXT_MINUTES: MEAL_CONTEXT_MINUTES,
        GC_DECLINE_CONFIRMATION_MINUTES: DECLINE_CONFIRMATION_MINUTES,
        GC_DECLINE_DROP_MGDL: DECLINE_DROP_MGDL,
        GC_DECLINE_REBOUND_TOLERANCE_MGDL: DECLINE_REBOUND_TOLERANCE_MGDL,
      });
    }

    updateExplanatoryText();
    if (typeof gcRender === 'function') gcRender();
  }

  const api = {
    ...baseApi,
    analyzeMealAdaptivePeak,
    analyzeMealTwoHourPeak: analyzeMealAdaptivePeak,
    analyzeMeals: analyzeMealsAdaptivePeak,
    buildFoodComparisons: buildFoodComparisonsAdaptivePeak,
    buildRecommendations: buildRecommendationsAdaptivePeak,
    formatOffset,
    GC_TWO_HOUR_REFERENCE_MINUTES: TWO_HOUR_REFERENCE_MINUTES,
    GC_MEAL_CONTEXT_MINUTES: MEAL_CONTEXT_MINUTES,
    GC_DECLINE_CONFIRMATION_MINUTES: DECLINE_CONFIRMATION_MINUTES,
    GC_DECLINE_DROP_MGDL: DECLINE_DROP_MGDL,
    GC_DECLINE_REBOUND_TOLERANCE_MGDL: DECLINE_REBOUND_TOLERANCE_MGDL,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  installBrowserPatch();
})();