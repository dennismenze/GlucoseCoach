(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const CSV_SCHEMA = 'glucosecoach-csv-v1';

  const EXPORT_COLUMNS = [
    ['section', 'Bereich'],
    ['dataType', 'Datentyp'],
    ['timestampIso', 'Zeitstempel_ISO'],
    ['version', 'App_Version'],
    ['recordId', 'Datensatz_ID'],
    ['name', 'Name'],
    ['occasion', 'Anlass'],
    ['type', 'Typ'],
    ['source', 'Quelle'],
    ['value', 'Wert'],
    ['unit', 'Einheit'],
    ['glucose', 'Glukose_mg_dl'],
    ['carbs', 'Kohlenhydrate_g'],
    ['fat', 'Fett_g'],
    ['protein', 'Eiweiss_g'],
    ['fiber', 'Ballaststoffe_g'],
    ['insulin', 'Insulin_E'],
    ['bolusTotal', 'Bolus_gesamt_E'],
    ['basalTotal', 'Basal_gesamt_E'],
    ['insulinTotal', 'Insulin_gesamt_E'],
    ['duration', 'Dauer_min'],
    ['percentage', 'Prozent'],
    ['rate', 'Rate_E_pro_h'],
    ['calories', 'Kalorien'],
    ['portions', 'Portionen'],
    ['portionCount', 'Anzahl_Portionen'],
    ['intensity', 'Intensitaet'],
    ['activity', 'Aktivitaet'],
    ['sleep', 'Schlaf_h'],
    ['stress', 'Stress_0_bis_10'],
    ['illness', 'Krankheit'],
    ['note', 'Notiz'],
    ['status', 'Status'],
    ['files', 'Dateien'],
    ['importKinds', 'Importtypen'],
    ['rejected', 'Verworfen'],
    ['cgmAdded', 'CGM_neu'],
    ['bolusesAdded', 'Boli_neu'],
    ['dailyInsulinAdded', 'Tagesinsulin_neu'],
    ['basalEventsAdded', 'Basalereignisse_neu'],
    ['manualGlucoseAdded', 'Manuelle_Glukose_neu'],
    ['alarmsAdded', 'Alarme_neu'],
    ['cgmCarbsAdded', 'CGM_KH_neu'],
    ['exerciseAdded', 'Sport_neu'],
    ['foodAdded', 'Lebensmittel_neu'],
    ['manualInsulinAdded', 'Manuelles_Insulin_neu'],
    ['medicationsAdded', 'Medikamente_neu'],
    ['notesAdded', 'Notizen_neu'],
  ];

  const CLINICAL_TYPES = [
    ['cgm', 'CGM'],
    ['boluses', 'Bolus'],
    ['dailyInsulin', 'Tagesinsulin'],
    ['basalEvents', 'Basal'],
    ['manualGlucose', 'Manuelle Glukose'],
    ['alarms', 'Alarm/Ereignis'],
    ['cgmCarbs', 'CGM-Kohlenhydrate'],
    ['exerciseEvents', 'Sport'],
    ['foodEvents', 'Lebensmittel'],
    ['manualInsulin', 'Manuelles Insulin'],
    ['medications', 'Medikament'],
    ['notes', 'Notiz'],
  ];

  const TYPE_TO_KEY = new Map(CLINICAL_TYPES.map(([key, label]) => [label, key]));
  const IMPORT_COUNT_FIELDS = [
    'cgmAdded',
    'bolusesAdded',
    'dailyInsulinAdded',
    'basalEventsAdded',
    'manualGlucoseAdded',
    'alarmsAdded',
    'cgmCarbsAdded',
    'exerciseAdded',
    'foodAdded',
    'manualInsulinAdded',
    'medicationsAdded',
    'notesAdded',
  ];

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function timestampIso(value, isMinute = false) {
    if (value === null || value === undefined || value === '') return '';
    const date = isMinute ? new Date(Number(value) * MINUTE_MS) : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function localDateTimeInput(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * MINUTE_MS);
    return local.toISOString().slice(0, 16);
  }

  function record(section, dataType, fields = {}, timeValue = null, isMinute = true) {
    return {
      section,
      dataType,
      timestampIso: timestampIso(timeValue, isMinute),
      ...fields,
    };
  }

  function clinicalRecord(key, label, row) {
    const minute = row?.[0];
    if (key === 'cgm') {
      return record('Klinische Daten', label, {
        glucose: row[1],
        status: Number(row[2]) === -1 ? 'LOW' : Number(row[2]) === 1 ? 'HIGH' : 'exakt',
      }, minute);
    }
    if (key === 'boluses') {
      return record('Klinische Daten', label, {
        carbs: row[1],
        insulin: row[2],
        glucose: row[3],
        type: row[4],
        source: 'Pumpe',
      }, minute);
    }
    if (key === 'dailyInsulin') {
      return record('Klinische Daten', label, {
        bolusTotal: row[1],
        insulinTotal: row[2],
        basalTotal: row[3],
      }, minute);
    }
    if (key === 'basalEvents') {
      return record('Klinische Daten', label, {
        type: row[1],
        duration: row[2],
        percentage: row[3],
        rate: row[4],
        insulin: row[5],
      }, minute);
    }
    if (key === 'manualGlucose') {
      return record('Klinische Daten', label, {
        glucose: row[1],
        status: row[2],
        source: 'manuell',
      }, minute);
    }
    if (key === 'alarms') {
      return record('Klinische Daten', label, { note: row[1] }, minute);
    }
    if (key === 'cgmCarbs') {
      return record('Kontextdaten', label, { carbs: row[1] }, minute);
    }
    if (key === 'exerciseEvents') {
      return record('Kontextdaten', label, {
        name: row[1],
        intensity: row[2],
        duration: row[3],
        calories: row[4],
      }, minute);
    }
    if (key === 'foodEvents') {
      return record('Kontextdaten', label, {
        name: row[1],
        carbs: row[2],
        fat: row[3],
        protein: row[4],
        calories: row[5],
        portions: row[6],
        portionCount: row[7],
      }, minute);
    }
    if (key === 'manualInsulin') {
      return record('Kontextdaten', label, {
        name: row[1],
        insulin: row[2],
        type: row[3],
        source: 'manuell',
      }, minute);
    }
    if (key === 'medications') {
      return record('Kontextdaten', label, {
        name: row[1],
        value: row[2],
        type: row[3],
      }, minute);
    }
    return record('Kontextdaten', label, { note: row[1] }, minute);
  }

  function buildCompleteExportRows(payload = {}) {
    const profile = payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
    const clinical = payload.clinical && typeof payload.clinical === 'object' ? payload.clinical : {};
    const diary = safeArray(payload.diary);
    const exportedAt = payload.exportedAt || new Date().toISOString();
    const rows = [
      record('Metadaten', 'Export', {
        value: CSV_SCHEMA,
        version: payload.version || '',
        status: 'vollständiger lokaler CSV-Export',
      }, exportedAt, false),
      record('Metadaten', 'Profil', {
        recordId: profile.id || '',
        status: profile.createdAt ? 'erstellt' : '',
      }, profile.createdAt || null, false),
      record('Metadaten', 'Einstellung', {
        name: 'Analysezeitraum',
        value: payload.ui?.windowDays ?? '90',
        unit: 'Tage bzw. all',
      }),
      record('Metadaten', 'Klinischer Datenbestand', {
        status: clinical.updatedAt ? 'zuletzt aktualisiert' : '',
      }, clinical.updatedAt || null, false),
    ];

    for (const [key, label] of CLINICAL_TYPES) {
      for (const row of safeArray(clinical[key])) {
        rows.push(clinicalRecord(key, label, row));
      }
    }

    for (const entry of diary) {
      rows.push(record('Tagebuch', 'Tagebucheintrag', {
        recordId: entry.id || '',
        name: entry.food || '',
        occasion: entry.occasion || '',
        carbs: finite(entry.carbs),
        fat: finite(entry.fat),
        protein: finite(entry.protein),
        fiber: finite(entry.fiber),
        activity: entry.activity || '',
        sleep: finite(entry.sleep),
        stress: finite(entry.stress),
        illness: entry.illness || '',
        note: entry.notes || '',
      }, entry.when || null, false));
    }

    for (const item of safeArray(clinical.imports)) {
      const fields = {
        files: item.files,
        importKinds: safeArray(item.kinds).join('|'),
        rejected: item.rejected,
        status: 'gespeichert',
      };
      for (const field of IMPORT_COUNT_FIELDS) fields[field] = item[field];
      rows.push(record('Importhistorie', 'Importvorgang', fields, item.at || null, false));
    }

    return rows;
  }

  function csvValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value).replace('.', ',') : '';
    }
    if (typeof value === 'object') {
      throw new TypeError('Der CSV-Export akzeptiert nur skalare Feldwerte.');
    }
    let source = String(value);
    if (/^[=+\-@\t\r]/.test(source)) source = `'${source}`;
    return source;
  }

  function quoteCsv(value) {
    return `"${csvValue(value).replace(/"/g, '""')}"`;
  }

  function buildCompleteCsv(payload = {}) {
    const rows = buildCompleteExportRows(payload);
    const header = EXPORT_COLUMNS.map(([, label]) => quoteCsv(label)).join(';');
    const body = rows.map((row) =>
      EXPORT_COLUMNS.map(([key]) => quoteCsv(row[key])).join(';'),
    );
    return `\uFEFF${[header, ...body].join('\r\n')}`;
  }

  function parseDelimited(source) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const text = String(source).replace(/^\uFEFF/, '');

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '"') {
        if (quoted && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (!quoted && character === ';') {
        row.push(field);
        field = '';
      } else if (!quoted && (character === '\n' || character === '\r')) {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        row.push(field);
        if (row.some((value) => value !== '')) rows.push(row);
        row = [];
        field = '';
      } else {
        field += character;
      }
    }
    row.push(field);
    if (row.some((value) => value !== '')) rows.push(row);
    return rows;
  }

  function unprotect(value) {
    const source = String(value ?? '');
    return /^'[=+\-@\t\r]/.test(source) ? source.slice(1) : source;
  }

  function minuteFromIso(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
  }

  function numericText(value) {
    const source = String(value ?? '').trim();
    if (!source) return '';
    const numeric = finite(source);
    return numeric === null ? '' : String(numeric);
  }

  function parseCompleteCsv(source) {
    const parsed = parseDelimited(source);
    if (parsed.length < 2) throw new Error('Die vollständige CSV enthält keine Daten.');
    const expectedHeaders = EXPORT_COLUMNS.map(([, label]) => label);
    if (
      parsed[0].length !== expectedHeaders.length ||
      parsed[0].some((header, index) => header !== expectedHeaders[index])
    ) {
      throw new Error('Die CSV entspricht nicht dem vollständigen GlucoseCoach-Format.');
    }

    const records = parsed.slice(1).map((values) => Object.fromEntries(
      EXPORT_COLUMNS.map(([key], index) => [key, unprotect(values[index] ?? '')]),
    ));
    const exportRow = records.find(
      (row) => row.section === 'Metadaten' && row.dataType === 'Export',
    );
    if (!exportRow || exportRow.value !== CSV_SCHEMA) {
      throw new Error('Unbekannte oder fehlende GlucoseCoach-CSV-Version.');
    }

    const profile = {};
    const ui = { windowDays: '90' };
    const diary = [];
    const clinical = Object.fromEntries(CLINICAL_TYPES.map(([key]) => [key, []]));
    clinical.imports = [];
    clinical.updatedAt = null;

    for (const row of records) {
      if (row.section === 'Metadaten' && row.dataType === 'Profil') {
        if (row.recordId) profile.id = row.recordId;
        if (row.timestampIso) profile.createdAt = row.timestampIso;
        continue;
      }
      if (
        row.section === 'Metadaten' &&
        row.dataType === 'Einstellung' &&
        row.name === 'Analysezeitraum'
      ) {
        const requested = String(row.value || '90');
        ui.windowDays = ['7', '14', '30', '90', 'all'].includes(requested)
          ? requested
          : '90';
        continue;
      }
      if (row.section === 'Metadaten' && row.dataType === 'Klinischer Datenbestand') {
        clinical.updatedAt = row.timestampIso || null;
        continue;
      }
      if (row.section === 'Tagebuch' && row.dataType === 'Tagebucheintrag') {
        diary.push({
          id: row.recordId,
          when: localDateTimeInput(row.timestampIso),
          occasion: row.occasion,
          food: row.name,
          carbs: numericText(row.carbs),
          fat: numericText(row.fat),
          protein: numericText(row.protein),
          fiber: numericText(row.fiber),
          activity: row.activity,
          sleep: numericText(row.sleep),
          stress: numericText(row.stress),
          illness: row.illness,
          notes: row.note,
        });
        continue;
      }
      if (row.section === 'Importhistorie' && row.dataType === 'Importvorgang') {
        const item = {
          at: row.timestampIso,
          files: finite(row.files) ?? 0,
          kinds: row.importKinds ? row.importKinds.split('|').filter(Boolean) : [],
          rejected: finite(row.rejected) ?? 0,
        };
        for (const field of IMPORT_COUNT_FIELDS) {
          if (String(row[field] ?? '').trim() !== '') item[field] = finite(row[field]) ?? 0;
        }
        clinical.imports.push(item);
        continue;
      }

      const key = TYPE_TO_KEY.get(row.dataType);
      if (!key || !['Klinische Daten', 'Kontextdaten'].includes(row.section)) continue;
      const minute = minuteFromIso(row.timestampIso);
      if (minute === null) continue;

      if (key === 'cgm') {
        const status = row.status === 'LOW' ? -1 : row.status === 'HIGH' ? 1 : 0;
        clinical.cgm.push([minute, status === 0 ? finite(row.glucose) : null, status]);
      } else if (key === 'boluses') {
        clinical.boluses.push([
          minute,
          finite(row.carbs),
          finite(row.insulin),
          finite(row.glucose),
          row.type,
        ]);
      } else if (key === 'dailyInsulin') {
        clinical.dailyInsulin.push([
          minute,
          finite(row.bolusTotal),
          finite(row.insulinTotal),
          finite(row.basalTotal),
        ]);
      } else if (key === 'basalEvents') {
        clinical.basalEvents.push([
          minute,
          row.type,
          finite(row.duration),
          finite(row.percentage),
          finite(row.rate),
          finite(row.insulin),
        ]);
      } else if (key === 'manualGlucose') {
        clinical.manualGlucose.push([minute, finite(row.glucose), row.status]);
      } else if (key === 'alarms') {
        clinical.alarms.push([minute, row.note]);
      } else if (key === 'cgmCarbs') {
        clinical.cgmCarbs.push([minute, finite(row.carbs)]);
      } else if (key === 'exerciseEvents') {
        clinical.exerciseEvents.push([
          minute,
          row.name,
          row.intensity,
          finite(row.duration),
          finite(row.calories),
        ]);
      } else if (key === 'foodEvents') {
        clinical.foodEvents.push([
          minute,
          row.name,
          finite(row.carbs),
          finite(row.fat),
          finite(row.protein),
          finite(row.calories),
          row.portions,
          finite(row.portionCount),
        ]);
      } else if (key === 'manualInsulin') {
        clinical.manualInsulin.push([minute, row.name, finite(row.insulin), row.type]);
      } else if (key === 'medications') {
        clinical.medications.push([minute, row.name, row.value, row.type]);
      } else if (key === 'notes') {
        clinical.notes.push([minute, row.note]);
      }
    }

    return {
      schema: CSV_SCHEMA,
      version: exportRow.version || '',
      exportedAt: exportRow.timestampIso || '',
      profile,
      ui,
      diary,
      clinical,
    };
  }

  const api = {
    CSV_SCHEMA,
    CLINICAL_TYPES,
    EXPORT_COLUMNS,
    buildCompleteCsv,
    buildCompleteExportRows,
    parseCompleteCsv,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
