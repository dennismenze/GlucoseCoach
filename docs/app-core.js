    'use strict';

    const DIARY_KEY = 'glucosecoach-diary-v1';
    const CLINICAL_KEY = 'glucosecoach-clinical-v1';
    const BACKUP_SCHEMA = 'glucosecoach-backup-v2';
    const MINUTE = 60_000;
    const MEAL_TYPES = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
    const STATIC_BASELINE = Object.freeze({
      source: 'Veröffentlichter Ausgangsstand 07.05.–04.08.2026',
      start: '2026-05-07T00:00',
      end: '2026-08-04T23:59',
      metrics: {
        samples: 25382, exactSamples: 25352, mean: 138.5, median: null, sd: null,
        cv: 32.5, gmi: 6.62, veryLow: 0.12, low: 1.11, inRange: 82.22,
        high: 12.28, veryHigh: 4.27, below70: 1.23, above180: 16.55,
        lowSentinels: 1, highSentinels: 29, activePercent: 98.40,
      },
      boluses: 690,
      days: 90,
    });

    const state = {
      diary: [],
      clinical: emptyClinical(),
      windowDays: '90',
      lastImport: null,
    };

    function emptyClinical() {
      return { schema: CLINICAL_KEY, cgm: [], boluses: [], imports: [], updatedAt: null };
    }

    function finiteNumber(value) {
      if (value === null || value === undefined || value === '') return null;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    function round(value, digits = 2) {
      if (!Number.isFinite(value)) return null;
      const factor = 10 ** digits;
      return Math.round((value + Number.EPSILON) * factor) / factor;
    }

    function mean(values) {
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    }

    function median(values) {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function standardDeviation(values) {
      const average = mean(values);
      if (average === null) return null;
      return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
    }

    function hasNumericValue(value) {
      return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    }

    function formatNumber(value, digits = 1) {
      if (!hasNumericValue(value)) return '–';
      return new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value));
    }

    function formatPercent(value, digits = 1) {
      return hasNumericValue(value) ? `${formatNumber(value, digits)} %` : '–';
    }

    function formatMg(value) {
      return hasNumericValue(value) ? `${formatNumber(value, 0)} mg/dl` : '–';
    }

    function formatMinutes(value) {
      return hasNumericValue(value) ? `${formatNumber(value, 0)} min` : '–';
    }

    function formatDateTimeMinute(minute) {
      if (!hasNumericValue(minute)) return '–';
      return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(minute) * MINUTE));
    }

    function formatDateMinute(minute) {
      if (!hasNumericValue(minute)) return '–';
      return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(Number(minute) * MINUTE));
    }

    function parseDateTime(value) {
      const text = String(value ?? '').trim();
      if (!text) return null;
      const german = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (german) {
        const [, day, month, year, hour, minute, second = '0'] = german;
        const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
        return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE);
      }
      const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (slash) {
        const [, day, month, year, hour, minute, second = '0'] = slash;
        const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
        return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE);
      }
      const date = new Date(text);
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE);
    }

    function parseLocaleNumber(value) {
      let text = String(value ?? '').trim().replace(/\u00a0/g, '').replace(/\s+/g, '');
      if (!text || /^(nan|null|n\/a|-)$/i.test(text)) return null;
      const comma = text.lastIndexOf(',');
      const dot = text.lastIndexOf('.');
      if (comma >= 0 && dot >= 0) {
        text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
      } else if (comma >= 0) {
        text = text.replace(',', '.');
      }
      text = text.replace(/[^0-9eE+\-.]/g, '');
      const numeric = Number(text);
      return Number.isFinite(numeric) ? numeric : null;
    }

    function normalizeHeader(value) {
      return String(value ?? '').replace(/^\uFEFF/, '').trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
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

    function detectDelimiter(text) {
      const lines = String(text).slice(0, 30000).split(/\r?\n/).filter(Boolean);
      const headerLine = lines.find((line) => /zeitstempel|timestamp/i.test(line)) ?? lines[0] ?? '';
      return [',', ';', '\t'].sort((a, b) => countDelimiter(headerLine, b) - countDelimiter(headerLine, a))[0];
    }

    function parseDelimited(text, delimiter = detectDelimiter(text)) {
      const rows = [];
      let row = [];
      let field = '';
      let quoted = false;
      const source = String(text).replace(/^\uFEFF/, '');
      for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (char === '"') {
          if (quoted && source[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = !quoted;
          }
        } else if (!quoted && char === delimiter) {
          row.push(field);
          field = '';
        } else if (!quoted && (char === '\n' || char === '\r')) {
          if (char === '\r' && source[index + 1] === '\n') index += 1;
          row.push(field);
          if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
          row = [];
          field = '';
        } else {
          field += char;
        }
      }
      row.push(field);
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      return rows;
    }

    function headerIndex(headers, alternatives) {
      const normalized = headers.map(normalizeHeader);
      return normalized.findIndex((header) => alternatives.some((alternative) => header.includes(alternative)));
    }

    function parseClinicalCsv(text) {
      const rows = parseDelimited(text);
      const headerRowIndex = rows.findIndex((row) => {
        const headers = row.map(normalizeHeader);
        return headers.some((header) => header.includes('zeitstempel') || header === 'timestamp') &&
          headers.some((header) => header.includes('cgm-glukose') || header.includes('cgm glucose') || header.includes('kohlenhydrataufnahme') || header.includes('carbohydrate intake') || header.includes('abgegebenes insulin') || header.includes('delivered insulin'));
      });
      if (headerRowIndex < 0) throw new Error('Keine unterstützte CGM- oder Bolus-Kopfzeile gefunden.');
      const headers = rows[headerRowIndex];
      const timeIndex = headerIndex(headers, ['zeitstempel', 'timestamp']);
      const cgmIndex = headerIndex(headers, ['cgm-glukosewert', 'cgm-glukose', 'cgm glucose']);
      const carbsIndex = headerIndex(headers, ['kohlenhydrataufnahme', 'carbohydrate intake', 'carbs']);
      const deliveredIndex = headerIndex(headers, ['abgegebenes insulin', 'delivered insulin', 'delivered']);
      const enteredGlucoseIndex = headerIndex(headers, ['blutzuckereingabe', 'entered glucose', 'blood glucose input']);
      const typeIndex = headerIndex(headers, ['insulin-typ', 'insulin type']);
      const kind = cgmIndex >= 0 ? 'cgm' : (carbsIndex >= 0 || deliveredIndex >= 0 ? 'bolus' : null);
      if (!kind) throw new Error('Dateityp nicht erkannt.');

      const result = { kind, cgm: [], boluses: [], rejected: 0, metadataRowsDiscarded: headerRowIndex };
      for (const row of rows.slice(headerRowIndex + 1)) {
        const minute = parseDateTime(row[timeIndex]);
        if (minute === null) { result.rejected += 1; continue; }
        if (kind === 'cgm') {
          const raw = parseLocaleNumber(row[cgmIndex]);
          if (raw === 1) result.cgm.push([minute, null, -1]);
          else if (raw === 2001) result.cgm.push([minute, null, 1]);
          else if (raw !== null && raw >= 40 && raw <= 400) result.cgm.push([minute, round(raw, 1), 0]);
          else result.rejected += 1;
        } else {
          const carbs = carbsIndex >= 0 ? parseLocaleNumber(row[carbsIndex]) : null;
          const delivered = deliveredIndex >= 0 ? parseLocaleNumber(row[deliveredIndex]) : null;
          const enteredGlucose = enteredGlucoseIndex >= 0 ? parseLocaleNumber(row[enteredGlucoseIndex]) : null;
          const type = typeIndex >= 0 ? String(row[typeIndex] ?? '').trim().slice(0, 80) : '';
          if (carbs === null && delivered === null && enteredGlucose === null && !type) { result.rejected += 1; continue; }
          result.boluses.push([minute, round(carbs, 1), round(delivered, 2), round(enteredGlucose, 0), type]);
        }
      }
      return result;
    }

    function normalizeClinical(value) {
      const fallback = emptyClinical();
      if (!value || typeof value !== 'object') return fallback;
      const cgm = Array.isArray(value.cgm) ? value.cgm
        .filter((row) => Array.isArray(row) && Number.isFinite(Number(row[0])) && (row[1] === null || Number.isFinite(Number(row[1]))) && [-1, 0, 1].includes(Number(row[2])))
        .map((row) => [Number(row[0]), row[1] === null ? null : Number(row[1]), Number(row[2])]) : [];
      const boluses = Array.isArray(value.boluses) ? value.boluses
        .filter((row) => Array.isArray(row) && Number.isFinite(Number(row[0])))
        .map((row) => [Number(row[0]), finiteNumber(row[1]), finiteNumber(row[2]), finiteNumber(row[3]), String(row[4] ?? '').slice(0, 80)]) : [];
      return {
        schema: CLINICAL_KEY,
        cgm: dedupeCgm(cgm),
        boluses: dedupeBoluses(boluses),
        imports: Array.isArray(value.imports) ? value.imports.slice(-50) : [],
        updatedAt: value.updatedAt || null,
      };
    }

    function dedupeCgm(rows) {
      const map = new Map();
      for (const row of rows) map.set(Number(row[0]), [Number(row[0]), row[1] === null ? null : Number(row[1]), Number(row[2])]);
      return [...map.values()].sort((a, b) => a[0] - b[0]);
    }

    function bolusKey(row) {
      return `${Number(row[0])}|${row[1] ?? ''}|${row[2] ?? ''}|${row[3] ?? ''}|${String(row[4] ?? '')}`;
    }

    function dedupeBoluses(rows) {
      const map = new Map();
      for (const row of rows) map.set(bolusKey(row), [Number(row[0]), finiteNumber(row[1]), finiteNumber(row[2]), finiteNumber(row[3]), String(row[4] ?? '').slice(0, 80)]);
      return [...map.values()].sort((a, b) => a[0] - b[0]);
    }

    function mergeClinical(current, parsedItems) {
      const beforeCgm = current.cgm.length;
      const beforeBoluses = current.boluses.length;
      const cgm = [...current.cgm];
      const boluses = [...current.boluses];
      let rejected = 0;
      let metadataRowsDiscarded = 0;
      const kinds = [];
      for (const item of parsedItems) {
        cgm.push(...item.cgm);
        boluses.push(...item.boluses);
        rejected += item.rejected;
        metadataRowsDiscarded += item.metadataRowsDiscarded;
        kinds.push(item.kind);
      }
      const mergedCgm = dedupeCgm(cgm);
      const mergedBoluses = dedupeBoluses(boluses);
      const now = new Date().toISOString();
      const summary = {
        at: now,
        files: parsedItems.length,
        kinds,
        cgmAdded: mergedCgm.length - beforeCgm,
        bolusesAdded: mergedBoluses.length - beforeBoluses,
        rejected,
        metadataRowsDiscarded,
      };
      return {
        clinical: {
          schema: CLINICAL_KEY,
          cgm: mergedCgm,
          boluses: mergedBoluses,
          imports: [...current.imports, summary].slice(-50),
          updatedAt: now,
        },
        summary,
      };
    }

    function calculateMetrics(cgmRows) {
      if (!cgmRows.length) return null;
      const exact = cgmRows.filter((row) => row[1] !== null).map((row) => Number(row[1]));
      const classified = cgmRows.map((row) => row[2] === -1 ? 39 : row[2] === 1 ? 401 : Number(row[1]));
      const average = mean(exact);
      const sd = standardDeviation(exact);
      const percentage = (predicate) => round(classified.filter(predicate).length / classified.length * 100, 2);
      const start = cgmRows[0][0];
      const end = cgmRows[cgmRows.length - 1][0];
      const expected = Math.floor((end - start) / 5) + 1;
      return {
        samples: cgmRows.length,
        exactSamples: exact.length,
        mean: round(average, 1),
        median: round(median(exact), 1),
        sd: round(sd, 1),
        cv: average ? round(sd / average * 100, 1) : null,
        gmi: average ? round(3.31 + 0.02392 * average, 2) : null,
        veryLow: percentage((value) => value < 54),
        low: percentage((value) => value >= 54 && value < 70),
        inRange: percentage((value) => value >= 70 && value <= 180),
        high: percentage((value) => value > 180 && value <= 250),
        veryHigh: percentage((value) => value > 250),
        below70: percentage((value) => value < 70),
        above180: percentage((value) => value > 180),
        lowSentinels: cgmRows.filter((row) => row[2] === -1).length,
        highSentinels: cgmRows.filter((row) => row[2] === 1).length,
        start,
        end,
        expectedSamples: expected,
        activePercent: expected > 0 ? round(cgmRows.length / expected * 100, 2) : null,
      };
    }
