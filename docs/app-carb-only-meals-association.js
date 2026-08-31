(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const LOCAL_CARB_MATCH_MINUTES = 10;
  const MEAL_BOLUS_MATCH_MINUTES = 60;
  const MEALS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
  const isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const carbApi = isNode
    ? require('./app-carb-only-meals.js')
    : root?.GlucoseCoachCarbOnlyMeals;
  const finalApi = isNode
    ? require('./app-carb-only-meals-final.js')
    : root?.GlucoseCoachCarbOnlyMealsFinal;

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function parseTime(value) {
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

  function nearestMeal(records, minute) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const record of records) {
      if (!Number.isFinite(record.minute)) continue;
      const distance = Math.abs(record.minute - minute);
      if (distance < bestDistance) {
        best = record;
        bestDistance = distance;
      }
    }
    return best ? { ...best, distance: bestDistance } : null;
  }

  function augmentMealDiary(diary, boluses) {
    const sourceMeals = array(diary)
      .filter((entry) => MEALS.has(entry?.occasion))
      .map((entry) => ({ ...entry }));

    // The per-meal analyzer invokes this helper with one already complete entry.
    // Returning immediately avoids rebuilding all synthetic Glooko meals hundreds
    // of times during one browser render.
    if (sourceMeals.length === 1 && number(sourceMeals[0]?.carbs) > 0) {
      return sourceMeals;
    }

    const mealRecords = sourceMeals.map((entry) => ({
      entry,
      minute: parseTime(entry.when),
    }));
    const seen = new Set();
    const carbohydrateRows = array(boluses)
      .filter((row) => number(row?.[0]) !== null && number(row?.[1]) > 0)
      .filter((row) => {
        const key = `${Number(row[0])}|${number(row[1])}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    for (const row of carbohydrateRows) {
      const minute = Number(row[0]);
      const matchRadius = number(row?.[2]) > 0
        ? MEAL_BOLUS_MATCH_MINUTES
        : LOCAL_CARB_MATCH_MINUTES;
      const match = nearestMeal(mealRecords, minute);

      if (match && match.distance <= matchRadius) {
        if (!(number(match.entry.carbs) > 0)) match.entry.carbs = String(number(row[1]));
        continue;
      }

      const entry = {
        id: `glooko-carbs-${minute}`,
        when: localDateTime(minute),
        occasion: occasion(minute),
        food: 'Glooko-Kohlenhydrate',
        carbs: String(number(row[1])),
        fat: '',
        protein: '',
        fiber: '',
        activity: '',
        sleep: '',
        stress: '',
        illness: 'unbekannt',
        notes: 'Aus positiver Kohlenhydratangabe im Glooko-Export übernommen',
        source: 'glooko',
        readOnly: true,
      };
      sourceMeals.push(entry);
      mealRecords.push({ entry, minute });
    }

    return sourceMeals.filter((entry) => number(entry?.carbs) > 0);
  }

  function install() {
    if (!carbApi) return;
    carbApi.augmentMealDiary = augmentMealDiary;
    if (typeof GlucoseCoachV3 !== 'undefined') {
      GlucoseCoachV3.augmentMealDiary = augmentMealDiary;
    }
    if (typeof finalApi?.clearAnalysisCache === 'function') {
      finalApi.clearAnalysisCache();
    }
    if (!isNode && typeof gcRender === 'function') gcRender();
  }

  const api = {
    augmentMealDiary,
    nearestMeal,
    GC_LOCAL_CARB_MATCH_MINUTES: LOCAL_CARB_MATCH_MINUTES,
    GC_MEAL_BOLUS_MATCH_MINUTES: MEAL_BOLUS_MATCH_MINUTES,
  };

  if (isNode) module.exports = api;
  if (root) root.GlucoseCoachCarbOnlyMealAssociation = api;
  install();
})(typeof globalThis !== 'undefined' ? globalThis : this);