(function () {
  'use strict';

  const SUPPORTED_KINDS = Object.freeze({
    cgm: 'CGM',
    bolus: 'Bolus',
    dailyInsulin: 'Tagesinsulin',
    basal: 'Basal',
    bg: 'manuelle Glukose',
    alarm: 'Alarm/Ereignis',
  });

  function text(value) {
    return String(value ?? '').replace(/^\uFEFF/, '').trim();
  }

  function normalize(value) {
    return text(value).toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
  }

  function countDelimiter(line, delimiter) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && char === delimiter) {
        count += 1;
      }
    }
    return count;
  }

  function findHeaderLine(source) {
    const lines = String(source).replace(/^\uFEFF/, '').split(/\r?\n/);
    const index = lines.findIndex((line) => /zeitstempel|timestamp/i.test(line));
    if (index < 0) throw new Error('Keine unterstützte Kopfzeile gefunden.');
    return { lines, index, line: lines[index] };
  }

  function parseDelimited(source) {
    const header = findHeaderLine(source);
    const delimiter = [',', ';', '\t'].sort(
      (a, b) => countDelimiter(header.line, b) - countDelimiter(header.line, a),
    )[0];
    const relevant = header.lines.slice(header.index).join('\n');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < relevant.length; index += 1) {
      const char = relevant[index];
      if (char === '"') {
        if (quoted && relevant[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (!quoted && char === delimiter) {
        row.push(field);
        field = '';
      } else if (!quoted && (char === '\n' || char === '\r')) {
        if (char === '\r' && relevant[index + 1] === '\n') index += 1;
        row.push(field);
        if (row.some((cell) => text(cell) !== '')) rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
    row.push(field);
    if (row.some((cell) => text(cell) !== '')) rows.push(row);

    return { rows, metadataRowsDiscarded: header.index };
  }

  function headerIndex(headers, alternatives) {
    const normalized = headers.map(normalize);
    return normalized.findIndex((header) =>
      alternatives.some((alternative) => header.includes(alternative)),
    );
  }

  function parseTime(value) {
    const source = text(value);
    if (!source) return null;

    let match = source.match(
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
    );
    if (match) {
      const [, day, month, year, hour, minute, second = '0'] = match;
      const date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      );
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / 60000);
    }

    match = source.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
    );
    if (match) {
      const [, day, month, year, hour, minute, second = '0'] = match;
      const date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      );
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / 60000);
    }

    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / 60000);
  }

  function parseNumber(value) {
    let source = text(value).replace(/\u00a0/g, '').replace(/\s+/g, '');
    if (!source || /^(nan|null|n\/a|-)$/i.test(source)) return null;
    const comma = source.lastIndexOf(',');
    const dot = source.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      source = comma > dot
        ? source.replace(/\./g, '').replace(',', '.')
        : source.replace(/,/g, '');
    } else if (comma >= 0) {
      source = source.replace(',', '.');
    }
    source = source.replace(/[^0-9eE+\-.]/g, '');
    const numeric = Number(source);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function emptyParsed(kind, metadataRowsDiscarded) {
    return {
      kind,
      cgm: [],
      boluses: [],
      dailyInsulin: [],
      basalEvents: [],
      manualGlucose: [],
      alarms: [],
      rejected: 0,
      metadataRowsDiscarded,
    };
  }

  function detectKind(headers) {
    const has = (...alternatives) => headerIndex(headers, alternatives) >= 0;

    if (has('cgm-glukosewert', 'cgm-glukose', 'cgm glucose')) return 'cgm';

    if (
      has('bolus gesamt', 'total bolus') ||
      has('basal gesamt', 'total basal') ||
      has('insulin gesamt', 'total insulin')
    ) {
      return 'dailyInsulin';
    }

    if (
      has('dauer (minuten)', 'duration (minutes)', 'prozentsatz (%)', 'percentage (%)', 'rate') &&
      has('insulin-typ', 'insulin type') &&
      has('abgegebenes insulin', 'delivered insulin')
    ) {
      return 'basal';
    }

    if (has('alarm/ereignis', 'alarm/event')) return 'alarm';

    if (
      has('glukosewert (mg/dl)', 'glucose value (mg/dl)') &&
      !has('cgm-glukosewert', 'cgm glucose')
    ) {
      return 'bg';
    }

    if (
      has('kohlenhydrataufnahme', 'carbohydrate intake', 'carbs') ||
      has('blutzuckereingabe', 'entered glucose', 'blood glucose input') ||
      has('anfängliche abgabe', 'initial delivery') ||
      has('verzögerte abgabe', 'extended delivery')
    ) {
      return 'bolus';
    }

    return null;
  }

  function parseClinicalCsv(source, filename = '') {
    const parsed = parseDelimited(source);
    if (!parsed.rows.length) throw new Error('CSV enthält keine Datenzeilen.');
    const headers = parsed.rows[0];
    const kind = detectKind(headers);
    if (!kind) {
      const suffix = filename ? ` (${filename})` : '';
      throw new Error(`Dateityp nicht erkannt${suffix}.`);
    }

    const output = emptyParsed(kind, parsed.metadataRowsDiscarded);
    const timeIndex = headerIndex(headers, ['zeitstempel', 'timestamp']);

    const index = {
      cgm: headerIndex(headers, ['cgm-glukosewert', 'cgm-glukose', 'cgm glucose']),
      carbs: headerIndex(headers, ['kohlenhydrataufnahme', 'carbohydrate intake', 'carbs']),
      delivered: headerIndex(headers, ['abgegebenes insulin', 'delivered insulin']),
      enteredGlucose: headerIndex(headers, [
        'blutzuckereingabe',
        'entered glucose',
        'blood glucose input',
      ]),
      insulinType: headerIndex(headers, ['insulin-typ', 'insulin type']),
      bolusTotal: headerIndex(headers, ['bolus gesamt', 'total bolus']),
      insulinTotal: headerIndex(headers, ['insulin gesamt', 'total insulin']),
      basalTotal: headerIndex(headers, ['basal gesamt', 'total basal']),
      duration: headerIndex(headers, ['dauer (minuten)', 'duration (minutes)']),
      percentage: headerIndex(headers, ['prozentsatz (%)', 'percentage (%)']),
      rate: headerIndex(headers, ['rate']),
      manualGlucose: headerIndex(headers, ['glukosewert (mg/dl)', 'glucose value (mg/dl)']),
      manualReading: headerIndex(headers, ['manuelles lesen', 'manual reading']),
      alarmEvent: headerIndex(headers, ['alarm/ereignis', 'alarm/event']),
    };

    for (const row of parsed.rows.slice(1)) {
      const minute = parseTime(row[timeIndex]);
      if (minute === null) {
        output.rejected += 1;
        continue;
      }

      if (kind === 'cgm') {
        const raw = parseNumber(row[index.cgm]);
        if (raw === 1) output.cgm.push([minute, null, -1]);
        else if (raw === 2001) output.cgm.push([minute, null, 1]);
        else if (raw !== null && raw >= 40 && raw <= 400) {
          output.cgm.push([minute, round(raw, 1), 0]);
        } else output.rejected += 1;
        continue;
      }

      if (kind === 'bolus') {
        const carbs = index.carbs >= 0 ? parseNumber(row[index.carbs]) : null;
        const delivered = index.delivered >= 0 ? parseNumber(row[index.delivered]) : null;
        const enteredGlucose =
          index.enteredGlucose >= 0 ? parseNumber(row[index.enteredGlucose]) : null;
        const insulinType =
          index.insulinType >= 0 ? text(row[index.insulinType]).slice(0, 80) : '';
        if (carbs === null && delivered === null && enteredGlucose === null && !insulinType) {
          output.rejected += 1;
          continue;
        }
        output.boluses.push([
          minute,
          carbs === null ? null : round(carbs, 1),
          delivered === null ? null : round(delivered, 2),
          enteredGlucose === null ? null : round(enteredGlucose, 0),
          insulinType,
        ]);
        continue;
      }

      if (kind === 'dailyInsulin') {
        const bolusTotal = index.bolusTotal >= 0 ? parseNumber(row[index.bolusTotal]) : null;
        const insulinTotal = index.insulinTotal >= 0 ? parseNumber(row[index.insulinTotal]) : null;
        const basalTotal = index.basalTotal >= 0 ? parseNumber(row[index.basalTotal]) : null;
        if (bolusTotal === null && insulinTotal === null && basalTotal === null) {
          output.rejected += 1;
          continue;
        }
        output.dailyInsulin.push([
          minute,
          bolusTotal === null ? null : round(bolusTotal, 2),
          insulinTotal === null ? null : round(insulinTotal, 2),
          basalTotal === null ? null : round(basalTotal, 2),
        ]);
        continue;
      }

      if (kind === 'basal') {
        const insulinType =
          index.insulinType >= 0 ? text(row[index.insulinType]).slice(0, 80) : '';
        const duration = index.duration >= 0 ? parseNumber(row[index.duration]) : null;
        const percentage = index.percentage >= 0 ? parseNumber(row[index.percentage]) : null;
        const rate = index.rate >= 0 ? parseNumber(row[index.rate]) : null;
        const delivered = index.delivered >= 0 ? parseNumber(row[index.delivered]) : null;
        if (
          !insulinType &&
          duration === null &&
          percentage === null &&
          rate === null &&
          delivered === null
        ) {
          output.rejected += 1;
          continue;
        }
        output.basalEvents.push([
          minute,
          insulinType,
          duration === null ? null : round(duration, 0),
          percentage === null ? null : round(percentage, 1),
          rate === null ? null : round(rate, 3),
          delivered === null ? null : round(delivered, 2),
        ]);
        continue;
      }

      if (kind === 'bg') {
        const glucose =
          index.manualGlucose >= 0 ? parseNumber(row[index.manualGlucose]) : null;
        const manual =
          index.manualReading >= 0 ? text(row[index.manualReading]).slice(0, 80) : '';
        if (glucose === null && !manual) {
          output.rejected += 1;
          continue;
        }
        output.manualGlucose.push([
          minute,
          glucose === null ? null : round(glucose, 0),
          manual,
        ]);
        continue;
      }

      if (kind === 'alarm') {
        const event = index.alarmEvent >= 0 ? text(row[index.alarmEvent]).slice(0, 240) : '';
        if (!event) {
          output.rejected += 1;
          continue;
        }
        output.alarms.push([minute, event]);
      }
    }

    return output;
  }

  function dedupeByKey(rows, keyFunction) {
    const map = new Map();
    for (const row of rows || []) {
      if (!Array.isArray(row) || !Number.isFinite(Number(row[0]))) continue;
      map.set(keyFunction(row), row);
    }
    return [...map.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }

  function dedupeCgm(rows) {
    return dedupeByKey(rows, (row) => String(Number(row[0]))).map((row) => [
      Number(row[0]),
      row[1] === null ? null : Number(row[1]),
      Number(row[2]),
    ]);
  }

  function nullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function dedupeBoluses(rows) {
    return dedupeByKey(rows, (row) =>
      [
        Number(row[0]),
        nullableNumber(row[1]) ?? '',
        nullableNumber(row[2]) ?? '',
        nullableNumber(row[3]) ?? '',
        text(row[4]),
      ].join('|'),
    ).map((row) => [
      Number(row[0]),
      nullableNumber(row[1]),
      nullableNumber(row[2]),
      nullableNumber(row[3]),
      text(row[4]).slice(0, 80),
    ]);
  }

  function dedupeDailyInsulin(rows) {
    return dedupeByKey(rows, (row) => String(Number(row[0]))).map((row) => [
      Number(row[0]),
      nullableNumber(row[1]),
      nullableNumber(row[2]),
      nullableNumber(row[3]),
    ]);
  }

  function dedupeBasal(rows) {
    return dedupeByKey(rows, (row) => row.map((value) => value ?? '').join('|')).map(
      (row) => [
        Number(row[0]),
        text(row[1]).slice(0, 80),
        nullableNumber(row[2]),
        nullableNumber(row[3]),
        nullableNumber(row[4]),
        nullableNumber(row[5]),
      ],
    );
  }

  function dedupeManualGlucose(rows) {
    return dedupeByKey(rows, (row) => row.map((value) => value ?? '').join('|')).map(
      (row) => [Number(row[0]), nullableNumber(row[1]), text(row[2]).slice(0, 80)],
    );
  }

  function dedupeAlarms(rows) {
    return dedupeByKey(rows, (row) => `${Number(row[0])}|${text(row[1])}`).map(
      (row) => [Number(row[0]), text(row[1]).slice(0, 240)],
    );
  }

  function normalizeClinical(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      cgm: dedupeCgm(source.cgm || []),
      boluses: dedupeBoluses(source.boluses || []),
      dailyInsulin: dedupeDailyInsulin(source.dailyInsulin || []),
      basalEvents: dedupeBasal(source.basalEvents || []),
      manualGlucose: dedupeManualGlucose(source.manualGlucose || []),
      alarms: dedupeAlarms(source.alarms || []),
      imports: Array.isArray(source.imports) ? source.imports.slice(-50) : [],
      updatedAt: source.updatedAt || null,
    };
  }

  function mergeClinical(currentValue, items) {
    const current = normalizeClinical(currentValue);
    const collected = (key) => items.flatMap((item) => item[key] || []);

    const cgm = dedupeCgm([...current.cgm, ...collected('cgm')]);
    const boluses = dedupeBoluses([...current.boluses, ...collected('boluses')]);
    const dailyInsulin = dedupeDailyInsulin([
      ...current.dailyInsulin,
      ...collected('dailyInsulin'),
    ]);
    const basalEvents = dedupeBasal([
      ...current.basalEvents,
      ...collected('basalEvents'),
    ]);
    const manualGlucose = dedupeManualGlucose([
      ...current.manualGlucose,
      ...collected('manualGlucose'),
    ]);
    const alarms = dedupeAlarms([...current.alarms, ...collected('alarms')]);

    const now = new Date().toISOString();
    const summary = {
      at: now,
      files: items.length,
      kinds: items.map((item) => item.kind),
      cgmAdded: cgm.length - current.cgm.length,
      bolusesAdded: boluses.length - current.boluses.length,
      dailyInsulinAdded: dailyInsulin.length - current.dailyInsulin.length,
      basalEventsAdded: basalEvents.length - current.basalEvents.length,
      manualGlucoseAdded: manualGlucose.length - current.manualGlucose.length,
      alarmsAdded: alarms.length - current.alarms.length,
      rejected: items.reduce((sum, item) => sum + Number(item.rejected || 0), 0),
    };

    return {
      clinical: {
        cgm,
        boluses,
        dailyInsulin,
        basalEvents,
        manualGlucose,
        alarms,
        imports: [...current.imports, summary].slice(-50),
        updatedAt: now,
      },
      summary,
    };
  }

  function formatSummary(summary) {
    const parts = [
      [summary.cgmAdded, 'CGM-Werte'],
      [summary.bolusesAdded, 'Bolusereignisse'],
      [summary.dailyInsulinAdded, 'Tages-Insulinzeilen'],
      [summary.basalEventsAdded, 'Basalereignisse'],
      [summary.manualGlucoseAdded, 'manuelle Glukosewerte'],
      [summary.alarmsAdded, 'Alarme/Ereignisse'],
    ]
      .filter(([count]) => Number(count) > 0)
      .map(([count, label]) => `${count} neue ${label}`);

    if (!parts.length) parts.push('keine neuen Zeilen (nur Duplikate oder leere Daten)');
    const kinds = [...new Set(summary.kinds || [])]
      .map((kind) => SUPPORTED_KINDS[kind] || kind)
      .join(', ');
    return `${parts.join(', ')}${kinds ? ` · erkannt: ${kinds}` : ''}${
      summary.rejected ? ` · ${summary.rejected} verworfen` : ''
    }`;
  }

  function installBrowserPatches() {
    if (
      typeof document === 'undefined' ||
      typeof gcState === 'undefined' ||
      typeof gcSave !== 'function' ||
      typeof gcRender !== 'function'
    ) {
      return;
    }

    const previousLoad = typeof gcLoad === 'function' ? gcLoad : null;
    if (previousLoad) {
      gcLoad = function extendedLoad() {
        previousLoad();
        try {
          const stored = JSON.parse(localStorage.getItem(GC_CLINICAL_KEY) || 'null');
          gcState.clinical = normalizeClinical(stored);
        } catch {
          gcState.clinical = normalizeClinical(gcState.clinical);
        }
      };
    }

    if (typeof gcImportView === 'function') {
      gcImportView = function extendedImportView() {
        const clinical = normalizeClinical(gcState.clinical);
        gcState.clinical = clinical;
        const facts = [
          ['CGM-Werte', clinical.cgm.length],
          ['Bolusereignisse', clinical.boluses.length],
          ['Tages-Insulinzeilen', clinical.dailyInsulin.length],
          ['Basalereignisse', clinical.basalEvents.length],
          ['manuelle Glukosewerte', clinical.manualGlucose.length],
          ['Alarme/Ereignisse', clinical.alarms.length],
          ['Importvorgänge', clinical.imports.length],
        ];
        const target = document.querySelector('#local-data-facts');
        if (target) {
          target.innerHTML = facts
            .map(([label, value]) => `<li><span>${label}</span><strong>${value}</strong></li>`)
            .join('');
        }
        const last = gcState.lastImport || clinical.imports.at(-1);
        const summary = document.querySelector('#import-summary');
        if (summary) {
          summary.innerHTML = last
            ? `<div class="notice info"><strong>Letzter Import:</strong> ${formatSummary(
                last,
              )}</div>`
            : '<p class="muted">Noch keine persönliche CSV in diesem Browser importiert.</p>';
        }
      };
    }

    if (typeof gcQuality === 'function') {
      const previousQuality = gcQuality;
      gcQuality = function extendedQuality() {
        previousQuality();
        const body = document.querySelector('#quality-body');
        if (!body) return;
        body.insertAdjacentHTML(
          'afterbegin',
          '<tr><td>Omnipod-Dateitypen</td><td>6 unterstützt</td><td>CGM, Bolus, Tagesinsulin, Basal, manuelle Glukose und Alarme/Ereignisse werden getrennt erkannt; Basalzeilen werden nicht als Bolus behandelt.</td></tr>',
        );
      };
    }

    const description = document.querySelector('.import-drop p');
    if (description) {
      description.innerHTML =
        '<strong>Mehrere Dateien gleichzeitig auswählen:</strong> unterstützt werden <code>cgm_data_*.csv</code>, <code>bolus_data_*.csv</code>, <code>insulin_data_*.csv</code>, <code>basal_data_*.csv</code>, <code>bg_data_*.csv</code> und <code>alarms_data_*.csv</code>.';
    }

    const csvInput = document.querySelector('#csv-files');
    const importButton = document.querySelector('#import-csv');
    if (csvInput && importButton) {
      importButton.onclick = async function extendedCsvImport() {
        const progress = document.querySelector('#import-progress');
        try {
          const parsedItems = [];
          for (const file of csvInput.files || []) {
            parsedItems.push(parseClinicalCsv(await file.text(), file.name));
          }
          if (!parsedItems.length) throw new Error('Keine CSV-Dateien ausgewählt.');
          const merged = mergeClinical(gcState.clinical, parsedItems);
          gcState.clinical = merged.clinical;
          gcState.lastImport = merged.summary;
          gcSave();
          if (progress) progress.textContent = `Fertig: ${formatSummary(merged.summary)}.`;
          csvInput.value = '';
          const selected = document.querySelector('#selected-files');
          if (selected) selected.textContent = 'Keine Dateien ausgewählt.';
          gcRender();
          if (typeof gcShow === 'function') gcShow('overview');
        } catch (error) {
          if (progress) progress.textContent = `Import fehlgeschlagen: ${error.message}`;
        }
      };
    }


    if (previousLoad) {
      gcLoad();
      gcRender();
    }
  }

  const api = {
    parseClinicalCsv,
    mergeClinical,
    normalizeClinical,
    dedupeCgm,
    dedupeBoluses,
    dedupeDailyInsulin,
    dedupeBasal,
    dedupeManualGlucose,
    dedupeAlarms,
    formatSummary,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ...module.exports, ...api };
  }

  if (typeof parseClinicalCsv !== 'undefined') {
    parseClinicalCsv = api.parseClinicalCsv;
  }
  if (typeof mergeClinical !== 'undefined') {
    mergeClinical = api.mergeClinical;
  }
  if (typeof GlucoseCoachV3 !== 'undefined') {
    GlucoseCoachV3.parseClinicalCsv = api.parseClinicalCsv;
    GlucoseCoachV3.mergeClinical = api.mergeClinical;
    GlucoseCoachV3.normalizeClinical = api.normalizeClinical;
  }

  installBrowserPatches();
})();
