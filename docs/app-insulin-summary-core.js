(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;

  const MEAN_CARD_DEFINITIONS = [
    { key: 'baseline', label: 'Ausgangswert', metrics: [{ field: 'baseline', unit: 'mg/dl', digits: 0 }] },
    {
      key: 'preSlope',
      label: 'Ausgangstrend',
      metrics: [{
        field: 'preSlope15',
        unit: 'mg/dl / 15 min',
        digits: 1,
        value: (event) => finite(event.preSlope) === null ? null : Number(event.preSlope) * 15,
      }],
    },
    {
      key: 'observedDeclineOnset',
      label: 'beobachteter anhaltender Abfall',
      metrics: [{ field: 'observedDeclineOnset', unit: 'min', digits: 0 }],
    },
    {
      key: 'effectOnset',
      label: 'geschätzter Effektbeginn',
      metrics: [{ field: 'effectOnset', unit: 'min', digits: 0 }],
    },
    {
      key: 'maxDropRate',
      label: 'stärkste Senkungsrate',
      metrics: [
        { field: 'maxDropRate', unit: 'mg/dl / 15 min', digits: 1 },
        { field: 'maxDropRateTime', unit: 'min', digits: 0, prefix: 'bei ' },
      ],
    },
    {
      key: 'peakEffect',
      label: 'maximale trendbereinigte Wirkung',
      metrics: [
        { field: 'peakEffect', unit: 'mg/dl', digits: 1 },
        { field: 'peakEffectTime', unit: 'min', digits: 0, prefix: 'bei ' },
      ],
    },
    {
      key: 'nadir',
      label: 'Nadir',
      metrics: [
        { field: 'nadir', unit: 'mg/dl', digits: 0 },
        { field: 'nadirTime', unit: 'min', digits: 0, prefix: 'bei ' },
      ],
    },
    {
      key: 'stableTime',
      label: 'erste stabile Phase',
      metrics: [
        { field: 'stableTime', unit: 'min', digits: 0 },
        { field: 'stableRange', unit: 'mg/dl Spanne', digits: 1 },
      ],
    },
    {
      key: 'actionEnd',
      label: 'Restwirkung unter Schwelle',
      metrics: [{ field: 'actionEnd', unit: 'min', digits: 0 }],
    },
    {
      key: 'effectAuc',
      label: 'Effektfläche',
      metrics: [{ field: 'effectAuc', unit: 'mg/dl·h', digits: 1 }],
    },
    {
      key: 'cgmCoverage',
      label: 'CGM-Abdeckung',
      metrics: [{ field: 'cgmCoverage', unit: '%', digits: 1 }],
    },
    {
      key: 'qualityScore',
      label: 'Qualität',
      metrics: [{ field: 'qualityScore', unit: '/100', digits: 0 }],
    },
  ];

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function localDayKey(minute) {
    const date = new Date(Number(minute) * MINUTE_MS);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function mean(values) {
    const valid = values.map(finite).filter(Number.isFinite);
    return {
      n: valid.length,
      mean: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null,
    };
  }

  function calculateMeanCards(events = [], selectedDate = 'all') {
    const eligible = (Array.isArray(events) ? events : []).filter((event) =>
      event?.detectable === true &&
      (selectedDate === 'all' || localDayKey(event.minute) === selectedDate),
    );
    const cards = MEAN_CARD_DEFINITIONS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      metrics: definition.metrics.map((metric) => {
        const values = eligible.map((event) =>
          typeof metric.value === 'function' ? metric.value(event) : event?.[metric.field],
        );
        return { ...metric, ...mean(values) };
      }),
    }));
    return { selectedDate, eventCount: eligible.length, cards };
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

  function formatMetric(metric) {
    if (!metric.n || !Number.isFinite(metric.mean)) return 'nicht bestimmbar · n=0';
    const prefix = metric.prefix || '';
    const value = metric.unit === 'min'
      ? formatMinutes(metric.mean)
      : `${formatNumber(metric.mean, metric.digits)} ${metric.unit}`;
    return `${prefix}${value} · n=${metric.n}`;
  }

  const api = {
    MEAN_CARD_DEFINITIONS,
    calculateMeanCards,
    formatMetric,
    localDayKey,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachInsulinSummary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
