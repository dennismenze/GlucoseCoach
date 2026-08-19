(function () {
  'use strict';

  const C = Object.freeze({
    MINUTE_MS: 60_000,
    GRID_MINUTES: 5,
    PRE_WINDOW_MINUTES: 30,
    DEFAULT_ACTION_WINDOW_MINUTES: 300,
    MIN_MODEL_WINDOW_MINUTES: 240,
    PREVIOUS_INSULIN_EXCLUSION_MINUTES: 120,
    NEXT_INSULIN_EXCLUSION_MINUTES: 240,
    MEAL_BEFORE_MINUTES: 30,
    EXERCISE_BEFORE_MINUTES: 120,
    START_GLUCOSE_MIN: 100,
    CORRECTION_CARBS_MAX: 0.5,
    MODEL_MIN_EVENTS: 5,
    ONSET_MIN_OFFSET: 10,
    ONSET_SLOPE_THRESHOLD: -0.15,
    ONSET_CONFIRMATION_POINTS: 3,
    ONSET_DROP_MGDL: 5,
    STABLE_WINDOW_MINUTES: 30,
    STABLE_RANGE_MGDL: 10,
    STABLE_SLOPE_ABS: 0.12,
    END_CONFIRMATION_POINTS: 6,
    END_RATE_FRACTION: 0.10,
    END_REBOUND_FRACTION: 0.20,
    SETTINGS_KEY: 'glucosecoach-insulin-settings-v1',
  });
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
  const DEFAULT_SETTINGS = Object.freeze({
    preparation: '',
    actionWindowMinutes: C.DEFAULT_ACTION_WINDOW_MINUTES,
  });

  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function mean(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function median(values) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return null;
    const middle = Math.floor(valid.length / 2);
    return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
  }

  function quantile(values, probability) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return null;
    if (valid.length === 1) return valid[0];
    const position = (valid.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return valid[lower];
    return valid[lower] + (valid[upper] - valid[lower]) * (position - lower);
  }

  function summary(values, digits = 0) {
    const valid = values.filter(Number.isFinite);
    return {
      n: valid.length,
      median: round(median(valid), digits),
      q1: round(quantile(valid, 0.25), digits),
      q3: round(quantile(valid, 0.75), digits),
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function parseTime(value) {
    const source = String(value ?? '').trim();
    if (!source) return null;
    const german = source.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})/);
    if (german) {
      const date = new Date(
        Number(german[3]), Number(german[2]) - 1, Number(german[1]),
        Number(german[4]), Number(german[5]),
      );
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / C.MINUTE_MS);
    }
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / C.MINUTE_MS);
  }

  function sameLocalDay(first, second) {
    const a = new Date(first * C.MINUTE_MS);
    const b = new Date(second * C.MINUTE_MS);
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function timeOfDay(minute) {
    const hour = new Date(minute * C.MINUTE_MS).getHours();
    if (hour >= 5 && hour < 11) return 'Morgen (05–11)';
    if (hour >= 11 && hour < 17) return 'Tag (11–17)';
    if (hour >= 17 && hour < 23) return 'Abend (17–23)';
    return 'Nacht (23–05)';
  }

  function doseBand(dose) {
    if (dose < 0.5) return '<0,5 E';
    if (dose <= 1) return '0,5–1,0 E';
    return '>1,0 E';
  }

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    const actionWindow = Number(source.actionWindowMinutes);
    return {
      preparation: String(source.preparation ?? '').trim().slice(0, 80),
      actionWindowMinutes: [240, 300, 360].includes(actionWindow)
        ? actionWindow
        : C.DEFAULT_ACTION_WINDOW_MINUTES,
    };
  }

  function normalizeClinical(value) {
    const source = value && typeof value === 'object' ? value : {};
    const array = (key) => Array.isArray(source[key]) ? source[key] : [];
    return {
      cgm: array('cgm'),
      boluses: array('boluses'),
      basalEvents: array('basalEvents'),
      cgmCarbs: array('cgmCarbs'),
      exerciseEvents: array('exerciseEvents'),
      foodEvents: array('foodEvents'),
      manualInsulin: array('manualInsulin'),
      alarms: array('alarms'),
      notes: array('notes'),
    };
  }

  function insulinEvents(clinicalValue) {
    const clinical = normalizeClinical(clinicalValue);
    const pump = clinical.boluses.map((row, index) => ({
      id: `pump:${Number(row[0])}:${index}`,
      source: 'Pumpe', minute: Number(row[0]), carbs: number(row[1]) ?? 0,
      dose: number(row[2]) ?? 0, enteredGlucose: number(row[3]),
      deliveryType: String(row[4] ?? '').trim() || 'nicht angegeben',
    }));
    const manual = clinical.manualInsulin.map((row, index) => ({
      id: `manual:${Number(row[0])}:${index}`,
      source: 'manuell', minute: Number(row[0]), carbs: 0,
      dose: number(row[2]) ?? 0, enteredGlucose: null,
      deliveryType: String(row[3] ?? row[1] ?? '').trim() || 'nicht angegeben',
    }));
    return [...pump, ...manual]
      .filter((event) => Number.isFinite(event.minute) && event.dose > 0)
      .sort((a, b) => a.minute - b.minute);
  }

  function mealEvents(clinicalValue, diary = []) {
    const clinical = normalizeClinical(clinicalValue);
    const events = [];
    for (const row of clinical.boluses) {
      const carbs = number(row[1]);
      if (Number.isFinite(Number(row[0])) && carbs !== null && carbs > C.CORRECTION_CARBS_MAX) {
        events.push({ minute: Number(row[0]), source: 'Bolus-Kohlenhydrate', carbs });
      }
    }
    for (const row of clinical.cgmCarbs) {
      const carbs = number(row[1]);
      if (Number.isFinite(Number(row[0])) && carbs !== null && carbs > C.CORRECTION_CARBS_MAX) {
        events.push({ minute: Number(row[0]), source: 'CGM-Kohlenhydrate', carbs });
      }
    }
    for (const row of clinical.foodEvents) {
      if (Number.isFinite(Number(row[0]))) {
        events.push({ minute: Number(row[0]), source: 'Lebensmittel', carbs: number(row[2]) });
      }
    }
    for (const entry of diary || []) {
      if (!MEAL_OCCASIONS.has(entry.occasion)) continue;
      const minute = parseTime(entry.when);
      if (minute !== null) events.push({ minute, source: 'Tagebuch', carbs: number(entry.carbs) });
    }
    return events.sort((a, b) => a.minute - b.minute);
  }

  function exerciseEvents(clinicalValue, diary = []) {
    const clinical = normalizeClinical(clinicalValue);
    const events = clinical.exerciseEvents
      .filter((row) => Number.isFinite(Number(row[0])))
      .map((row) => ({ minute: Number(row[0]), source: String(row[1] ?? 'Sport') }));
    for (const entry of diary || []) {
      if (entry.occasion !== 'Sport') continue;
      const minute = parseTime(entry.when);
      if (minute !== null) events.push({ minute, source: 'Tagebuch-Sport' });
    }
    return events.sort((a, b) => a.minute - b.minute);
  }

  function illnessAt(minute, diary = []) {
    return (diary || []).some((entry) => {
      if (entry.illness !== 'ja') return false;
      const entryMinute = parseTime(entry.when);
      return entryMinute !== null && sameLocalDay(minute, entryMinute);
    });
  }

  function basalChanges(clinicalValue) {
    const clinical = normalizeClinical(clinicalValue);
    return clinical.basalEvents
      .filter((row) => Number.isFinite(Number(row[0])))
      .filter((row) => {
        const type = String(row[1] ?? '').toLocaleLowerCase('de-DE');
        const percentage = number(row[3]);
        return (!type.includes('eingeplant') && !type.includes('scheduled'))
          || (percentage !== null && percentage !== 100);
      })
      .map((row) => ({ minute: Number(row[0]), type: String(row[1] ?? '') }));
  }

  function lowAlerts(clinicalValue) {
    const clinical = normalizeClinical(clinicalValue);
    return clinical.alarms
      .filter((row) => Number.isFinite(Number(row[0])))
      .filter((row) => /unter|niedrig|low|hypo/i.test(String(row[1] ?? '')))
      .map((row) => ({ minute: Number(row[0]), text: String(row[1] ?? '') }));
  }

  function nearestCgmGrid(cgmRows, minute, actionWindowMinutes) {
    const sorted = (cgmRows || [])
      .filter((row) => Array.isArray(row) && Number.isFinite(Number(row[0])))
      .map((row) => [Number(row[0]), row[1] === null ? null : number(row[1]), Number(row[2] ?? 0)])
      .sort((a, b) => a[0] - b[0]);
    const offsets = [];
    const values = [];
    const flags = [];
    let cursor = 0;
    for (let offset = -C.PRE_WINDOW_MINUTES; offset <= actionWindowMinutes; offset += C.GRID_MINUTES) {
      const target = minute + offset;
      while (cursor < sorted.length && sorted[cursor][0] < target - 3) cursor += 1;
      const candidates = [];
      for (const index of [cursor - 1, cursor, cursor + 1]) {
        if (index < 0 || index >= sorted.length) continue;
        const distance = Math.abs(sorted[index][0] - target);
        if (distance <= 3) candidates.push({ distance, row: sorted[index] });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      const row = candidates[0]?.row || null;
      offsets.push(offset);
      values.push(row && row[1] !== null ? row[1] : null);
      flags.push(row ? row[2] : null);
    }
    return { offsets, values, flags };
  }

  function medianSmooth(values) {
    return values.map((value, index) => {
      if (!Number.isFinite(value)) return null;
      const window = values.slice(Math.max(0, index - 1), Math.min(values.length, index + 2))
        .filter(Number.isFinite);
      return median(window);
    });
  }

  function localSlopes(offsets, values) {
    return values.map((value, index) => {
      if (!Number.isFinite(value)) return null;
      let left = null;
      let right = null;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (offsets[index] - offsets[cursor] > 15) break;
        if (Number.isFinite(values[cursor])) left = cursor;
      }
      for (let cursor = index + 1; cursor < values.length; cursor += 1) {
        if (offsets[cursor] - offsets[index] > 15) break;
        if (Number.isFinite(values[cursor])) right = cursor;
      }
      if (left !== null && right !== null) {
        return (values[right] - values[left]) / (offsets[right] - offsets[left]);
      }
      if (right !== null) return (values[right] - value) / (offsets[right] - offsets[index]);
      if (left !== null) return (value - values[left]) / (offsets[index] - offsets[left]);
      return null;
    });
  }

  function linearSlope(offsets, values, minimum, maximum) {
    const points = offsets.map((offset, index) => ({ offset, value: values[index] }))
      .filter((point) => point.offset >= minimum && point.offset <= maximum && Number.isFinite(point.value));
    if (points.length < 4) return null;
    const xMean = mean(points.map((point) => point.offset));
    const yMean = mean(points.map((point) => point.value));
    const denominator = points.reduce((sum, point) => sum + (point.offset - xMean) ** 2, 0);
    if (!denominator) return null;
    return points.reduce((sum, point) =>
      sum + (point.offset - xMean) * (point.value - yMean), 0) / denominator;
  }

  function firstSustainedOnset(offsets, smoothed, slopes, contextEndMinutes) {
    for (let index = 0; index <= offsets.length - C.ONSET_CONFIRMATION_POINTS; index += 1) {
      if (offsets[index] < C.ONSET_MIN_OFFSET || offsets[index] > contextEndMinutes) continue;
      const slopeWindow = slopes.slice(index, index + C.ONSET_CONFIRMATION_POINTS);
      const valueWindow = smoothed.slice(index, index + C.ONSET_CONFIRMATION_POINTS);
      if (slopeWindow.every((value) => Number.isFinite(value) && value <= C.ONSET_SLOPE_THRESHOLD)
        && valueWindow.every(Number.isFinite)
        && valueWindow[0] - valueWindow.at(-1) >= C.ONSET_DROP_MGDL) {
        return offsets[index];
      }
    }
    return null;
  }

  function strongestDecline(offsets, slopes, onsetMinutes, contextEndMinutes) {
    if (!Number.isFinite(onsetMinutes)) return { minute: null, rate: null };
    let best = null;
    for (let index = 0; index < offsets.length; index += 1) {
      if (offsets[index] < onsetMinutes || offsets[index] > Math.min(240, contextEndMinutes)) continue;
      const slope = slopes[index];
      if (!Number.isFinite(slope)) continue;
      if (!best || slope < best.slope) best = { minute: offsets[index], slope };
    }
    return best ? { minute: best.minute, rate: round(Math.max(0, -best.slope), 2) }
      : { minute: null, rate: null };
  }

  function nadirPoint(offsets, smoothed, onsetMinutes, contextEndMinutes) {
    if (!Number.isFinite(onsetMinutes)) return { minute: null, value: null };
    let best = null;
    for (let index = 0; index < offsets.length; index += 1) {
      if (offsets[index] < onsetMinutes || offsets[index] > contextEndMinutes) continue;
      const value = smoothed[index];
      if (!Number.isFinite(value)) continue;
      if (!best || value < best.value) best = { minute: offsets[index], value };
    }
    return best ? { minute: best.minute, value: round(best.value, 0) }
      : { minute: null, value: null };
  }

  function stablePhase(offsets, smoothed, slopes, afterMinutes, contextEndMinutes) {
    if (!Number.isFinite(afterMinutes)) return null;
    const points = Math.floor(C.STABLE_WINDOW_MINUTES / C.GRID_MINUTES) + 1;
    for (let index = 0; index <= offsets.length - points; index += 1) {
      if (offsets[index] < afterMinutes || offsets[index] > contextEndMinutes) continue;
      const endIndex = index + points - 1;
      if (offsets[endIndex] > contextEndMinutes) continue;
      const values = smoothed.slice(index, endIndex + 1);
      const slopeValues = slopes.slice(index, endIndex + 1);
      if (!values.every(Number.isFinite) || !slopeValues.every(Number.isFinite)) continue;
      const range = Math.max(...values) - Math.min(...values);
      const slope = linearSlope(offsets.slice(index, endIndex + 1), values, offsets[index], offsets[endIndex]);
      if (Number.isFinite(slope) && range <= C.STABLE_RANGE_MGDL && Math.abs(slope) <= C.STABLE_SLOPE_ABS) {
        return offsets[index];
      }
    }
    return null;
  }

  function effectiveEnd(offsets, slopes, maxEffectMinutes, maxDeclineRate, contextEndMinutes) {
    if (!Number.isFinite(maxEffectMinutes) || !Number.isFinite(maxDeclineRate) || maxDeclineRate <= 0) return null;
    const lowThreshold = Math.max(0.1, maxDeclineRate * C.END_RATE_FRACTION);
    const reboundThreshold = Math.max(0.15, maxDeclineRate * C.END_REBOUND_FRACTION);
    for (let index = 0; index <= offsets.length - C.END_CONFIRMATION_POINTS; index += 1) {
      if (offsets[index] < maxEffectMinutes + 20 || offsets[index] > contextEndMinutes) continue;
      const endIndex = index + C.END_CONFIRMATION_POINTS - 1;
      if (offsets[endIndex] > contextEndMinutes) continue;
      const rates = slopes.slice(index, endIndex + 1)
        .map((slope) => Number.isFinite(slope) ? Math.max(0, -slope) : null);
      if (!rates.every(Number.isFinite) || !rates.every((rate) => rate <= lowThreshold)) continue;
      const laterRates = slopes.slice(endIndex + 1)
        .map((slope) => Number.isFinite(slope) ? Math.max(0, -slope) : null)
        .filter(Number.isFinite);
      if (!laterRates.length || Math.max(...laterRates) <= reboundThreshold) return offsets[index];
    }
    return null;
  }

  function contextForEvent(event, allInsulin, meals, exercises, basal, alerts, diary, actionWindowMinutes) {
    const previousInsulin = allInsulin.filter((candidate) => candidate.id !== event.id
      && candidate.minute >= event.minute - C.PREVIOUS_INSULIN_EXCLUSION_MINUTES
      && candidate.minute < event.minute);
    const nextInsulin = allInsulin.filter((candidate) => candidate.id !== event.id
      && candidate.minute > event.minute
      && candidate.minute <= event.minute + actionWindowMinutes);
    const nearbyMeals = meals.filter((candidate) => candidate.minute >= event.minute - C.MEAL_BEFORE_MINUTES
      && candidate.minute <= event.minute + actionWindowMinutes);
    const nearbyExercise = exercises.filter((candidate) => candidate.minute >= event.minute - C.EXERCISE_BEFORE_MINUTES
      && candidate.minute <= event.minute + actionWindowMinutes);
    const nearbyBasal = basal.filter((candidate) => candidate.minute >= event.minute - 60
      && candidate.minute <= event.minute + actionWindowMinutes);
    const nearbyAlerts = alerts.filter((candidate) => candidate.minute >= event.minute
      && candidate.minute <= event.minute + actionWindowMinutes);
    const mealAfter = nearbyMeals.filter((candidate) => candidate.minute > event.minute + 5)
      .sort((a, b) => a.minute - b.minute)[0] || null;
    const insulinAfter = [...nextInsulin].sort((a, b) => a.minute - b.minute)[0] || null;
    const exerciseAfter = nearbyExercise.filter((candidate) => candidate.minute > event.minute)
      .sort((a, b) => a.minute - b.minute)[0] || null;
    const stops = [mealAfter, insulinAfter, exerciseAfter].filter(Boolean)
      .map((candidate) => candidate.minute - event.minute - 5).filter((offset) => offset >= 30);
    const contextEndMinutes = Math.min(actionWindowMinutes, stops.length ? Math.min(...stops) : actionWindowMinutes);
    return {
      correctionLike: event.carbs <= C.CORRECTION_CARBS_MAX,
      previousInsulin, nextInsulin, nearbyMeals, nearbyExercise, nearbyBasal, nearbyAlerts,
      illness: illnessAt(event.minute, diary), contextEndMinutes,
      truncated: contextEndMinutes < actionWindowMinutes,
    };
  }

  function scoreEvent(event, context, features) {
    let score = 100;
    const reasons = [];
    const subtract = (points, code, label, major = false) => {
      score -= points;
      reasons.push({ code, label, points, major });
    };
    if (!context.correctionLike) subtract(45, 'meal-bolus', 'Kohlenhydrate im Bolus', true);
    if (context.previousInsulin.length) subtract(25, 'previous-insulin', 'Insulin in den 120 min davor', true);
    if (context.nextInsulin.some((candidate) => candidate.minute <= event.minute + C.NEXT_INSULIN_EXCLUSION_MINUTES)) {
      subtract(25, 'next-insulin', 'weiteres Insulin in den folgenden 240 min', true);
    }
    if (context.nearbyMeals.length) subtract(35, 'meal-context', 'Essen/Kohlenhydrate im Analysefenster', true);
    if (context.nearbyExercise.length) subtract(20, 'exercise', 'Sport im Kontext', true);
    if (context.illness) subtract(15, 'illness', 'Krankheit am selben Tag');
    if (context.nearbyBasal.length) subtract(15, 'basal-change', 'temporäre Basaländerung', true);
    if (context.nearbyAlerts.length) subtract(20, 'low-alert', 'Niedrig-/Hypowarnung im Kontext', true);
    if (features.coverage < 0.9) subtract(15, 'coverage', 'CGM-Abdeckung unter 90 %');
    if (features.coverage < 0.8) subtract(10, 'coverage-low', 'CGM-Abdeckung unter 80 %', true);
    if (features.baseline !== null && features.baseline < C.START_GLUCOSE_MIN) {
      subtract(15, 'start-low', `Ausgangswert unter ${C.START_GLUCOSE_MIN} mg/dl`);
    }
    if (features.preSlope !== null && features.preSlope < -0.3) {
      subtract(20, 'already-falling', 'CGM fiel bereits vor dem Bolus', true);
    }
    if (features.onsetMinutes === null) subtract(10, 'no-onset', 'kein anhaltender Abfall erkannt');
    if (context.contextEndMinutes < C.MIN_MODEL_WINDOW_MINUTES) {
      subtract(15, 'short-window', 'weniger als 240 min ungestörter Verlauf', true);
    }
    score = clamp(score, 0, 100);
    const quality = score >= 80 ? 'hoch' : score >= 55 ? 'mittel' : 'niedrig';
    const modelEligible = context.correctionLike && score >= 80
      && context.contextEndMinutes >= C.MIN_MODEL_WINDOW_MINUTES
      && features.coverage >= 0.9
      && features.baseline !== null && features.baseline >= C.START_GLUCOSE_MIN
      && features.preSlope !== null && features.preSlope >= -0.3
      && features.onsetMinutes !== null
      && !reasons.some((reason) => reason.major);
    return { score, quality, reasons, modelEligible };
  }

  function analyzeBolusEvent(event, clinicalValue, diary, allInsulin, settingsValue) {
    const clinical = normalizeClinical(clinicalValue);
    const settings = normalizeSettings(settingsValue);
    const context = contextForEvent(
      event, allInsulin, mealEvents(clinical, diary), exerciseEvents(clinical, diary),
      basalChanges(clinical), lowAlerts(clinical), diary, settings.actionWindowMinutes,
    );
    const grid = nearestCgmGrid(clinical.cgm, event.minute, settings.actionWindowMinutes);
    const smoothed = medianSmooth(grid.values);
    const slopes = localSlopes(grid.offsets, smoothed);
    const relevant = grid.offsets.map((offset, index) => ({ offset, index }))
      .filter((item) => item.offset >= -C.PRE_WINDOW_MINUTES && item.offset <= context.contextEndMinutes);
    const available = relevant.filter((item) => Number.isFinite(grid.values[item.index])).length;
    const coverage = relevant.length ? available / relevant.length : 0;
    const baseline = round(median(grid.offsets.map((offset, index) => ({ offset, value: grid.values[index] }))
      .filter((point) => point.offset >= -15 && point.offset <= 0).map((point) => point.value)), 0);
    const preSlope = round(linearSlope(grid.offsets, smoothed, -30, 0), 3);
    const onsetMinutes = firstSustainedOnset(grid.offsets, smoothed, slopes, context.contextEndMinutes);
    const strongest = strongestDecline(grid.offsets, slopes, onsetMinutes, context.contextEndMinutes);
    const nadir = nadirPoint(grid.offsets, smoothed, onsetMinutes, context.contextEndMinutes);
    const stableMinutes = stablePhase(grid.offsets, smoothed, slopes, strongest.minute, context.contextEndMinutes);
    const endMinutes = effectiveEnd(grid.offsets, slopes, strongest.minute, strongest.rate, context.contextEndMinutes);
    const scored = scoreEvent(event, context, { coverage, baseline, preSlope, onsetMinutes });
    const curve = grid.offsets.map((offset, index) => {
      if (offset < 0 || offset > context.contextEndMinutes) return null;
      const slope = slopes[index];
      const intensity = Number.isFinite(slope) && Number.isFinite(strongest.rate) && strongest.rate > 0
        ? clamp(Math.max(0, -slope) / strongest.rate, 0, 1.5) : null;
      return {
        offset, value: Number.isFinite(smoothed[index]) ? round(smoothed[index], 1) : null,
        slope: Number.isFinite(slope) ? round(slope, 3) : null,
        intensity: Number.isFinite(intensity) ? round(intensity, 3) : null,
      };
    }).filter(Boolean);
    return {
      ...event,
      correctionLike: context.correctionLike,
      baseline, preSlope, coverage: round(coverage * 100, 1),
      contextMinutes: context.contextEndMinutes,
      onsetMinutes, maxEffectMinutes: strongest.minute, maxDeclineRate: strongest.rate,
      nadir: nadir.value, nadirMinutes: nadir.minute, stableMinutes, endMinutes,
      actionDurationMinutes: Number.isFinite(onsetMinutes) && Number.isFinite(endMinutes)
        ? endMinutes - onsetMinutes : null,
      endCensored: endMinutes === null,
      dropToNadir: baseline !== null && nadir.value !== null ? round(baseline - nadir.value, 0) : null,
      score: scored.score, quality: scored.quality, reasons: scored.reasons,
      modelEligible: scored.modelEligible, timeOfDay: timeOfDay(event.minute), doseBand: doseBand(event.dose),
      illness: context.illness, exercise: context.nearbyExercise.length > 0,
      mealContext: context.nearbyMeals.length > 0, previousInsulin: context.previousInsulin.length > 0,
      nextInsulin: context.nextInsulin.length > 0, basalChange: context.nearbyBasal.length > 0,
      lowAlert: context.nearbyAlerts.length > 0, curve,
    };
  }

  function analyzeBolusEvents(clinicalValue, diary = [], settingsValue = DEFAULT_SETTINGS) {
    const clinical = normalizeClinical(clinicalValue);
    const settings = normalizeSettings(settingsValue);
    const allInsulin = insulinEvents(clinical);
    return allInsulin.map((event) => analyzeBolusEvent(event, clinical, diary, allInsulin, settings));
  }

  const api = {
    C, DEFAULT_SETTINGS, number, round, mean, median, quantile, summary, clamp,
    parseTime, normalizeSettings, normalizeClinical, insulinEvents, mealEvents,
    exerciseEvents, nearestCgmGrid, medianSmooth, localSlopes, linearSlope,
    firstSustainedOnset, strongestDecline, nadirPoint, stablePhase, effectiveEnd,
    analyzeBolusEvent, analyzeBolusEvents,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.GlucoseCoachInsulinCore = api;
})();
