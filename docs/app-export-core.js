(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const CSV_FORMAT = 'glucosecoach-csv-v2';

  const EXPORT_COLUMNS = [
    ['dataType', 'Datentyp'],
    ['timestamp', 'Zeitstempel'],
    ['profileId', 'Profil_ID'],
    ['recordId', 'Datensatz_ID'],
    ['name', 'Name'],
    ['occasion', 'Anlass'],
    ['type', 'Typ'],
    ['value', 'Wert'],
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
  const IMPORT_COUNT_KEYS = [
    'cgmAdded', 'bolusesAdded', 'dailyInsulinAdded', 'basalEventsAdded',
    'manualGlucoseAdded', 'alarmsAdded', 'cgmCarbsAdded', 'exerciseAdded',
    'foodAdded', 'manualInsulinAdded', 'medicationsAdded', 'notesAdded',
  ];

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function text(value) {
    const source = String(value ?? '');
    return /^'[=+\-@\t\r]/.test(source) ? source.slice(1) : source;
  }

  function minuteTimestamp(value) {
    const numeric = finite(value);
    if (numeric === null) return '';
    const date = new Date(numeric * MINUTE_MS);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function timestampMinute(value, dataType) {
    const numeric = Date.parse(String(value || ''));
    if (!Number.isFinite(numeric)) {
      throw new Error(`Ungültiger Zeitstempel für ${dataType}.`);
    }
    return Math.round(numeric / MINUTE_MS);
  }

  function record(dataType, fields = {}) {
    return { dataType, ...fields };
  }

  function clinicalRecord(key, label, row) {
    const timestamp = minuteTimestamp(row?.[0]);
    if (key === 'cgm') {
      return record(label, {
        timestamp,
        glucose: row[1],
        status: Number(row[2]) === -1 ? 'LOW' : Number(row[2]) === 1 ? 'HIGH' : 'exakt',
      });
    }
    if (key === 'boluses') {
      return record(label, {
        timestamp,
        carbs: row[1], insulin: row[2], glucose: row[3], type: row[4],
      });
    }
    if (key === 'dailyInsulin') {
      return record(label, {
        timestamp,
        bolusTotal: row[1], insulinTotal: row[2], basalTotal: row[3],
      });
    }
    if (key === 'basalEvents') {
      return record(label, {
        timestamp,
        type: row[1], duration: row[2], percentage: row[3], rate: row[4], insulin: row[5],
      });
    }
    if (key === 'manualGlucose') {
      return record(label, { timestamp, glucose: row[1], status: row[2] });
    }
    if (key === 'alarms') {
      return record(label, { timestamp, note: row[1] });
    }
    if (key === 'cgmCarbs') {
      return record(label, { timestamp, carbs: row[1] });
    }
    if (key === 'exerciseEvents') {
      return record(label, {
        timestamp,
        name: row[1], intensity: row[2], duration: row[3], calories: row[4],
      });
    }
    if (key === 'foodEvents') {
      return record(label, {
        timestamp,
        name: row[1], carbs: row[2], fat: row[3], protein: row[4], calories: row[5],
        portions: row[6], portionCount: row[7],
      });
    }
    if (key === 'manualInsulin') {
      return record(label, { timestamp, name: row[1], insulin: row[2], type: row[3] });
    }
    if (key === 'medications') {
      return record(label, { timestamp, name: row[1], value: row[2], type: row[3] });
    }
    return record(label, { timestamp, note: row[1] });
  }

  function buildCompleteExportRows(payload = {}) {
    const profile = payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
    const clinical = payload.clinical && typeof payload.clinical === 'object' ? payload.clinical : {};
    const diary = safeArray(payload.diary);
    const exportedAt = payload.exportedAt || new Date().toISOString();
    const rows = [
      record('Format', { timestamp: exportedAt, value: CSV_FORMAT }),
      record('Profil', {
        timestamp: profile.createdAt || '',
        profileId: profile.id || '',
      }),
      record('Einstellung', {
        name: 'Analysezeitraum',
        value: payload.ui?.windowDays ?? '90',
      }),
      record('Klinischer Datenbestand', { timestamp: clinical.updatedAt || '' }),
    ];

    for (const [key, label] of CLINICAL_TYPES) {
      for (const row of safeArray(clinical[key])) rows.push(clinicalRecord(key, label, row));
    }

    for (const entry of diary) {
      rows.push(record('Tagebucheintrag', {
        timestamp: entry.when || '',
        recordId: entry.id || '',
        name: entry.food || '',
        occasion: entry.occasion || '',
        carbs: entry.carbs ?? '',
        fat: entry.fat ?? '',
        protein: entry.protein ?? '',
        fiber: entry.fiber ?? '',
        activity: entry.activity || '',
        sleep: entry.sleep ?? '',
        stress: entry.stress ?? '',
        illness: entry.illness || '',
        note: entry.notes || '',
      }));
    }

    for (const item of safeArray(clinical.imports)) {
      const fields = {
        timestamp: item.at || '',
        files: item.files ?? '',
        importKinds: safeArray(item.kinds).join(', '),
        rejected: item.rejected ?? '',
      };
      for (const key of IMPORT_COUNT_KEYS) fields[key] = item[key] ?? '';
      rows.push(record('Importvorgang', fields));
    }

    return rows;
  }

  function csvValue(value) {
    if (value === null || value === undefined) return '';
    const source = String(value);
    return /^[=+\-@\t\r]/.test(source) ? `'${source}` : source;
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
    const input = String(source).replace(/^\uFEFF/, '');
    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      if (character === '"') {
        if (quoted && input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = !quoted;
      } else if (!quoted && character === ';') {
        row.push(field);
        field = '';
      } else if (!quoted && (character === '\n' || character === '\r')) {
        if (character === '\r' && input[index + 1] === '\n') index += 1;
        row.push(field);
        if (row.some((value) => value !== '')) rows.push(row);
        row = [];
        field = '';
      } else field += character;
    }
    row.push(field);
    if (row.some((value) => value !== '')) rows.push(row);
    if (quoted) throw new Error('CSV enthält ein nicht geschlossenes Anführungszeichen.');
    return rows;
  }

  function objectsFromCsv(source) {
    const rows = parseDelimited(source);
    if (!rows.length) throw new Error('CSV ist leer.');
    const header = rows[0].map(text);
    const expected = EXPORT_COLUMNS.map(([, label]) => label);
    const missing = expected.filter((label) => !header.includes(label));
    if (missing.length) throw new Error(`Unvollständige GlucoseCoach-CSV: ${missing.join(', ')} fehlt.`);
    return rows.slice(1).map((cells) => {
      const object = {};
      for (const [key, label] of EXPORT_COLUMNS) {
        object[key] = text(cells[header.indexOf(label)] ?? '');
      }
      return object;
    });
  }

  function emptyClinical() {
    return {
      cgm: [], boluses: [], dailyInsulin: [], basalEvents: [], manualGlucose: [], alarms: [],
      cgmCarbs: [], exerciseEvents: [], foodEvents: [], manualInsulin: [], medications: [], notes: [],
      imports: [], updatedAt: null,
    };
  }

  function clinicalRowFromObject(key, row) {
    const minute = timestampMinute(row.timestamp, row.dataType);
    if (key === 'cgm') {
      const status = row.status.toUpperCase();
      return [minute, status === 'LOW' || status === 'HIGH' ? null : finite(row.glucose), status === 'LOW' ? -1 : status === 'HIGH' ? 1 : 0];
    }
    if (key === 'boluses') return [minute, finite(row.carbs), finite(row.insulin), finite(row.glucose), row.type];
    if (key === 'dailyInsulin') return [minute, finite(row.bolusTotal), finite(row.insulinTotal), finite(row.basalTotal)];
    if (key === 'basalEvents') return [minute, row.type, finite(row.duration), finite(row.percentage), finite(row.rate), finite(row.insulin)];
    if (key === 'manualGlucose') return [minute, finite(row.glucose), row.status];
    if (key === 'alarms') return [minute, row.note];
    if (key === 'cgmCarbs') return [minute, finite(row.carbs)];
    if (key === 'exerciseEvents') return [minute, row.name, row.intensity, finite(row.duration), finite(row.calories)];
    if (key === 'foodEvents') return [minute, row.name, finite(row.carbs), finite(row.fat), finite(row.protein), finite(row.calories), row.portions, finite(row.portionCount)];
    if (key === 'manualInsulin') return [minute, row.name, finite(row.insulin), row.type];
    if (key === 'medications') return [minute, row.name, row.value, row.type];
    return [minute, row.note];
  }

  function parseCompleteCsv(source) {
    const rows = objectsFromCsv(source);
    const format = rows.find((row) => row.dataType === 'Format');
    if (!format || format.value !== CSV_FORMAT) {
      throw new Error('Keine unterstützte vollständige GlucoseCoach-CSV.');
    }

    const profileRow = rows.find((row) => row.dataType === 'Profil') || {};
    const settingRow = rows.find((row) => row.dataType === 'Einstellung' && row.name === 'Analysezeitraum') || {};
    const clinicalStateRow = rows.find((row) => row.dataType === 'Klinischer Datenbestand') || {};
    const clinical = emptyClinical();
    clinical.updatedAt = clinicalStateRow.timestamp || null;

    const diary = [];
    for (const row of rows) {
      const key = TYPE_TO_KEY.get(row.dataType);
      if (key) {
        clinical[key].push(clinicalRowFromObject(key, row));
        continue;
      }
      if (row.dataType === 'Tagebucheintrag') {
        diary.push({
          id: row.recordId,
          when: row.timestamp,
          occasion: row.occasion,
          food: row.name,
          carbs: row.carbs,
          fat: row.fat,
          protein: row.protein,
          fiber: row.fiber,
          activity: row.activity,
          sleep: row.sleep,
          stress: row.stress,
          illness: row.illness,
          notes: row.note,
        });
        continue;
      }
      if (row.dataType === 'Importvorgang') {
        const item = {
          at: row.timestamp || null,
          files: finite(row.files) ?? 0,
          kinds: row.importKinds ? row.importKinds.split(/,\s*/).filter(Boolean) : [],
          rejected: finite(row.rejected) ?? 0,
        };
        for (const countKey of IMPORT_COUNT_KEYS) {
          const count = finite(row[countKey]);
          if (count !== null) item[countKey] = count;
        }
        clinical.imports.push(item);
      }
    }

    return {
      format: CSV_FORMAT,
      exportedAt: format.timestamp || null,
      profile: {
        id: profileRow.profileId || '',
        createdAt: profileRow.timestamp || null,
      },
      ui: { windowDays: settingRow.value || '90' },
      diary,
      clinical,
    };
  }

  const api = {
    CSV_FORMAT,
    CLINICAL_TYPES,
    EXPORT_COLUMNS,
    buildCompleteCsv,
    buildCompleteExportRows,
    parseCompleteCsv,
    parseDelimited,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
