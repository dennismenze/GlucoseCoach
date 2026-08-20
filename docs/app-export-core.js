(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const BACKUP_SCHEMA = 'glucosecoach-backup-v4';

  const EXPORT_COLUMNS = [
    ['section', 'Bereich'],
    ['dataType', 'Datentyp'],
    ['timestampLocal', 'Zeitstempel_lokal'],
    ['timestampIso', 'Zeitstempel_ISO'],
    ['profileId', 'Profil_ID'],
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
    ['rawJson', 'Rohdaten_JSON'],
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

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function timestampFields(value, isMinute = false) {
    const date = isMinute ? new Date(Number(value) * MINUTE_MS) : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return { timestampLocal: String(value ?? ''), timestampIso: '' };
    }
    return {
      timestampLocal: new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(date),
      timestampIso: date.toISOString(),
    };
  }

  function record(section, dataType, raw, fields = {}, timeValue = null, isMinute = true) {
    return {
      section,
      dataType,
      ...(timeValue === null ? {} : timestampFields(timeValue, isMinute)),
      ...fields,
      rawJson: JSON.stringify(raw ?? null),
    };
  }

  function clinicalRecord(key, label, row) {
    const minute = row?.[0];
    if (key === 'cgm') {
      return record('Klinische Daten', label, row, {
        glucose: row[1],
        status: Number(row[2]) === -1 ? 'LOW' : Number(row[2]) === 1 ? 'HIGH' : 'exakt',
      }, minute);
    }
    if (key === 'boluses') {
      return record('Klinische Daten', label, row, {
        carbs: row[1], insulin: row[2], glucose: row[3], type: row[4], source: 'Pumpe',
      }, minute);
    }
    if (key === 'dailyInsulin') {
      return record('Klinische Daten', label, row, {
        bolusTotal: row[1], insulinTotal: row[2], basalTotal: row[3],
      }, minute);
    }
    if (key === 'basalEvents') {
      return record('Klinische Daten', label, row, {
        type: row[1], duration: row[2], percentage: row[3], rate: row[4], insulin: row[5],
      }, minute);
    }
    if (key === 'manualGlucose') {
      return record('Klinische Daten', label, row, {
        glucose: row[1], status: row[2], source: 'manuell',
      }, minute);
    }
    if (key === 'alarms') {
      return record('Klinische Daten', label, row, { name: row[1], note: row[1] }, minute);
    }
    if (key === 'cgmCarbs') {
      return record('Kontextdaten', label, row, { carbs: row[1] }, minute);
    }
    if (key === 'exerciseEvents') {
      return record('Kontextdaten', label, row, {
        name: row[1], intensity: row[2], duration: row[3], calories: row[4],
      }, minute);
    }
    if (key === 'foodEvents') {
      return record('Kontextdaten', label, row, {
        name: row[1], carbs: row[2], fat: row[3], protein: row[4], calories: row[5],
        portions: row[6], portionCount: row[7],
      }, minute);
    }
    if (key === 'manualInsulin') {
      return record('Kontextdaten', label, row, {
        name: row[1], insulin: row[2], type: row[3], source: 'manuell',
      }, minute);
    }
    if (key === 'medications') {
      return record('Kontextdaten', label, row, {
        name: row[1], value: row[2], type: row[3],
      }, minute);
    }
    return record('Kontextdaten', label, row, { note: row[1] }, minute);
  }

  function buildCompleteExportRows(payload = {}) {
    const profile = payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
    const clinical = payload.clinical && typeof payload.clinical === 'object' ? payload.clinical : {};
    const diary = safeArray(payload.diary);
    const rows = [];
    const exportedAt = payload.exportedAt || new Date().toISOString();

    rows.push(record('Metadaten', 'Export', { schema: BACKUP_SCHEMA, exportedAt }, {
      value: BACKUP_SCHEMA,
      status: 'vollständiger lokaler Export',
    }, exportedAt, false));
    rows.push(record('Metadaten', 'Profil', profile, {
      profileId: profile.id || '',
      value: profile.createdAt || '',
      status: profile.createdAt ? 'erstellt' : '',
    }, profile.createdAt || null, false));
    rows.push(record('Metadaten', 'Einstellung', payload.ui || {}, {
      name: 'Analysezeitraum',
      value: payload.ui?.windowDays ?? '',
      unit: 'Tage bzw. all',
    }));
    rows.push(record('Metadaten', 'Klinischer Datenbestand', {
      updatedAt: clinical.updatedAt || null,
    }, {
      status: clinical.updatedAt ? 'zuletzt aktualisiert' : 'ohne Aktualisierungszeitpunkt',
    }, clinical.updatedAt || null, false));

    for (const [key, label] of CLINICAL_TYPES) {
      const values = safeArray(clinical[key]);
      rows.push(record('Bestand', label, { key, count: values.length }, {
        name: key,
        value: values.length,
        unit: 'Zeilen',
      }));
      for (const row of values) rows.push(clinicalRecord(key, label, row));
    }

    rows.push(record('Bestand', 'Tagebuch', { count: diary.length }, {
      value: diary.length,
      unit: 'Einträge',
    }));
    for (const entry of diary) {
      rows.push(record('Tagebuch', 'Tagebucheintrag', entry, {
        profileId: profile.id || '',
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

    const imports = safeArray(clinical.imports);
    rows.push(record('Bestand', 'Importhistorie', { count: imports.length }, {
      value: imports.length,
      unit: 'Importvorgänge',
    }));
    for (const item of imports) {
      rows.push(record('Importhistorie', 'Importvorgang', item, {
        files: item.files,
        importKinds: safeArray(item.kinds).join(', '),
        rejected: item.rejected,
        status: 'gespeichert',
      }, item.at || null, false));
    }

    return rows.map((row) => ({
      ...row,
      profileId: row.profileId || profile.id || '',
    }));
  }

  function csvValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value).replace('.', ',') : '';
    }
    let source = typeof value === 'object' ? JSON.stringify(value) : String(value);
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

  function buildBackupPayload(payload = {}) {
    return {
      schema: BACKUP_SCHEMA,
      exportedAt: payload.exportedAt || new Date().toISOString(),
      profile: payload.profile && typeof payload.profile === 'object' ? payload.profile : {},
      ui: payload.ui && typeof payload.ui === 'object' ? payload.ui : {},
      diary: safeArray(payload.diary),
      clinical: payload.clinical && typeof payload.clinical === 'object' ? payload.clinical : {},
    };
  }

  const api = {
    BACKUP_SCHEMA,
    CLINICAL_TYPES,
    EXPORT_COLUMNS,
    buildBackupPayload,
    buildCompleteCsv,
    buildCompleteExportRows,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
