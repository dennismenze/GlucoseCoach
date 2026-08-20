(function () {
  'use strict';

  const MINUTE_MS = 60_000;
  const PRE_MINUTES = 30;
  const ACTION_WINDOW_MINUTES = 300;
  const MEAL_LOOKBACK_MINUTES = 90;
  const MEAL_LOOKAHEAD_MINUTES = 300;
  const OTHER_BOLUS_LOOKBACK_MINUTES = 180;
  const OTHER_BOLUS_LOOKAHEAD_MINUTES = 300;
  const EXERCISE_LOOKBACK_MINUTES = 120;
  const EXERCISE_LOOKAHEAD_MINUTES = 300;
  const MIN_CGM_COVERAGE = 0.80;
  const MAX_CGM_GAP_MINUTES = 15;
  const ONSET_EFFECT_MGDL = 5;
  const ONSET_CONFIRMED_MGDL = 8;
  const ONSET_POINTS = 4;
  const END_CONFIRMATION_MINUTES = 30;
  const END_ABSOLUTE_EFFECT_MGDL = 5;
  const END_REMAINING_FRACTION = 0.10;
  const STABLE_WINDOW_MINUTES = 30;
  const STABLE_RANGE_MGDL = 10;
  const STABLE_SLOPE_MGDL_PER_MINUTE = 0.15;
  const MIN_AGGREGATE_EVENTS = 3;
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);

  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    const result = Number(String(value).replace(',', '.'));
    return Number.isFinite(result) ? result : null;
  }

  function round(value, digits = 2) {
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

  function distribution(values, digits = 0) {
    const valid = values.filter(Number.isFinite);
    return {
      n: valid.length,
      median: round(median(valid), digits),
      q1: round(quantile(valid, 0.25), digits),
      q3: round(quantile(valid, 0.75), digits),
    };
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

  function medianOf(values) {
    return median(values.filter(Number.isFinite));
  }

  function exactCgmRows(cgm) {
    return (cgm || [])
      .filter((row) => Array.isArray(row) && Number.isFinite(Number(row[0])) && Number.isFinite(Number(row[1])))
      .map((row) => [Number(row[0]), Number(row[1])])
      .sort((a, b) => a[0] - b[0]);
  }

  function smoothRows(rows) {
    return rows.map((row, index) => {
      const neighbourhood = rows
        .slice(Math.max(0, index - 1), Math.min(rows.length, index + 2))
        .map((item) => item[1]);
      return [row[0], medianOf(neighbourhood)];
    });
  }

  function rowsBetween(rows, start, end) {
    return rows.filter((row) => row[0] >= start && row[0] <= end);
  }

  function closest(rows, target, tolerance = 8) {
    let best = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const current = Math.abs(row[0] - target);
      if (current < distance) {
        best = row;
        distance = current;
      }
    }
    return distance <= tolerance ? best : null;
  }

  function maxGap(rows) {
    let result = 0;
    for (let index = 1; index < rows.length; index += 1) {
      result = Math.max(result, rows[index][0] - rows[index - 1][0]);
    }
    return result;
  }

  function localDayKey(minute) {
    const date = new Date(minute * MINUTE_MS);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function localHour(minute) {
    return new Date(minute * MINUTE_MS).getHours();
  }

  function contextIndex(clinical, diary) {
    const meals = (diary || [])
      .filter((entry) => MEAL_OCCASIONS.has(entry.occasion))
      .map((entry) => ({
        minute: parseTime(entry.when),
        entry,
      }))
      .filter((item) => Number.isFinite(item.minute));
    const illnessDays = new Set(
      (diary || [])
        .filter((entry) => entry.illness === 'ja')
        .map((entry) => parseTime(entry.when))
        .filter(Number.isFinite)
        .map(localDayKey),
    );
    const diaryActivity = (diary || [])
      .map((entry) => ({ minute: parseTime(entry.when), value: String(entry.activity || '') }))
      .filter((item) => Number.isFinite(item.minute) && item.value.trim());
    const diaryHypo = (diary || [])
      .map((entry) => ({
        minute: parseTime(entry.when),
        text: `${entry.occasion || ''} ${entry.food || ''} ${entry.notes || ''}`,
      }))
      .filter((item) => Number.isFinite(item.minute) && /unterzucker|hypo|traubenzucker|saft|zucker/i.test(item.text));

    return {
      meals,
      illnessDays,
      diaryActivity,
      diaryHypo,
      foodEvents: clinical?.foodEvents || [],
      cgmCarbs: clinical?.cgmCarbs || [],
      exerciseEvents: clinical?.exerciseEvents || [],
      basalEvents: clinical?.basalEvents || [],
      alarms: clinical?.alarms || [],
      manualInsulin: clinical?.manualInsulin || [],
    };
  }

  function pumpBoluses(clinical) {
    return (clinical?.boluses || [])
      .filter((row) => Array.isArray(row) && Number.isFinite(Number(row[0])) && number(row[2]) > 0)
      .map((row, index) => ({
        id: `pump-${Number(row[0])}-${index}`,
        minute: Number(row[0]),
        carbs: number(row[1]),
        units: number(row[2]),
        enteredGlucose: number(row[3]),
        insulinType: String(row[4] || '').trim(),
        source: 'Pumpe',
        raw: row,
      }));
  }

  function manualBoluses(clinical) {
    return (clinical?.manualInsulin || [])
      .filter((row) => Array.isArray(row) && Number.isFinite(Number(row[0])) && number(row[2]) > 0)
      .map((row, index) => ({
        id: `manual-${Number(row[0])}-${index}`,
        minute: Number(row[0]),
        carbs: null,
        units: number(row[2]),
        enteredGlucose: null,
        insulinType: String(row[3] || row[1] || '').trim(),
        source: 'manuell',
        raw: row,
      }));
  }

  function allBoluses(clinical) {
    const events = [...pumpBoluses(clinical), ...manualBoluses(clinical)]
      .sort((a, b) => a.minute - b.minute);
    const deduplicated = [];
    for (const event of events) {
      const duplicate = deduplicated.find(
        (other) => Math.abs(other.minute - event.minute) <= 1 && Math.abs(other.units - event.units) < 0.01,
      );
      if (!duplicate) deduplicated.push(event);
    }
    return deduplicated;
  }

  function hasPositiveCarbs(row) {
    return number(row?.[1]) > 0;
  }

  function isCorrectionBolus(event) {
    return !(number(event?.carbs) > 0);
  }

  function eventWithin(rows, start, end, predicate = () => true) {
    return (rows || []).some(
      (row) => Array.isArray(row) && Number(row[0]) >= start && Number(row[0]) <= end && predicate(row),
    );
  }

  function mealEvidence(event, context) {
    const start = event.minute - MEAL_LOOKBACK_MINUTES;
    const end = event.minute + MEAL_LOOKAHEAD_MINUTES;
    const reasons = [];
    if (event.carbs > 0) reasons.push('Kohlenhydrate im Boluseintrag');
    if (context.meals.some((item) => item.minute >= start && item.minute <= end)) {
      reasons.push('Tagebuch-Mahlzeit im Wirkfenster');
    }
    if (eventWithin(context.foodEvents, start, end)) reasons.push('Lebensmitteleintrag im Wirkfenster');
    if (eventWithin(context.cgmCarbs, start, end, hasPositiveCarbs)) {
      reasons.push('CGM-Kohlenhydrate im Wirkfenster');
    }
    return reasons;
  }

  function basalDisturbance(context, start, end) {
    return (context.basalEvents || []).some((row) => {
      if (!Array.isArray(row) || Number(row[0]) < start || Number(row[0]) > end) return false;
      const label = String(row[1] || '').toLocaleLowerCase('de-DE');
      const percentage = number(row[3]);
      const rate = number(row[4]);
      return /temp|tempor|unterbrech|suspend|stop|reduz|erhöh|activity|sport/.test(label) ||
        (percentage !== null && Math.abs(percentage - 100) > 0.1) ||
        rate === 0;
    });
  }

  function pumpDisturbance(context, start, end) {
    return (context.alarms || []).some((row) => {
      if (!Array.isArray(row) || Number(row[0]) < start || Number(row[0]) > end) return false;
      return /pod|okklusion|kanül|reservoir|insulinabgabe|unterbrochen|fehler/i.test(String(row[1] || ''));
    });
  }

  function sustainedObservedDecline(rows, eventMinute) {
    for (let index = 0; index <= rows.length - ONSET_POINTS; index += 1) {
      const group = rows.slice(index, index + ONSET_POINTS);
      if (group[0][0] < eventMinute + 10) continue;
      if (group.at(-1)[0] - group[0][0] < 14) continue;
      const steps = group.slice(1).map((row, stepIndex) => row[1] - group[stepIndex][1]);
      if (
        steps.filter((delta) => delta <= 1).length >= ONSET_POINTS - 2 &&
        group[0][1] - group.at(-1)[1] >= ONSET_CONFIRMED_MGDL
      ) {
        return group[0];
      }
    }
    return null;
  }

  function stablePhase(rows, nadirMinute) {
    const eligible = rows.filter((row) => row[0] >= nadirMinute);
    for (let index = 0; index < eligible.length; index += 1) {
      const start = eligible[index][0];
      const window = eligible.filter((row) => row[0] >= start && row[0] <= start + STABLE_WINDOW_MINUTES);
      if (window.length < 6 || window.at(-1)[0] - start < 25) continue;
      const values = window.map((row) => row[1]);
      const range = Math.max(...values) - Math.min(...values);
      const slope = linearSlope(window);
      if (range <= STABLE_RANGE_MGDL && Math.abs(slope || 0) <= STABLE_SLOPE_MGDL_PER_MINUTE) {
        return { minute: start, range: round(range, 1), slope: round(slope || 0, 3) };
      }
    }
    return null;
  }

  function effectOnset(effectRows) {
    for (let index = 0; index <= effectRows.length - ONSET_POINTS; index += 1) {
      const group = effectRows.slice(index, index + ONSET_POINTS);
      if (group[0].offset < 10 || group.at(-1).offset - group[0].offset < 14) continue;
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

  function maximumDropRate(rows, eventMinute) {
    let best = null;
    for (const row of rows) {
      if (row[0] < eventMinute + 15) continue;
      const previous = closest(rows, row[0] - 15, 7);
      if (!previous) continue;
      const change = row[1] - previous[1];
      if (!best || change < best.change) {
        best = { minute: row[0], change, ratePer15: change };
      }
    }
    return best;
  }

  function actionEnd(effectRows, peakEffect) {
    if (!peakEffect || peakEffect.effect < ONSET_CONFIRMED_MGDL) return null;
    const threshold = Math.max(
      END_ABSOLUTE_EFFECT_MGDL,
      peakEffect.effect * END_REMAINING_FRACTION,
    );
    for (const candidate of effectRows) {
      if (candidate.offset <= peakEffect.offset) continue;
      const window = effectRows.filter(
        (row) => row.offset >= candidate.offset && row.offset <= candidate.offset + END_CONFIRMATION_MINUTES,
      );
      if (window.length < 6 || window.at(-1).offset - candidate.offset < 25) continue;
      const rawRows = window.map((row) => [row.minute, row.observed]);
      const range = Math.max(...window.map((row) => row.effect));
      const slope = linearSlope(rawRows);
      if (range <= threshold && Math.abs(slope || 0) <= 0.35) {
        return { ...candidate, threshold: round(threshold, 1) };
      }
    }
    return null;
  }

  function positiveAuc(effectRows) {
    let area = 0;
    for (let index = 1; index < effectRows.length; index += 1) {
      const previous = effectRows[index - 1];
      const current = effectRows[index];
      const widthHours = (current.minute - previous.minute) / 60;
      area += widthHours * (Math.max(0, previous.effect) + Math.max(0, current.effect)) / 2;
    }
    return round(area, 1);
  }

  function profileForEvent(effectRows, peakEffect) {
    if (!peakEffect || peakEffect.effect <= 0) return [];
    const result = [];
    for (let offset = 0; offset <= ACTION_WINDOW_MINUTES; offset += 15) {
      const row = effectRows
        .slice()
        .sort((a, b) => Math.abs(a.offset - offset) - Math.abs(b.offset - offset))[0];
      if (!row || Math.abs(row.offset - offset) > 8) continue;
      result.push([offset, round(Math.max(0, row.effect) / peakEffect.effect * 100, 1)]);
    }
    return result;
  }

  function analyzeBolus(event, allEvents, exactCgm, context) {
    const start = event.minute - PRE_MINUTES;
    const end = event.minute + ACTION_WINDOW_MINUTES;
    const rawWindow = rowsBetween(exactCgm, start, end);
    const smoothedWindow = smoothRows(rawWindow);
    const pre = smoothedWindow.filter((row) => row[0] <= event.minute);
    const post = smoothedWindow.filter((row) => row[0] >= event.minute);
    const expectedPoints = Math.floor((end - start) / 5) + 1;
    const coverage = expectedPoints ? rawWindow.length / expectedPoints : 0;
    const gap = maxGap(rawWindow);
    const preSlopeRaw = linearSlope(pre);
    const preSlope = Number.isFinite(preSlopeRaw)
      ? Math.max(-0.5, Math.min(0.5, preSlopeRaw))
      : 0;
    const baseline = medianOf(pre.slice(-3).map((row) => row[1]));
    const mealReasons = mealEvidence(event, context);
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
      (item) => item.minute >= event.minute - 60 && item.minute <= event.minute + ACTION_WINDOW_MINUTES,
    );
    const illness = context.illnessDays.has(localDayKey(event.minute));
    const basalIssue = basalDisturbance(context, event.minute - 60, end);
    const pumpIssue = pumpDisturbance(context, event.minute - 60, end);

    const exclusionReasons = [];
    if (mealReasons.length) exclusionReasons.push(...mealReasons);
    if (otherBolus) exclusionReasons.push('weiterer Bolus im Isolationsfenster');
    if (exercise) exclusionReasons.push('Sport/Aktivität im Einflussfenster');
    if (hypoTreatment) exclusionReasons.push('mögliche Hypobehandlung im Einflussfenster');
    if (illness) exclusionReasons.push('Krankheit am Ereignistag');
    if (basalIssue) exclusionReasons.push('veränderte oder unterbrochene Basalabgabe');
    if (pumpIssue) exclusionReasons.push('Pumpen-/Pod-Ereignis im Einflussfenster');
    if (pre.length < 5) exclusionReasons.push('zu wenige CGM-Werte vor dem Bolus');
    if (coverage < MIN_CGM_COVERAGE) exclusionReasons.push('CGM-Abdeckung unter 80 %');
    if (gap > MAX_CGM_GAP_MINUTES) exclusionReasons.push('CGM-Lücke über 15 Minuten');
    if (!Number.isFinite(baseline)) exclusionReasons.push('kein belastbarer Ausgangswert');
    if (Number.isFinite(baseline) && baseline < 70) exclusionReasons.push('Ausgangswert unter 70 mg/dl');
    if (Math.abs(preSlopeRaw || 0) > 0.35) exclusionReasons.push('starker Ausgangstrend vor dem Bolus');

    const effectRows = Number.isFinite(baseline)
      ? post.map((row) => {
          const offset = row[0] - event.minute;
          const expected = baseline + preSlope * Math.min(Math.max(offset, 0), PRE_MINUTES);
          return {
            minute: row[0],
            offset,
            observed: row[1],
            expected,
            effect: expected - row[1],
          };
        })
      : [];
    const onset = effectOnset(effectRows);
    const peakEffect = effectRows.reduce(
      (best, row) => !best || row.effect > best.effect ? row : best,
      null,
    );
    const endEffect = actionEnd(effectRows, peakEffect);
    const decline = sustainedObservedDecline(post, event.minute);
    const maxDrop = maximumDropRate(post, event.minute);
    const nadir = post.reduce(
      (best, row) => !best || row[1] < best[1] ? row : best,
      null,
    );
    const stable = nadir ? stablePhase(post, nadir[0]) : null;
    const correctionBolus = isCorrectionBolus(event);
    const eligibleCorrection = correctionBolus && exclusionReasons.length === 0;
    const detectable = eligibleCorrection && onset && peakEffect?.effect >= ONSET_CONFIRMED_MGDL;

    let score = 100;
    score -= Math.max(0, 0.95 - coverage) * 100;
    score -= Math.min(15, Math.abs(preSlopeRaw || 0) * 30);
    score -= exclusionReasons.length * 18;
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      ...event,
      classification: correctionBolus ? 'Korrekturbolus' : 'Mahlzeitenbolus',
      mealReasons,
      exclusionReasons: [...new Set(exclusionReasons)],
      correctionBolus,
      eligibleCorrection,
      detectable: Boolean(detectable),
      qualityScore: score,
      quality: score >= 85 && eligibleCorrection ? 'hoch' : score >= 65 ? 'mittel' : 'niedrig',
      cgmCoverage: round(coverage * 100, 1),
      maxCgmGap: gap,
      baseline: round(baseline, 1),
      preSlope: round(preSlopeRaw, 3),
      observedDeclineOnset: decline ? decline[0] - event.minute : null,
      effectOnset: onset?.offset ?? null,
      maxDropRate: maxDrop ? round(maxDrop.ratePer15, 1) : null,
      maxDropRateTime: maxDrop ? maxDrop.minute - event.minute : null,
      nadir: nadir ? round(nadir[1], 1) : null,
      nadirTime: nadir ? nadir[0] - event.minute : null,
      stableTime: stable ? stable.minute - event.minute : null,
      stableRange: stable?.range ?? null,
      peakEffect: peakEffect ? round(peakEffect.effect, 1) : null,
      peakEffectTime: peakEffect?.offset ?? null,
      actionEnd: endEffect?.offset ?? null,
      effectiveDuration: onset && endEffect ? endEffect.offset - onset.offset : null,
      actionEndCensored: Boolean(detectable && !endEffect),
      actionEndThreshold: endEffect?.threshold ?? null,
      effectAuc: positiveAuc(effectRows),
      effectProfile: profileForEvent(effectRows, peakEffect),
    };
  }

  function aggregateProfile(events) {
    const bins = [];
    for (let offset = 0; offset <= ACTION_WINDOW_MINUTES; offset += 15) {
      const values = events
        .map((event) => event.effectProfile.find((row) => row[0] === offset)?.[1])
        .filter(Number.isFinite);
      if (!values.length) continue;
      bins.push({
        offset,
        n: values.length,
        median: round(median(values), 0),
        q1: round(quantile(values, 0.25), 0),
        q3: round(quantile(values, 0.75), 0),
      });
    }
    return bins;
  }

  function groupStats(events, classifier) {
    const groups = new Map();
    for (const event of events) {
      const key = classifier(event);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    return [...groups.entries()]
      .map(([label, group]) => ({
        label,
        n: group.length,
        onset: distribution(group.map((event) => event.effectOnset), 0),
        maxEffect: distribution(group.map((event) => event.peakEffectTime), 0),
        actionEnd: distribution(group.map((event) => event.actionEnd), 0),
      }))
      .filter((group) => group.n >= 2);
  }

  function confidenceFor(events, onset, actionEnd) {
    if (events.length < MIN_AGGREGATE_EVENTS) return 'nicht ausreichend';
    let level = events.length >= 12 ? 3 : events.length >= 6 ? 2 : 1;
    if (Number.isFinite(onset.q1) && Number.isFinite(onset.q3) && onset.q3 - onset.q1 > 30) level -= 1;
    if (
      Number.isFinite(actionEnd.q1) && Number.isFinite(actionEnd.q3) &&
      actionEnd.q3 - actionEnd.q1 > 90
    ) level -= 1;
    return ['niedrig', 'niedrig', 'mittel', 'hoch'][Math.max(0, level)];
  }

  function analyzeInsulinAction(clinical = {}, diary = []) {
    const exact = exactCgmRows(clinical.cgm);
    const events = allBoluses(clinical);
    const context = contextIndex(clinical, diary);
    const analyses = events.map((event) => analyzeBolus(event, events, exact, context));
    const eligible = analyses.filter((event) => event.eligibleCorrection);
    const analyzable = analyses.filter((event) => event.detectable);
    const onset = distribution(analyzable.map((event) => event.effectOnset), 0);
    const maxEffectTime = distribution(analyzable.map((event) => event.peakEffectTime), 0);
    const maxDropTime = distribution(analyzable.map((event) => event.maxDropRateTime), 0);
    const actionEnd = distribution(analyzable.map((event) => event.actionEnd), 0);
    const duration = distribution(analyzable.map((event) => event.effectiveDuration), 0);
    const nadirTime = distribution(analyzable.map((event) => event.nadirTime), 0);
    const auc = distribution(analyzable.map((event) => event.effectAuc), 1);
    const peakEffect = distribution(analyzable.map((event) => event.peakEffect), 1);

    const aggregate = {
      totalBoluses: analyses.length,
      correctionBoluses: analyses.filter((event) => event.correctionBolus).length,
      eligibleCorrections: eligible.length,
      analyzedCorrections: analyzable.length,
      excludedCorrections: analyses.filter(
        (event) => event.correctionBolus && !event.eligibleCorrection,
      ).length,
      censoredActionEnds: analyzable.filter((event) => event.actionEndCensored).length,
      sufficient: analyzable.length >= MIN_AGGREGATE_EVENTS,
      confidence: confidenceFor(analyzable, onset, actionEnd),
      onset,
      maxEffectTime,
      maxDropTime,
      actionEnd,
      duration,
      nadirTime,
      auc,
      peakEffect,
      profile: aggregateProfile(analyzable),
      byTimeOfDay: groupStats(analyzable, (event) => {
        const hour = localHour(event.minute);
        if (hour >= 4 && hour < 10) return 'Morgen (04–10 Uhr)';
        if (hour >= 10 && hour < 17) return 'Tag (10–17 Uhr)';
        if (hour >= 17 && hour < 23) return 'Abend (17–23 Uhr)';
        return 'Nacht (23–04 Uhr)';
      }),
      byBolusSize: groupStats(analyzable, (event) => {
        if (event.units < 1) return 'klein (<1 E)';
        if (event.units <= 3) return 'mittel (1–3 E)';
        return 'groß (>3 E)';
      }),
    };

    return { events: analyses, aggregate };
  }

  function formatNumber(value, digits = 0) {
    if (!Number.isFinite(value)) return '–';
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(value);
  }

  function formatMinutes(value) {
    if (!Number.isFinite(value)) return '–';
    if (value < 60) return `${formatNumber(value, 0)} min`;
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  }

  function formatDistribution(item, unit = 'min') {
    if (!item || !item.n || !Number.isFinite(item.median)) return 'nicht bestimmbar';
    const value = unit === 'min' ? formatMinutes(item.median) : `${formatNumber(item.median, 1)} ${unit}`;
    const q1 = unit === 'min' ? formatMinutes(item.q1) : `${formatNumber(item.q1, 1)} ${unit}`;
    const q3 = unit === 'min' ? formatMinutes(item.q3) : `${formatNumber(item.q3, 1)} ${unit}`;
    return `${value} (mittlere 50 %: ${q1}–${q3})`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function eventDateTime(minute) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(minute * MINUTE_MS));
  }

  function renderSummary(aggregate) {
    const target = document.querySelector('#insulin-summary');
    if (!target) return;
    const cards = [
      ['Bolusereignisse', aggregate.totalBoluses],
      ['Korrekturboli ohne KH-Eingabe', aggregate.correctionBoluses],
      ['streng isoliert', aggregate.eligibleCorrections],
      ['mit erkennbarem Effekt', aggregate.analyzedCorrections],
      ['geschätzter Wirkbeginn', aggregate.sufficient ? formatDistribution(aggregate.onset) : 'zu wenige Ereignisse'],
      ['Vertrauensstufe', aggregate.confidence],
    ];
    target.innerHTML = cards.map(([label, value]) =>
      `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    ).join('');
  }

  function renderAggregate(aggregate) {
    const target = document.querySelector('#insulin-aggregate');
    if (!target) return;
    if (!aggregate.sufficient) {
      target.innerHTML =
        `<div class="notice info"><strong>Noch keine belastbare persönliche Wirkungskurve.</strong> ` +
        `Mindestens ${MIN_AGGREGATE_EVENTS} streng isolierte Korrekturereignisse mit erkennbarem ` +
        `Effekt sind erforderlich; aktuell sind es ${aggregate.analyzedCorrections}. ` +
        `Aus Mahlzeitenboli wird keine pharmakodynamische Wirkzeit abgeleitet.</div>`;
      return;
    }
    target.innerHTML = `
      <ul class="facts insulin-facts">
        <li><span>erkennbare trendbereinigte Senkung</span><strong>${escapeHtml(formatDistribution(aggregate.onset))}</strong></li>
        <li><span>maximale trendbereinigte Abweichung</span><strong>${escapeHtml(formatDistribution(aggregate.maxEffectTime))}</strong></li>
        <li><span>stärkste 15-min-Senkungsrate</span><strong>${escapeHtml(formatDistribution(aggregate.maxDropTime))}</strong></li>
        <li><span>Glukosenadir</span><strong>${escapeHtml(formatDistribution(aggregate.nadirTime))}</strong></li>
        <li><span>Restwirkung unter 10 % / 5 mg/dl</span><strong>${escapeHtml(formatDistribution(aggregate.actionEnd))}</strong></li>
        <li><span>effektive Dauer ab erkanntem Beginn</span><strong>${escapeHtml(formatDistribution(aggregate.duration))}</strong></li>
        <li><span>nicht innerhalb 5 h abgeklungen</span><strong>${aggregate.censoredActionEnds}</strong></li>
        <li><span>Vertrauensstufe</span><strong>${escapeHtml(aggregate.confidence)}</strong></li>
      </ul>`;
  }

  function renderProfile(aggregate) {
    const body = document.querySelector('#insulin-profile');
    if (!body) return;
    body.innerHTML = aggregate.profile.map((bin) => `
      <tr>
        <td>${formatMinutes(bin.offset)}</td>
        <td>${bin.n}</td>
        <td>${formatNumber(bin.median, 0)} %</td>
        <td>${formatNumber(bin.q1, 0)}–${formatNumber(bin.q3, 0)} %</td>
      </tr>`).join('');
    const empty = document.querySelector('#insulin-profile-empty');
    if (empty) empty.hidden = aggregate.profile.length > 0;
  }

  function renderGroups(aggregate) {
    const body = document.querySelector('#insulin-groups');
    if (!body) return;
    const groups = [...aggregate.byTimeOfDay, ...aggregate.byBolusSize];
    body.innerHTML = groups.map((group) => `
      <tr>
        <td>${escapeHtml(group.label)}</td>
        <td>${group.n}</td>
        <td>${escapeHtml(formatDistribution(group.onset))}</td>
        <td>${escapeHtml(formatDistribution(group.maxEffect))}</td>
        <td>${escapeHtml(formatDistribution(group.actionEnd))}</td>
      </tr>`).join('');
    const empty = document.querySelector('#insulin-groups-empty');
    if (empty) empty.hidden = groups.length > 0;
  }

  function eventStatus(event) {
    if (event.detectable) return ['ok', 'auswertbar'];
    if (event.eligibleCorrection) return ['partial', 'kein stabil erkennbarer Effekt'];
    if (event.correctionBolus) return ['partial', 'ausgeschlossen'];
    return ['wait', 'Mahlzeitenbolus'];
  }

  function renderEvents(events) {
    const target = document.querySelector('#insulin-events');
    if (!target) return;
    if (!events.length) {
      target.innerHTML = '<div class="empty-state">Noch keine positiven Bolusereignisse importiert.</div>';
      return;
    }
    target.innerHTML = [...events]
      .sort((a, b) => b.minute - a.minute)
      .map((event) => {
        const [statusClass, statusText] = eventStatus(event);
        const reasons = event.exclusionReasons.length
          ? `<p class="muted compact"><strong>Einflussfaktoren/Ausschluss:</strong> ${escapeHtml(event.exclusionReasons.join('; '))}</p>`
          : '<p class="muted compact">Keine der derzeit geprüften Störvariablen erkannt.</p>';
        return `
          <article class="analysis-item insulin-event" data-event-id="${escapeHtml(event.id)}">
            <div class="analysis-head">
              <div><strong>${formatNumber(event.units, 2)} E · ${escapeHtml(event.classification)}</strong><br><small>${escapeHtml(eventDateTime(event.minute))} · ${escapeHtml(event.source)}${event.insulinType ? ` · ${escapeHtml(event.insulinType)}` : ''}</small></div>
              <span class="status ${statusClass}">${escapeHtml(statusText)}</span>
            </div>
            <div class="analysis-grid insulin-event-grid">
              <div><span>Ausgangswert</span><strong>${formatNumber(event.baseline, 0)} mg/dl</strong></div>
              <div><span>Ausgangstrend</span><strong>${Number.isFinite(event.preSlope) ? `${formatNumber(event.preSlope * 15, 1)} mg/dl / 15 min` : '–'}</strong></div>
              <div><span>beobachteter anhaltender Abfall</span><strong>${formatMinutes(event.observedDeclineOnset)}</strong></div>
              <div><span>geschätzter Effektbeginn</span><strong>${formatMinutes(event.effectOnset)}</strong></div>
              <div><span>stärkste Senkungsrate</span><strong>${Number.isFinite(event.maxDropRate) ? `${formatNumber(event.maxDropRate, 1)} mg/dl / 15 min · ${formatMinutes(event.maxDropRateTime)}` : '–'}</strong></div>
              <div><span>maximale trendbereinigte Wirkung</span><strong>${Number.isFinite(event.peakEffect) ? `${formatNumber(event.peakEffect, 1)} mg/dl · ${formatMinutes(event.peakEffectTime)}` : '–'}</strong></div>
              <div><span>Nadir</span><strong>${Number.isFinite(event.nadir) ? `${formatNumber(event.nadir, 0)} mg/dl · ${formatMinutes(event.nadirTime)}` : '–'}</strong></div>
              <div><span>erste stabile Phase</span><strong>${Number.isFinite(event.stableTime) ? `${formatMinutes(event.stableTime)} · Spanne ${formatNumber(event.stableRange, 1)} mg/dl` : 'nicht erkannt'}</strong></div>
              <div><span>Restwirkung unter Schwelle</span><strong>${Number.isFinite(event.actionEnd) ? formatMinutes(event.actionEnd) : event.actionEndCensored ? '>5 h / zensiert' : 'nicht bestimmbar'}</strong></div>
              <div><span>Effektfläche</span><strong>${Number.isFinite(event.effectAuc) ? `${formatNumber(event.effectAuc, 1)} mg/dl·h` : '–'}</strong></div>
              <div><span>CGM-Abdeckung</span><strong>${formatNumber(event.cgmCoverage, 1)} %</strong></div>
              <div><span>Qualität</span><strong>${escapeHtml(event.quality)} (${event.qualityScore}/100)</strong></div>
            </div>
            ${reasons}
          </article>`;
      })
      .join('');
  }

  function renderInsulinAction() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined') return;
    const result = analyzeInsulinAction(gcState.clinical || {}, gcState.diary || []);
    renderSummary(result.aggregate);
    renderAggregate(result.aggregate);
    renderProfile(result.aggregate);
    renderGroups(result.aggregate);
    renderEvents(result.events);
    const note = document.querySelector('#insulin-method-note');
    if (note) {
      note.textContent =
        'Boluseinträge ohne positive Kohlenhydratangabe werden immer als Korrekturbolus klassifiziert. ' +
        'Ein Mahlzeitenhinweis im Umfeld kann ein solches Ereignis aus der isolierten Wirkungsanalyse ausschließen, ändert aber nicht seine Klassifikation. ' +
        'Die Pumpeneinstellung von 2 Stunden wird für diese Schätzung nicht verwendet. ' +
        'Die Analyse betrachtet bis zu 5 Stunden nach dem tatsächlichen Boluszeitpunkt. ' +
        '„Stabile Glukose“ und „Insulin wirkt nicht mehr“ sind nicht gleichbedeutend. ' +
        'Die trendbereinigte Abweichung ist ein retrospektives Modell, keine pharmakologische Messung ' +
        'und keine Empfehlung zur Änderung von Pumpenparametern.';
    }
  }

  function installBrowserPatch() {
    if (
      typeof document === 'undefined' ||
      typeof gcRender !== 'function'
    ) return;
    const previousRender = gcRender;
    gcRender = function renderWithInsulinAction() {
      previousRender();
      renderInsulinAction();
    };
    if (typeof GlucoseCoachV3 !== 'undefined') {
      Object.assign(GlucoseCoachV3, {
        analyzeInsulinAction,
        GC_INSULIN_ACTION_WINDOW_MINUTES: ACTION_WINDOW_MINUTES,
        GC_INSULIN_MIN_AGGREGATE_EVENTS: MIN_AGGREGATE_EVENTS,
      });
    }
    gcRender();
  }

  const api = {
    analyzeInsulinAction,
    analyzeBolus,
    aggregateProfile,
    distribution,
    formatMinutes,
    GC_INSULIN_ACTION_WINDOW_MINUTES: ACTION_WINDOW_MINUTES,
    GC_INSULIN_MIN_AGGREGATE_EVENTS: MIN_AGGREGATE_EVENTS,
    GC_INSULIN_MIN_CGM_COVERAGE: MIN_CGM_COVERAGE,
    GC_INSULIN_END_REMAINING_FRACTION: END_REMAINING_FRACTION,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  installBrowserPatch();
})();
