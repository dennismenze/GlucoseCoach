(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const CONTEXT_MINUTES = 300;
  const MATCH_MINUTES = 10;
  const TWO_HOURS = 120;
  const MEALS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
  const CONFIRM_POINTS = 4;
  const CONFIRM_MINUTES = 20;
  const MAX_POINT_GAP = 7;
  const MIN_DROP = 8;
  const MAX_REBOUND = 3;
  const STEP_TOLERANCE = 1;

  const isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const nodeBase = isNode ? require('./app-meal-boundary.js') : null;
  const browserApi = root?.GlucoseCoachV3 || {};
  const baseApi = nodeBase || browserApi;
  const baseAnalyzeMeals = nodeBase?.analyzeMeals ||
    (typeof analyzeMeals === 'function' ? analyzeMeals : browserApi.analyzeMeals);
  const baseAnalyzeMeal = nodeBase?.analyzeMealAdaptivePeak ||
    nodeBase?.analyzeMealTwoHourPeak || browserApi.analyzeMealAdaptivePeak ||
    browserApi.analyzeMealTwoHourPeak;
  const baseBuildFoodComparisons = nodeBase?.buildFoodComparisons ||
    (typeof buildFoodComparisons === 'function' ? buildFoodComparisons : browserApi.buildFoodComparisons);
  const baseBuildRecommendations = nodeBase?.buildRecommendations ||
    (typeof buildRecommendations === 'function' ? buildRecommendations : browserApi.buildRecommendations);

  const array = (value) => Array.isArray(value) ? value : [];
  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }
  function rounded(value, digits = 0) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
  function median(values) {
    const valid = array(values).map(number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return null;
    const middle = Math.floor(valid.length / 2);
    return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
  }
  function parseTime(value) {
    const source = String(value ?? '').trim();
    if (!source) return null;
    const german = source.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (german) {
      const date = new Date(+german[3], +german[2] - 1, +german[1], +german[4], +german[5], +(german[6] || 0));
      return Number.isNaN(+date) ? null : Math.round(+date / MINUTE_MS);
    }
    const date = new Date(source);
    return Number.isNaN(+date) ? null : Math.round(+date / MINUTE_MS);
  }
  function localDateTime(minute) {
    const date = new Date(minute * MINUTE_MS);
    const part = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}` +
      `T${part(date.getHours())}:${part(date.getMinutes())}`;
  }
  function occasion(minute) {
    const hour = new Date(minute * MINUTE_MS).getHours();
    if (hour >= 5 && hour < 11) return 'Frühstück';
    if (hour >= 11 && hour < 15) return 'Mittagessen';
    if (hour >= 15 && hour < 22) return 'Abendessen';
    return 'Snack';
  }

  function augmentMealDiary(diary, boluses) {
    const meals = array(diary).filter((entry) => MEALS.has(entry?.occasion)).map((entry) => ({ ...entry }));
    const seen = new Set();
    const carbRows = array(boluses)
      .filter((row) => number(row?.[0]) !== null && number(row?.[1]) > 0)
      .filter((row) => {
        const key = `${Number(row[0])}|${number(row[1])}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    for (const row of carbRows) {
      const minute = Number(row[0]);
      const match = meals
        .map((entry) => ({ entry, minute: parseTime(entry.when) }))
        .filter((item) => Number.isFinite(item.minute))
        .sort((a, b) => Math.abs(a.minute - minute) - Math.abs(b.minute - minute))[0];
      if (match && Math.abs(match.minute - minute) <= MATCH_MINUTES) {
        if (!(number(match.entry.carbs) > 0)) match.entry.carbs = String(number(row[1]));
      } else {
        meals.push({
          id: `glooko-carbs-${minute}`,
          when: localDateTime(minute),
          occasion: occasion(minute),
          food: 'Glooko-Kohlenhydrate',
          carbs: String(number(row[1])),
          fat: '', protein: '', fiber: '', activity: '', sleep: '', stress: '',
          illness: 'unbekannt',
          notes: 'Aus positiver Kohlenhydratangabe im Glooko-Export übernommen',
          source: 'glooko', readOnly: true,
        });
      }
    }
    return meals.filter((entry) => number(entry?.carbs) > 0);
  }

  function exactRows(cgm, start, end) {
    const values = new Map();
    for (const row of array(cgm)) {
      const minute = number(row?.[0]);
      const value = number(row?.[1]);
      if (minute === null || value === null || minute < start || minute > end) continue;
      values.set(minute, [minute, value]);
    }
    return [...values.values()].sort((a, b) => a[0] - b[0]);
  }
  function confirmation(rows, index) {
    const candidate = rows[index];
    const future = [];
    let previous = candidate[0];
    for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
      const row = rows[cursor];
      if (row[0] - candidate[0] > CONFIRM_MINUTES + 5 || row[0] - previous > MAX_POINT_GAP) break;
      future.push(row);
      previous = row[0];
      if (future.length === CONFIRM_POINTS) break;
    }
    if (future.length < CONFIRM_POINTS || future.at(-1)[0] - candidate[0] < CONFIRM_MINUTES - 5) return null;
    return future;
  }
  function findSustainedDecline(rows, earliestMinute) {
    const first = rows.findIndex((row) => row[0] >= earliestMinute);
    if (first < 0) return null;
    for (let index = first; index < rows.length; index += 1) {
      const candidate = rows[index];
      const future = confirmation(rows, index);
      if (!future) continue;
      const sequence = [candidate, ...future];
      const nonIncreasing = future
        .map((row, deltaIndex) => row[1] - sequence[deltaIndex][1])
        .filter((delta) => delta <= STEP_TOLERANCE).length;
      const remaining = rows.slice(index + 1);
      const highestLater = remaining.length ? Math.max(...remaining.map((row) => row[1])) : candidate[1];
      if (
        Math.max(...future.map((row) => row[1])) <= candidate[1] &&
        nonIncreasing >= CONFIRM_POINTS - 1 &&
        candidate[1] - future.at(-1)[1] >= MIN_DROP &&
        highestLater <= candidate[1] + MAX_REBOUND
      ) return candidate;
    }
    return null;
  }
  function hasFinalPeak(analysis) {
    if (!analysis || analysis.eligibleForMealAnalysis === false) return false;
    if (analysis.peakComplete === true) return true;
    return Boolean(analysis.complete && number(analysis.peak) !== null &&
      number(analysis.minutesToPeak) !== null && number(analysis.turnMinute) !== null);
  }
  function corrections(boluses, start, end) {
    return array(boluses).filter((row) => number(row?.[0]) !== null && number(row?.[2]) > 0 &&
      !(number(row?.[1]) > 0) && Number(row[0]) >= start && Number(row[0]) <= end);
  }

  function analyzeWithoutMealInsulin(analysis, cgm, boluses) {
    const minute = number(analysis?.minute) ?? parseTime(analysis?.entry?.when);
    if (minute === null || !(number(analysis?.entry?.carbs) > 0) || analysis?.mealBolus || analysis?.bolus) return null;
    if (['invalid-time', 'missing-cgm', 'partial-cgm', 'overlapping-meal'].includes(analysis?.status)) return null;
    const end = number(analysis?.contextEnd) ?? minute + CONTEXT_MINUTES;
    const rows = exactRows(cgm, minute - 60, end);
    const pre = rows.filter((row) => row[0] <= minute);
    const post = rows.filter((row) => row[0] >= minute + 5);
    if (!pre.length || post.filter((row) => row[0] <= minute + TWO_HOURS).length < 18) return null;
    const baseline = number(analysis?.baseline) ?? pre.at(-1)[1];
    let rise = null;
    for (let index = 0; index <= post.length - 3; index += 1) {
      if (post[index][1] >= baseline + 5 && post[index + 1][1] >= baseline + 3 && post[index + 2][1] >= baseline + 3) {
        rise = post[index];
        break;
      }
    }
    const turn = findSustainedDecline(post, minute + 5);
    if (!turn) return null;
    const peakRows = rows.filter((row) => row[0] >= minute && row[0] <= turn[0]);
    if (!peakRows.length) return null;
    const peak = peakRows.reduce((best, row) => row[1] > best[1] ? row : best, peakRows[0]);
    const correctionCount = corrections(boluses, minute, turn[0]).length;
    return {
      ...analysis,
      complete: true, peakComplete: true, comparisonEligible: true,
      eligibleForMealAnalysis: true, usableForMealAnalysis: true,
      status: number(analysis?.twoHour) === null
        ? 'complete-without-meal-insulin-missing-two-hour'
        : 'complete-without-meal-insulin',
      baseline,
      minutesToRise: rise ? rise[0] - minute : null,
      peak: peak[1], minutesToPeak: peak[0] - minute, peakFromBolus: null,
      peakDelta: peak[1] - baseline, peakDeltaFromBolus: null,
      bolus: null, mealBolus: null, bolusOffset: null, mealBolusCandidateCount: 0,
      bolusCountBeforeTurn: correctionCount, ignoredBolusCountBeforeTurn: correctionCount,
      correctionBolusCountBeforeTurn: correctionCount,
      turnMinute: turn[0], turnFromMeal: turn[0] - minute, turnFromBolus: null,
      turnAfterPeak: turn[0] >= peak[0], withoutMealInsulin: true,
      mealAnchorMinute: minute, mealAnchorKind: 'positive-carbohydrates-without-insulin',
    };
  }
  function enhanceAnalysis(analysis, cgm, boluses) {
    if (!analysis || !(number(analysis?.entry?.carbs) > 0)) {
      return analysis ? { ...analysis, eligibleForMealAnalysis: false, usableForMealAnalysis: false } : null;
    }
    if (hasFinalPeak(analysis)) {
      return { ...analysis, eligibleForMealAnalysis: true, usableForMealAnalysis: true,
        withoutMealInsulin: !(analysis.mealBolus || analysis.bolus) };
    }
    return analyzeWithoutMealInsulin(analysis, cgm, boluses) ||
      { ...analysis, eligibleForMealAnalysis: true, usableForMealAnalysis: false };
  }
  function analyzeMealIncludingCarbOnly(entry, cgm, boluses, nextMealMinute = null) {
    if (typeof baseAnalyzeMeal !== 'function') return null;
    const originalMinute = parseTime(entry?.when);
    const augmented = augmentMealDiary([entry], boluses).find((candidate) =>
      String(candidate?.id ?? '') === String(entry?.id ?? '') ||
      (originalMinute !== null && Math.abs(parseTime(candidate?.when) - originalMinute) <= MATCH_MINUTES),
    );
    if (!augmented || !(number(augmented.carbs) > 0)) return {
      entry, minute: originalMinute, complete: false, peakComplete: false,
      eligibleForMealAnalysis: false, usableForMealAnalysis: false, status: 'missing-carbs',
    };
    return enhanceAnalysis(baseAnalyzeMeal(augmented, cgm, boluses, nextMealMinute), cgm, boluses);
  }
  function analyzeMealsIncludingCarbOnly(diary, cgm, boluses) {
    if (typeof baseAnalyzeMeals !== 'function') return [];
    return array(baseAnalyzeMeals(augmentMealDiary(diary, boluses), cgm, boluses))
      .map((analysis) => enhanceAnalysis(analysis, cgm, boluses))
      .filter((analysis) => analysis?.usableForMealAnalysis === true);
  }

  function buildFoodComparisonsUsable(analyses = []) {
    if (typeof baseBuildFoodComparisons !== 'function') return [];
    return baseBuildFoodComparisons(array(analyses).filter(hasFinalPeak));
  }

  function buildRecommendationsUsable(input = {}) {
    if (typeof baseBuildRecommendations !== 'function') return [];
    const analyses = array(input.analyses).filter(hasFinalPeak);
    const foodGroups = typeof baseBuildFoodComparisons === 'function'
      ? buildFoodComparisonsUsable(analyses)
      : array(input.foodGroups);
    const cards = array(baseBuildRecommendations({ ...input, analyses, foodGroups }));
    return cards.map((card) => {
      const group = foodGroups.find((item) => card?.title === `${item.label}: wiederholter persönlicher Vergleich`);
      if (!group) return card;
      const events = analyses.filter((analysis) => String(analysis.entry?.food ?? '').trim().toLocaleLowerCase('de-DE') ===
        String(group.label ?? '').trim().toLocaleLowerCase('de-DE'));
      const withoutInsulin = events.filter((analysis) => !(analysis.mealBolus || analysis.bolus)).length;
      if (!withoutInsulin) return card;
      const suffix = withoutInsulin === events.length
        ? ' Bei diesen Verläufen wurde kein Mahlzeiteninsulin abgegeben.'
        : ` ${withoutInsulin} von ${events.length} Verläufen wurden ohne Mahlzeiteninsulin ausgewertet.`;
      return {
        ...card,
        finding: `${events.length} vollständig auswertbare Wiederholungen zeigen im Median einen ` +
          `Peak-Anstieg von ${group.medianPeakDelta ?? '–'} mg/dl nach ` +
          `${group.medianMinutesToPeak ?? '–'} min ab Essen.${suffix}`,
        boundary: 'Berücksichtigt werden positive Kohlenhydratangaben mit vollständig bestimmbarer ' +
          'CGM-Kurve bis zum stabil bestätigten Rückgang. Insulin ohne positive KH-Angabe bleibt ' +
          'ein Korrekturbolus. Das ist beobachtend und keine Dosisempfehlung.',
      };
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }
  function format(value, digits = 0) {
    const numeric = number(value);
    return numeric === null ? '–' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(numeric);
  }
  const mg = (value) => number(value) === null ? '–' : `${format(value)} mg/dl`;
  const minutes = (value) => number(value) === null ? '–' : `${format(value)} min`;
  function peakText(analysis) {
    const parts = [`${format(analysis.peak)} mg/dl`];
    if (number(analysis.peakFromBolus) !== null) parts.push(`${format(analysis.peakFromBolus)} min nach Mahlzeitenbolus`);
    parts.push(`${format(analysis.minutesToPeak)} min nach Essen`);
    return parts.join(' · ');
  }
  function bolusText(analysis) {
    const bolus = analysis.mealBolus || analysis.bolus;
    const correctionCount = number(analysis.correctionBolusCountBeforeTurn) ??
      number(analysis.ignoredBolusCountBeforeTurn) ?? 0;
    if (!bolus) {
      const correctionText = correctionCount === 1
        ? ' · 1 Korrekturbolus ohne KH-Angabe im Verlauf'
        : correctionCount > 1 ? ` · ${format(correctionCount)} Korrekturboli ohne KH-Angabe im Verlauf` : '';
      return `kein Insulin zur Mahlzeit abgegeben · ${format(analysis.entry.carbs, 1)} g KH erfasst${correctionText}`;
    }
    const parts = [`${format(bolus[2], 2)} E`];
    const offset = number(analysis.bolusOffset);
    if (offset !== null) parts.push(offset < 0 ? `${format(Math.abs(offset))} min vor Essen` :
      offset > 0 ? `${format(offset)} min nach Essen` : 'zum Essen');
    if (correctionCount === 1) parts.push('1 spätere Bolusgabe vor dem Wendepunkt als mögliche Korrektur behandelt');
    else if (correctionCount > 1) parts.push(`${format(correctionCount)} spätere Bolusgaben vor dem Wendepunkt als mögliche Korrekturen behandelt`);
    return parts.join(' · ');
  }
  function turnText(analysis) {
    const parts = [];
    if (number(analysis.turnFromBolus) !== null) parts.push(`${format(analysis.turnFromBolus)} min nach Mahlzeitenbolus`);
    parts.push(`${format(analysis.turnFromMeal)} min nach Essen`);
    return parts.join(' · ');
  }
  function currentDiary() {
    if (typeof gcState === 'undefined') return [];
    const local = array(gcState.diary);
    const mode = root?.GlucoseCoachGlookoMode;
    return typeof mode?.buildAnalysisDiary === 'function' ? mode.buildAnalysisDiary(local, gcState.clinical || {}) : local;
  }
  function renderEvents() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined') return;
    const analyses = analyzeMealsIncludingCarbOnly(currentDiary(), gcState.clinical?.cgm || [],
      gcState.clinical?.boluses || []).sort((a, b) => Number(b.minute || 0) - Number(a.minute || 0));
    const target = document.querySelector('#meal-events');
    if (!target) return analyses;
    target.innerHTML = analyses.length ? analyses.map((analysis) => {
      const noInsulin = !(analysis.mealBolus || analysis.bolus);
      return `<details class="analysis-item" data-analysis-status="${escapeHtml(analysis.status || 'complete')}">` +
        `<summary class="analysis-head"><strong>${escapeHtml(analysis.entry?.occasion)} · ` +
        `${escapeHtml(analysis.entry?.food || 'ohne Bezeichnung')}</strong><span class="status ok">` +
        `${noInsulin ? 'vollständig · ohne Mahlzeiteninsulin' : 'vollständig'}</span></summary>` +
        '<div class="analysis-grid">' +
        `<div><span>Ausgangswert</span><strong>${mg(analysis.baseline)}</strong></div>` +
        `<div><span>erster nachhaltiger Anstieg</span><strong>${minutes(analysis.minutesToRise)}</strong></div>` +
        `<div><span>${noInsulin ? 'Peak nach Essen' : 'Peak nach Mahlzeitenbolus'}</span>` +
        `<strong>${escapeHtml(peakText(analysis))}</strong></div>` +
        `<div><span>2-h-Wert</span><strong>${mg(analysis.twoHour)}</strong></div>` +
        `<div><span>maßgeblicher Mahlzeitenbolus</span><strong>${escapeHtml(bolusText(analysis))}</strong></div>` +
        `<div><span>Stabil bestätigter Rückgang</span><strong>${escapeHtml(turnText(analysis))}</strong></div>` +
        '</div></details>';
    }).join('') : '<div class="empty-state">Keine Mahlzeit mit positiven Kohlenhydraten und vollständig auswertbarem CGM-Verlauf.</div>';
    const summary = document.querySelector('#meal-events-summary');
    if (summary) summary.textContent = analyses.length
      ? `${analyses.length} ${analyses.length === 1 ? 'Mahlzeit' : 'Mahlzeiten'} anzeigen`
      : 'Keine auswertbaren Mahlzeiten';
    const disclosure = document.querySelector('#meal-events-disclosure');
    if (disclosure) disclosure.open = analyses.length === 0;
    return analyses;
  }

  function renderComparisons(analyses) {
    const target = document.querySelector('#food-comparison');
    if (!target || typeof baseBuildFoodComparisons !== 'function') return;
    const groups = array(buildFoodComparisonsUsable(analyses)).filter((group) => Number(group?.analyzed || 0) > 0);
    const columns = target.closest('table')?.querySelectorAll('thead th').length || 7;
    target.innerHTML = groups.length ? groups.map((group) => {
      const cells = [
        escapeHtml(group.label), String(group.entries), String(group.analyzed),
        mg(group.medianPeakDelta), minutes(group.medianMinutesToPeak),
      ];
      if (columns >= 7) cells.push(minutes(group.medianMinutesBolusToPeak));
      cells.push(mg(group.medianTwoHourDelta));
      return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
    }).join('') : `<tr><td colspan="${columns}">Noch keine Mahlzeit ist mindestens zweimal vollständig auswertbar.</td></tr>`;
  }

  function updateMethodText() {
    const intro = document.querySelector('#meal-method-explanation p.muted') ||
      document.querySelector('#meal-analysis article.card.full > p.muted');
    if (!intro) return;
    intro.textContent = 'Berücksichtigt werden nur Mahlzeiten mit einer positiven Kohlenhydratangabe und ' +
      'einem vollständig auswertbaren CGM-Verlauf bis zu einem über 20 Minuten und mindestens 8 mg/dl ' +
      'stabil bestätigten Rückgang. Wurde zu den Kohlenhydraten kein Insulin abgegeben, beginnt das ' +
      'Peakfenster beim Essensbeginn. Ein positiver Insulineintrag ohne positive KH-Angabe bleibt immer ' +
      'ein Korrekturbolus und wird nie als Mahlzeitenbolus verwendet. Das beschreibt die beobachtete ' +
      'Kurve und nicht den pharmakologischen Wirkeintritt des Insulins. Nicht auswertbare Mahlzeiten ' +
      'werden in dieser Ansicht nicht angezeigt.';
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function' || root?.__glucoseCoachCarbOnlyMealsInstalled) return;
    root.__glucoseCoachCarbOnlyMealsInstalled = true;
    if (typeof analyzeMeals !== 'undefined') analyzeMeals = analyzeMealsIncludingCarbOnly;
    if (typeof buildFoodComparisons !== 'undefined') buildFoodComparisons = buildFoodComparisonsUsable;
    if (typeof buildRecommendations !== 'undefined') buildRecommendations = buildRecommendationsUsable;
    if (typeof GlucoseCoachV3 !== 'undefined') Object.assign(GlucoseCoachV3, {
      analyzeMealAdaptivePeak: analyzeMealIncludingCarbOnly,
      analyzeMealTwoHourPeak: analyzeMealIncludingCarbOnly,
      analyzeMeals: analyzeMealsIncludingCarbOnly,
      buildFoodComparisons: buildFoodComparisonsUsable,
      buildRecommendations: buildRecommendationsUsable,
      augmentMealDiary,
    });
    const previousRender = gcRender;
    gcRender = function renderWithCarbohydrateOnlyMeals() {
      previousRender();
      const analyses = renderEvents();
      renderComparisons(analyses || []);
      if (typeof root?.GlucoseCoachMealPageUi?.applyLayout === 'function') {
        root.GlucoseCoachMealPageUi.applyLayout();
      }
      updateMethodText();
    };
    gcRender();
  }

  const api = {
    ...baseApi,
    analyzeMealAdaptivePeak: analyzeMealIncludingCarbOnly,
    analyzeMealTwoHourPeak: analyzeMealIncludingCarbOnly,
    analyzeMeals: analyzeMealsIncludingCarbOnly,
    buildFoodComparisons: buildFoodComparisonsUsable,
    buildRecommendations: buildRecommendationsUsable,
    augmentMealDiary,
    analyzeWithoutMealInsulin,
    enhanceAnalysis,
    findSustainedDecline,
    hasFinalPeak,
    GC_MEAL_MATCH_MINUTES: MATCH_MINUTES,
  };
  if (isNode) module.exports = api;
  if (root) root.GlucoseCoachCarbOnlyMeals = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
