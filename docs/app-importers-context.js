(function () {
  'use strict';

  const nodeCore = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-v3-core.js')
    : null;
  const nodeBase = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-importers.js')
    : null;
  const baseApi = nodeBase || (typeof GlucoseCoachV3 !== 'undefined' ? GlucoseCoachV3 : {});
  const coreApi = nodeCore || (typeof GlucoseCoachV3 !== 'undefined' ? GlucoseCoachV3 : {});
  const baseParse = baseApi.parseClinicalCsv;
  const baseMerge = baseApi.mergeClinical;
  const baseNormalize = baseApi.normalizeClinical || ((value) => value || {});

  const LABELS = {
    cgmCarbs: 'CGM-Kohlenhydrate',
    exercise: 'Sport',
    food: 'Lebensmittel',
    manualInsulin: 'manuelles Insulin',
    medication: 'Medikamente',
    note: 'Notizen',
  };

  const clean = (value) => String(value ?? '').replace(/^\uFEFF/, '').trim();
  const norm = (value) => clean(value).toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');

  function number(value) {
    let source = clean(value).replace(/\u00a0/g, '').replace(/\s+/g, '');
    if (!source || /^(nan|null|n\/a|-)$/i.test(source)) return null;
    const comma = source.lastIndexOf(',');
    const dot = source.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      source = comma > dot ? source.replace(/\./g, '').replace(',', '.') : source.replace(/,/g, '');
    } else if (comma >= 0) source = source.replace(',', '.');
    source = source.replace(/[^0-9eE+\-.]/g, '');
    const result = Number(source);
    return Number.isFinite(result) ? result : null;
  }

  function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function time(value) {
    const source = clean(value);
    if (!source) return null;
    const match = source.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const [, day, month, year, hour, minute, second = '0'] = match;
      const date = new Date(+year, +month - 1, +day, +hour, +minute, +second);
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / 60000);
    }
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / 60000);
  }

  function countDelimiter(line, delimiter) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && char === delimiter) count += 1;
    }
    return count;
  }

  function rows(source) {
    const lines = String(source).replace(/^\uFEFF/, '').split(/\r?\n/);
    const headerLine = lines.findIndex((line) => /zeitstempel|timestamp/i.test(line));
    if (headerLine < 0) throw new Error('Keine unterstützte Kopfzeile gefunden.');
    const delimiter = [',', ';', '\t'].sort(
      (a, b) => countDelimiter(lines[headerLine], b) - countDelimiter(lines[headerLine], a),
    )[0];
    const relevant = lines.slice(headerLine).join('\n');
    const parsed = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < relevant.length; index += 1) {
      const char = relevant[index];
      if (char === '"') {
        if (quoted && relevant[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = !quoted;
      } else if (!quoted && char === delimiter) {
        row.push(field);
        field = '';
      } else if (!quoted && (char === '\n' || char === '\r')) {
        if (char === '\r' && relevant[index + 1] === '\n') index += 1;
        row.push(field);
        if (row.some((cell) => clean(cell))) parsed.push(row);
        row = [];
        field = '';
      } else field += char;
    }
    row.push(field);
    if (row.some((cell) => clean(cell))) parsed.push(row);
    return { rows: parsed, metadataRowsDiscarded: headerLine };
  }

  function indexOf(headers, alternatives) {
    const normalized = headers.map(norm);
    return normalized.findIndex((header) => alternatives.some((alternative) => header.includes(alternative)));
  }

  function extraKind(filename, headers) {
    const file = String(filename || '').toLowerCase();

    if (/^(?:cgm_data_|bolus_data_|insulin_data_|basal_data_|bg_data_|alarms_data_)/.test(file)) {
      return null;
    }

    if (/^cgm_carbs_data_/.test(file)) return 'cgmCarbs';
    if (/^exercise_data_/.test(file)) return 'exercise';
    if (/^food_data_/.test(file)) return 'food';
    if (/^manual_insulin_data_/.test(file)) return 'manualInsulin';
    if (/^medication_data_/.test(file)) return 'medication';
    if (/^notes_data_/.test(file)) return 'note';

    const normalized = headers.map(norm);
    const has = (...values) => indexOf(headers, values) >= 0;
    const hasExact = (...values) => normalized.some((header) => values.includes(header));

    if (has('intensität', 'intensity') && has('verbrannte kalorien', 'calories burned')) return 'exercise';
    if (has('medikamententyp', 'medication type')) return 'medication';
    if (has('portionen', 'servings') || has('anzahl der portionen', 'number of servings')) return 'food';
    if (has('insulin-typ', 'insulin type') && hasExact('wert', 'value') && has('name')) return 'manualInsulin';
    if (headers.length === 2 && hasExact('kh (g)', 'carbs (g)', 'kohlenhydrate')) return 'cgmCarbs';
    if (headers.length === 2 && hasExact('wert', 'value')) return 'note';
    return null;
  }

  function emptyExtra(kind, metadataRowsDiscarded) {
    return {
      kind,
      cgm: [], boluses: [], dailyInsulin: [], basalEvents: [], manualGlucose: [], alarms: [],
      cgmCarbs: [], exerciseEvents: [], foodEvents: [], manualInsulin: [], medications: [], notes: [],
      rejected: 0,
      metadataRowsDiscarded,
    };
  }

  function parseExtraCsv(source, filename) {
    const parsed = rows(source);
    if (!parsed.rows.length) throw new Error('CSV enthält keine Kopfzeile.');
    const headers = parsed.rows[0];
    const kind = extraKind(filename, headers);
    if (!kind) return null;
    const output = emptyExtra(kind, parsed.metadataRowsDiscarded);
    const timeIndex = indexOf(headers, ['zeitstempel', 'timestamp']);
    const idx = {
      name: indexOf(headers, ['name']),
      value: indexOf(headers, ['wert', 'value']),
      carbs: indexOf(headers, ['kh (g)', 'kohlenhydrate', 'carbs (g)']),
      fat: indexOf(headers, ['fett', 'fat']),
      protein: indexOf(headers, ['eiweiß', 'eiweiss', 'protein']),
      calories: indexOf(headers, ['kalorien', 'calories']),
      portions: indexOf(headers, ['portionen', 'servings']),
      portionCount: indexOf(headers, ['anzahl der portionen', 'number of servings']),
      intensity: indexOf(headers, ['intensität', 'intensity']),
      duration: indexOf(headers, ['dauer (minuten)', 'duration (minutes)']),
      burned: indexOf(headers, ['verbrannte kalorien', 'calories burned']),
      insulinType: indexOf(headers, ['insulin-typ', 'insulin type']),
      medicationType: indexOf(headers, ['medikamententyp', 'medication type']),
    };

    for (const row of parsed.rows.slice(1)) {
      const minute = time(row[timeIndex]);
      if (minute === null) {
        output.rejected += 1;
        continue;
      }
      if (kind === 'cgmCarbs') {
        const carbs = idx.carbs >= 0 ? number(row[idx.carbs]) : null;
        if (carbs === null) output.rejected += 1;
        else output.cgmCarbs.push([minute, round(carbs, 1)]);
      } else if (kind === 'exercise') {
        const name = idx.name >= 0 ? clean(row[idx.name]).slice(0, 160) : '';
        const intensity = idx.intensity >= 0 ? clean(row[idx.intensity]).slice(0, 80) : '';
        const duration = idx.duration >= 0 ? number(row[idx.duration]) : null;
        const calories = idx.burned >= 0 ? number(row[idx.burned]) : null;
        if (!name && !intensity && duration === null && calories === null) output.rejected += 1;
        else output.exerciseEvents.push([minute, name, intensity, round(duration, 0), round(calories, 1)]);
      } else if (kind === 'food') {
        const name = idx.name >= 0 ? clean(row[idx.name]).slice(0, 160) : '';
        const carbs = idx.carbs >= 0 ? number(row[idx.carbs]) : null;
        const fat = idx.fat >= 0 ? number(row[idx.fat]) : null;
        const protein = idx.protein >= 0 ? number(row[idx.protein]) : null;
        const calories = idx.calories >= 0 ? number(row[idx.calories]) : null;
        const portions = idx.portions >= 0 ? clean(row[idx.portions]).slice(0, 80) : '';
        const portionCount = idx.portionCount >= 0 ? number(row[idx.portionCount]) : null;
        if (!name && carbs === null && fat === null && protein === null && calories === null && !portions && portionCount === null) {
          output.rejected += 1;
        } else {
          output.foodEvents.push([
            minute, name, round(carbs, 1), round(fat, 1), round(protein, 1),
            round(calories, 1), portions, round(portionCount, 2),
          ]);
        }
      } else if (kind === 'manualInsulin') {
        const name = idx.name >= 0 ? clean(row[idx.name]).slice(0, 160) : '';
        const value = idx.value >= 0 ? number(row[idx.value]) : null;
        const insulinType = idx.insulinType >= 0 ? clean(row[idx.insulinType]).slice(0, 80) : '';
        if (!name && value === null && !insulinType) output.rejected += 1;
        else output.manualInsulin.push([minute, name, round(value, 2), insulinType]);
      } else if (kind === 'medication') {
        const name = idx.name >= 0 ? clean(row[idx.name]).slice(0, 160) : '';
        const value = idx.value >= 0 ? clean(row[idx.value]).slice(0, 160) : '';
        const medicationType = idx.medicationType >= 0 ? clean(row[idx.medicationType]).slice(0, 80) : '';
        if (!name && !value && !medicationType) output.rejected += 1;
        else output.medications.push([minute, name, value, medicationType]);
      } else if (kind === 'note') {
        const value = idx.value >= 0 ? clean(row[idx.value]).slice(0, 1000) : '';
        if (!value) output.rejected += 1;
        else output.notes.push([minute, value]);
      }
    }
    return output;
  }

  function parseClinicalCsvExtended(source, filename = '') {
    const parsedExtra = parseExtraCsv(source, filename);
    if (parsedExtra) return parsedExtra;
    if (typeof baseParse !== 'function') {
      throw new Error(`Dateityp nicht erkannt (${filename || 'unbekannt'}).`);
    }
    return baseParse(source, filename);
  }

  function dedupe(sourceRows, key) {
    const map = new Map();
    for (const row of sourceRows || []) {
      if (!Array.isArray(row) || !Number.isFinite(Number(row[0]))) continue;
      map.set(key(row), row);
    }
    return [...map.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }

  const normalizeExtra = (value) => ({
    cgmCarbs: dedupe(value?.cgmCarbs, (row) => `${row[0]}|${row[1] ?? ''}`),
    exerciseEvents: dedupe(value?.exerciseEvents, (row) => row.map((item) => item ?? '').join('|')),
    foodEvents: dedupe(value?.foodEvents, (row) => row.map((item) => item ?? '').join('|')),
    manualInsulin: dedupe(value?.manualInsulin, (row) => row.map((item) => item ?? '').join('|')),
    medications: dedupe(value?.medications, (row) => row.map((item) => item ?? '').join('|')),
    notes: dedupe(value?.notes, (row) => row.map((item) => item ?? '').join('|')),
  });

  function normalizeClinicalExtended(value) {
    return { ...baseNormalize(value), ...normalizeExtra(value) };
  }

  function mergeClinicalExtended(currentValue, items) {
    if (typeof baseMerge !== 'function') throw new Error('Basis-Importer ist nicht geladen.');
    const before = normalizeExtra(currentValue || {});
    const base = baseMerge(currentValue || {}, items);
    const collect = (key) => items.flatMap((item) => item[key] || []);
    const extra = {
      cgmCarbs: dedupe([...before.cgmCarbs, ...collect('cgmCarbs')], (row) => `${row[0]}|${row[1] ?? ''}`),
      exerciseEvents: dedupe([...before.exerciseEvents, ...collect('exerciseEvents')], (row) => row.map((item) => item ?? '').join('|')),
      foodEvents: dedupe([...before.foodEvents, ...collect('foodEvents')], (row) => row.map((item) => item ?? '').join('|')),
      manualInsulin: dedupe([...before.manualInsulin, ...collect('manualInsulin')], (row) => row.map((item) => item ?? '').join('|')),
      medications: dedupe([...before.medications, ...collect('medications')], (row) => row.map((item) => item ?? '').join('|')),
      notes: dedupe([...before.notes, ...collect('notes')], (row) => row.map((item) => item ?? '').join('|')),
    };
    const summary = {
      ...base.summary,
      cgmCarbsAdded: extra.cgmCarbs.length - before.cgmCarbs.length,
      exerciseAdded: extra.exerciseEvents.length - before.exerciseEvents.length,
      foodAdded: extra.foodEvents.length - before.foodEvents.length,
      manualInsulinAdded: extra.manualInsulin.length - before.manualInsulin.length,
      medicationsAdded: extra.medications.length - before.medications.length,
      notesAdded: extra.notes.length - before.notes.length,
    };
    return { clinical: { ...base.clinical, ...extra }, summary };
  }

  function formatExtended(summary) {
    const parts = [
      [summary.cgmAdded, 'CGM-Werte'], [summary.bolusesAdded, 'Bolusereignisse'],
      [summary.dailyInsulinAdded, 'Tages-Insulinzeilen'], [summary.basalEventsAdded, 'Basalereignisse'],
      [summary.manualGlucoseAdded, 'manuelle Glukosewerte'], [summary.alarmsAdded, 'Alarme/Ereignisse'],
      [summary.cgmCarbsAdded, 'CGM-KH-Ereignisse'], [summary.exerciseAdded, 'Sportereignisse'],
      [summary.foodAdded, 'Lebensmitteleinträge'], [summary.manualInsulinAdded, 'manuelle Insulineinträge'],
      [summary.medicationsAdded, 'Medikamente'], [summary.notesAdded, 'Notizen'],
    ].filter(([count]) => Number(count) > 0).map(([count, label]) => `${count} neue ${label}`);
    const kinds = [...new Set(summary.kinds || [])].map((kind) => LABELS[kind] || kind).join(', ');
    if (!parts.length) parts.push('keine neuen Datenzeilen');
    return `${parts.join(', ')}${kinds ? ` · erkannt: ${kinds}` : ''}${summary.rejected ? ` · ${summary.rejected} verworfen` : ''}`;
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcState === 'undefined' || typeof gcSave !== 'function' || typeof gcRender !== 'function') return;

    try {
      const stored = JSON.parse(localStorage.getItem(GC_CLINICAL_KEY) || 'null');
      gcState.clinical = normalizeClinicalExtended(stored || gcState.clinical);
    } catch {
      gcState.clinical = normalizeClinicalExtended(gcState.clinical);
    }

    if (typeof gcImportView === 'function') {
      gcImportView = function contextImportView() {
        gcState.clinical = normalizeClinicalExtended(gcState.clinical);
        const c = gcState.clinical;
        const facts = [
          ['CGM-Werte', c.cgm.length], ['Bolusereignisse', c.boluses.length],
          ['Tages-Insulinzeilen', c.dailyInsulin.length], ['Basalereignisse', c.basalEvents.length],
          ['manuelle Glukosewerte', c.manualGlucose.length], ['Alarme/Ereignisse', c.alarms.length],
          ['CGM-KH-Ereignisse', c.cgmCarbs.length], ['Sportereignisse', c.exerciseEvents.length],
          ['Lebensmitteleinträge', c.foodEvents.length], ['manuelle Insulineinträge', c.manualInsulin.length],
          ['Medikamente', c.medications.length], ['Notizen', c.notes.length], ['Importvorgänge', c.imports.length],
        ];
        const target = document.querySelector('#local-data-facts');
        if (target) target.innerHTML = facts.map(([label, value]) => `<li><span>${label}</span><strong>${value}</strong></li>`).join('');
        const last = gcState.lastImport || c.imports.at(-1);
        const summary = document.querySelector('#import-summary');
        if (summary) {
          summary.innerHTML = last
            ? `<div class="notice info"><strong>Letzter Import:</strong> ${formatExtended(last)}</div>`
            : '<p class="muted">Noch keine persönliche CSV in diesem Browser importiert.</p>';
        }
      };
    }

    const description = document.querySelector('.import-drop p');
    if (description) {
      description.innerHTML = '<strong>Kompletter Omnipod-Export:</strong> Alle CSV-Dateien des Exports können gemeinsam ausgewählt werden. Leere Kontextdateien werden erkannt und ohne Fehler akzeptiert.';
    }

    const input = document.querySelector('#csv-files');
    const button = document.querySelector('#import-csv');
    if (input && button) {
      button.onclick = async () => {
        const progress = document.querySelector('#import-progress');
        try {
          const parsed = [];
          for (const file of input.files || []) {
            parsed.push(parseClinicalCsvExtended(await file.text(), file.name));
          }
          if (!parsed.length) throw new Error('Keine CSV-Dateien ausgewählt.');
          const merged = mergeClinicalExtended(gcState.clinical, parsed);
          gcState.clinical = merged.clinical;
          gcState.lastImport = merged.summary;
          gcSave();
          if (progress) progress.textContent = `Fertig: ${formatExtended(merged.summary)}.`;
          input.value = '';
          const selected = document.querySelector('#selected-files');
          if (selected) selected.textContent = 'Keine Dateien ausgewählt.';
          gcRender();
          if (typeof gcShow === 'function') gcShow('overview');
        } catch (error) {
          if (progress) progress.textContent = `Import fehlgeschlagen: ${error.message}`;
        }
      };
    }

    const clearButton = document.querySelector('#clear-clinical');
    if (clearButton) {
      clearButton.onclick = () => {
        if (confirm('Lokale CGM-/Bolus- und Kontextdaten löschen?')) {
          gcState.clinical = normalizeClinicalExtended({});
          gcState.lastImport = null;
          gcSave();
          gcRender();
        }
      };
    }

    gcSave();
    gcRender();
  }

  const api = {
    ...coreApi,
    ...baseApi,
    parseClinicalCsv: parseClinicalCsvExtended,
    mergeClinical: mergeClinicalExtended,
    normalizeClinical: normalizeClinicalExtended,
    parseExtraCsv,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof GlucoseCoachV3 !== 'undefined') {
    GlucoseCoachV3.parseClinicalCsv = parseClinicalCsvExtended;
    GlucoseCoachV3.mergeClinical = mergeClinicalExtended;
    GlucoseCoachV3.normalizeClinical = normalizeClinicalExtended;
  }

  installBrowserPatch();
})();
