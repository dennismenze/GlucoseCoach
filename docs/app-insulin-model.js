(function () {
  'use strict';

  const core = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-insulin-core.js')
    : globalThis.GlucoseCoachInsulinCore;
  if (!core) throw new Error('Insulin-Analysekern ist nicht geladen.');

  const { C, normalizeSettings, summary, median } = core;

  function effectCurve(events, actionWindowMinutes) {
    const eligible = events.filter((event) => event.modelEligible);
    const result = [];
    for (let offset = 0; offset <= actionWindowMinutes; offset += 30) {
      const values = [];
      for (const event of eligible) {
        const nearby = event.curve
          .filter((point) => point.offset >= offset - 10 && point.offset <= offset + 10)
          .map((point) => point.intensity)
          .filter(Number.isFinite);
        const eventValue = median(nearby);
        if (Number.isFinite(eventValue)) values.push(eventValue * 100);
      }
      result.push({ offset, ...summary(values, 0) });
    }
    return result;
  }

  function buildInsulinEffectModel(events, settingsValue = core.DEFAULT_SETTINGS) {
    const settings = normalizeSettings(settingsValue);
    const corrections = events.filter((event) => event.correctionLike);
    const eligible = corrections.filter((event) => event.modelEligible);
    const onset = summary(eligible.map((event) => event.onsetMinutes), 0);
    const peak = summary(eligible.map((event) => event.maxEffectMinutes), 0);
    const end = summary(eligible.map((event) => event.endMinutes), 0);
    const duration = summary(eligible.map((event) => event.actionDurationMinutes), 0);
    const maximumRate = summary(eligible.map((event) => event.maxDeclineRate), 2);
    const stable = summary(eligible.map((event) => event.stableMinutes), 0);
    const nadirDrop = summary(eligible.map((event) => event.dropToNadir), 0);
    const endCensoredPercent = eligible.length
      ? core.round(eligible.filter((event) => event.endCensored).length / eligible.length * 100, 0)
      : null;
    const endFraction = eligible.length ? end.n / eligible.length : 0;
    const confidence = eligible.length >= 15 && onset.n >= 12 && endFraction >= 0.6
      ? 'hoch'
      : eligible.length >= C.MODEL_MIN_EVENTS && end.n >= 3
        ? 'mittel'
        : eligible.length >= C.MODEL_MIN_EVENTS
          ? 'begrenzt'
          : 'unzureichend';
    return {
      settings,
      totalBoluses: events.length,
      correctionBoluses: corrections.length,
      eligibleEvents: eligible.length,
      onset, peak, end, duration, maximumRate, stable, nadirDrop,
      endCensoredPercent, confidence,
      sufficient: eligible.length >= C.MODEL_MIN_EVENTS,
      curve: effectCurve(events, settings.actionWindowMinutes),
    };
  }

  function subgroupStats(events, key) {
    const groups = new Map();
    for (const event of events.filter((item) => item.modelEligible)) {
      const label = event[key];
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(event);
    }
    return [...groups.entries()].map(([label, group]) => ({
      label,
      events: group.length,
      onset: summary(group.map((event) => event.onsetMinutes), 0),
      peak: summary(group.map((event) => event.maxEffectMinutes), 0),
      end: summary(group.map((event) => event.endMinutes), 0),
      maximumRate: summary(group.map((event) => event.maxDeclineRate), 2),
    })).sort((a, b) => a.label.localeCompare(b.label, 'de-DE'));
  }

  function buildInsulinSubgroups(events) {
    return {
      timeOfDay: subgroupStats(events, 'timeOfDay'),
      doseBand: subgroupStats(events, 'doseBand'),
    };
  }

  const api = { effectCurve, buildInsulinEffectModel, subgroupStats, buildInsulinSubgroups };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.GlucoseCoachInsulinModel = api;
})();
