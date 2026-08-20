(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const ZIP_EXCHANGE_SCHEMA = 'glucosecoach-omnipod-zip-v1';
  const COMPANION_FILENAME = 'glucosecoach_data_1.csv';
  const DEFAULT_MAX_ENTRIES = 200;
  const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
  const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

  const UTF8_FLAG = 0x0800;
  const ENCRYPTED_FLAG = 0x0001;
  const STORE_METHOD = 0;
  const DEFLATE_METHOD = 8;

  const IMPORT_FILE_DEFINITIONS = Object.freeze([
    Object.freeze({
      key: 'cgm',
      filename: 'cgm_data_1.csv',
      headers: Object.freeze(['Zeitstempel', 'CGM-Glukosewert (mg/dl)']),
      rows(clinical) {
        return safeArray(clinical.cgm).map((row) => [
          localTimestamp(row[0]),
          Number(row[2]) === -1 ? '1' : Number(row[2]) === 1 ? '2001' : numberText(row[1], 1),
        ]);
      },
    }),
    Object.freeze({
      key: 'boluses',
      filename: 'bolus_data_1.csv',
      headers: Object.freeze([
        'Zeitstempel',
        'Insulin-Typ',
        'Blutzuckereingabe (mg/dl)',
        'Kohlenhydrataufnahme (g)',
        'Kohlenhydratverhältnis',
        'Abgegebenes Insulin (E)',
        'Anfängliche Abgabe (E)',
        'Verzögerte Abgabe (E)',
      ]),
      rows(clinical) {
        return safeArray(clinical.boluses).map((row) => [
          localTimestamp(row[0]),
          scalarText(row[4]),
          numberText(row[3], 1),
          numberText(row[1], 1),
          '',
          numberText(row[2], 2),
          numberText(row[2], 2),
          '',
        ]);
      },
    }),
    Object.freeze({
      key: 'dailyInsulin',
      filename: 'insulin_data_1.csv',
      headers: Object.freeze([
        'Zeitstempel',
        'Bolus gesamt (U)',
        'Insulin gesamt (U)',
        'Basal gesamt (U)',
      ]),
      rows(clinical) {
        return safeArray(clinical.dailyInsulin).map((row) => [
          localTimestamp(row[0]),
          numberText(row[1], 2),
          numberText(row[2], 2),
          numberText(row[3], 2),
        ]);
      },
    }),
    Object.freeze({
      key: 'basalEvents',
      filename: 'basal_data_1.csv',
      headers: Object.freeze([
        'Zeitstempel',
        'Insulin-Typ',
        'Dauer (Minuten)',
        'Prozentsatz (%)',
        'Rate',
        'Abgegebenes Insulin (E)',
      ]),
      rows(clinical) {
        return safeArray(clinical.basalEvents).map((row) => [
          localTimestamp(row[0]),
          scalarText(row[1]),
          numberText(row[2], 0),
          numberText(row[3], 1),
          numberText(row[4], 3),
          numberText(row[5], 2),
        ]);
      },
    }),
    Object.freeze({
      key: 'manualGlucose',
      filename: 'bg_data_1.csv',
      headers: Object.freeze(['Zeitstempel', 'Glukosewert (mg/dl)', 'Manuelles Lesen']),
      rows(clinical) {
        return safeArray(clinical.manualGlucose).map((row) => [
          localTimestamp(row[0]),
          numberText(row[1], 1),
          scalarText(row[2]),
        ]);
      },
    }),
    Object.freeze({
      key: 'alarms',
      filename: 'alarms_data_1.csv',
      headers: Object.freeze(['Zeitstempel', 'Alarm/Ereignis']),
      rows(clinical) {
        return safeArray(clinical.alarms).map((row) => [
          localTimestamp(row[0]),
          scalarText(row[1]),
        ]);
      },
    }),
    Object.freeze({
      key: 'cgmCarbs',
      filename: 'cgm_carbs_data_1.csv',
      headers: Object.freeze(['Zeitstempel', 'KH (g)']),
      rows(clinical) {
        return safeArray(clinical.cgmCarbs).map((row) => [
          localTimestamp(row[0]),
          numberText(row[1], 1),
        ]);
      },
    }),
    Object.freeze({
      key: 'exerciseEvents',
      filename: 'exercise_data_1.csv',
      headers: Object.freeze([
        'Zeitstempel',
        'Name',
        'Intensität',
        'Dauer (Minuten)',
        'Verbrannte Kalorien',
      ]),
      rows(clinical) {
        return safeArray(clinical.exerciseEvents).map((row) => [
          localTimestamp(row[0]),
          scalarText(row[1]),
          scalarText(row[2]),
          numberText(row[3], 0),
          numberText(row[4], 1),
        ]);
      },
    }),
    Object.freeze({
      key: 'foodEvents',
      filename: 'food_data_1.csv',
      headers: Object.freeze([
        'Zeitstempel',
        'Name',
        'KH (g)',
        'Fett',
        'Eiweiß',
        'Kalorien',
        'Portionen',
        'Anzahl der Portionen',
      ]),
      rows(clinical) {
        return safeArray(clinical.foodEvents).map((row) => [
          localTimestamp(row[0]),
          scalarText(row[1]),
          numberText(row[2], 1),
          numberText(row[3], 1),
          numberText(row[4], 1),
          numberText(row[5], 1),
          scalarText(row[6]),
          numberText(row[7], 2),
        ]);
      },
    }),
    Object.freeze({
      key: 'manualInsulin',
      filename: 'manual_insulin_data_1.csv',
      headers: Object.freeze(['Zeitstempel', 'Name', 'Wert', 'Insulin-Typ']),
      rows(clinical) {
        return safeArray(clinical.manualInsulin).map((row) => [
          localTimestamp(row[0]),
          scalarText(row[1]),
          numberText(row[2], 2),
          scalarText(row[3]),
        ]);
      },
    }),
    Object.freeze({
      key: 'medications',
      filename: 'medication_data_1.csv',
      headers: Object.freeze(['Zeitstempel', 'Name', 'Wert', 'Medikamententyp']),
      rows(clinical) {
        return safeArray(clinical.medications).map((row) => [
          localTimestamp(row[0]),
          scalarText(row[1]),
          scalarText(row[2]),
          scalarText(row[3]),
        ]);
      },
    }),
    Object.freeze({
      key: 'notes',
      filename: 'notes_data_1.csv',
      headers: Object.freeze(['Zeitstempel', 'Wert']),
      rows(clinical) {
        return safeArray(clinical.notes).map((row) => [
          localTimestamp(row[0]),
          scalarText(row[1]),
        ]);
      },
    }),
  ]);

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function scalarText(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function numberText(value, digits) {
    if (value === null || value === undefined || value === '') return '';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '';
    return numeric.toFixed(digits).replace('.', ',');
  }

  function localTimestamp(minute) {
    const numeric = Number(minute);
    if (!Number.isFinite(numeric)) return '';
    const date = new Date(numeric * MINUTE_MS);
    if (Number.isNaN(date.getTime())) return '';
    const part = (value) => String(value).padStart(2, '0');
    return `${part(date.getDate())}.${part(date.getMonth() + 1)}.${date.getFullYear()} ${part(date.getHours())}:${part(date.getMinutes())}`;
  }

  function protectCsvText(value) {
    let source = scalarText(value);
    if (/^[=+\-@\t\r]/.test(source)) source = `'${source}`;
    return source;
  }

  function quoteCsv(value) {
    return `"${protectCsvText(value).replace(/"/g, '""')}"`;
  }

  function buildImportCompatibleCsv(definition, clinical = {}) {
    const metadata = [
      quoteCsv('GlucoseCoach-Export'),
      quoteCsv(ZIP_EXCHANGE_SCHEMA),
    ].join(',');
    const header = definition.headers.map(quoteCsv).join(',');
    const body = definition.rows(clinical).map((row) => row.map(quoteCsv).join(','));
    return `\uFEFF${[metadata, header, ...body].join('\r\n')}`;
  }

  function completeCsvScalar(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value).replace('.', ',') : '';
    }
    if (typeof value === 'object') {
      throw new TypeError('Die GlucoseCoach-Begleit-CSV akzeptiert nur skalare Feldwerte.');
    }
    return String(value);
  }

  function quoteCompleteCsv(value) {
    return `"${protectCsvText(completeCsvScalar(value)).replace(/"/g, '""')}"`;
  }

  function buildCompanionCsv(payload = {}, exportApi = root?.GlucoseCoachExport) {
    if (
      !exportApi ||
      typeof exportApi.buildCompleteExportRows !== 'function' ||
      !Array.isArray(exportApi.EXPORT_COLUMNS)
    ) {
      throw new Error('Der vollständige CSV-Kern ist nicht geladen.');
    }

    const rows = exportApi.buildCompleteExportRows(payload)
      .filter((row) => !['Klinische Daten', 'Kontextdaten'].includes(row.section))
      .map((row) => ({ ...row }));
    const exportRow = rows.find(
      (row) => row.section === 'Metadaten' && row.dataType === 'Export',
    );
    if (exportRow) {
      exportRow.status = 'ZIP-Begleitdatei ohne klinische Datenduplikate';
    }

    const header = exportApi.EXPORT_COLUMNS.map(([, label]) => quoteCompleteCsv(label)).join(';');
    const body = rows.map((row) =>
      exportApi.EXPORT_COLUMNS.map(([key]) => quoteCompleteCsv(row[key])).join(';'),
    );
    return `\uFEFF${[header, ...body].join('\r\n')}`;
  }

  function buildExchangeFiles(payload = {}, exportApi = root?.GlucoseCoachExport) {
    const clinical = payload.clinical && typeof payload.clinical === 'object'
      ? payload.clinical
      : {};
    return [
      ...IMPORT_FILE_DEFINITIONS.map((definition) => ({
        name: definition.filename,
        text: buildImportCompatibleCsv(definition, clinical),
      })),
      {
        name: COMPANION_FILENAME,
        text: buildCompanionCsv(payload, exportApi),
      },
    ];
  }

  function isGeneratedClinicalCsv(source) {
    const firstLine = String(source ?? '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
    return firstLine.includes(ZIP_EXCHANGE_SCHEMA);
  }

  function unprotectGeneratedCsv(source) {
    const text = String(source ?? '');
    if (!isGeneratedClinicalCsv(text)) return text;
    return text.replace(/(^|,)"'([=+\-@\t\r])/gm, '$1"$2');
  }

  function isCompleteCsvSource(source) {
    return String(source ?? '')
      .replace(/^\uFEFF/, '')
      .startsWith('"Bereich";"Datentyp";"Zeitstempel_ISO";');
  }

  function normalizeZipPath(value) {
    const source = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!source || source.includes('\u0000')) throw new Error('Ungültiger Dateiname im ZIP.');
    const parts = source.split('/').filter(Boolean);
    if (parts.some((part) => part === '..')) throw new Error('Unsicherer Dateipfad im ZIP.');
    return parts.join('/');
  }

  function basename(value) {
    const normalized = String(value ?? '').replace(/\\/g, '/');
    return normalized.split('/').filter(Boolean).at(-1) || '';
  }

  function asUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError('Binärdaten werden als ArrayBuffer oder Uint8Array erwartet.');
  }

  function concatBytes(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(value) {
    const bytes = asUint8Array(value);
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function setUint16(bytes, offset, value) {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      .setUint16(offset, value & 0xFFFF, true);
  }

  function setUint32(bytes, offset, value) {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      .setUint32(offset, value >>> 0, true);
  }

  function getUint16(bytes, offset) {
    if (offset < 0 || offset + 2 > bytes.length) throw new Error('Beschädigtes ZIP: unerwartetes Dateiende.');
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
  }

  function getUint32(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) throw new Error('Beschädigtes ZIP: unerwartetes Dateiende.');
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
  }

  function dosDateTime(value = new Date()) {
    const source = value instanceof Date ? value : new Date(value);
    const date = Number.isNaN(source.getTime()) ? new Date() : source;
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    return {
      time: ((date.getHours() & 0x1F) << 11)
        | ((date.getMinutes() & 0x3F) << 5)
        | (Math.floor(date.getSeconds() / 2) & 0x1F),
      date: (((year - 1980) & 0x7F) << 9)
        | (((date.getMonth() + 1) & 0x0F) << 5)
        | (date.getDate() & 0x1F),
    };
  }

  async function streamTransform(bytes, constructorName, format) {
    const Constructor = root?.[constructorName];
    if (typeof Constructor !== 'function' || typeof Blob !== 'function' || typeof Response !== 'function') {
      return null;
    }
    try {
      const transformed = new Blob([bytes]).stream().pipeThrough(new Constructor(format));
      return new Uint8Array(await new Response(transformed).arrayBuffer());
    } catch {
      return null;
    }
  }

  function nodeZlib() {
    if (typeof module === 'undefined' || !module.exports || typeof require !== 'function') return null;
    try {
      return require('node:zlib');
    } catch {
      return null;
    }
  }

  async function deflateRaw(bytes) {
    const streamed = await streamTransform(bytes, 'CompressionStream', 'deflate-raw');
    if (streamed) return streamed;
    const zlib = nodeZlib();
    if (!zlib) return null;
    return new Uint8Array(zlib.deflateRawSync(Buffer.from(bytes)));
  }

  async function inflateRaw(bytes) {
    const streamed = await streamTransform(bytes, 'DecompressionStream', 'deflate-raw');
    if (streamed) return streamed;
    const zlib = nodeZlib();
    if (!zlib) {
      throw new Error('Dieses Gerät kann komprimierte ZIP-Einträge nicht entpacken.');
    }
    return new Uint8Array(zlib.inflateRawSync(Buffer.from(bytes)));
  }

  async function fileBytes(file) {
    if (file.bytes !== undefined) return asUint8Array(file.bytes);
    if (file.text !== undefined) return new TextEncoder().encode(String(file.text));
    if (file.content !== undefined) {
      return typeof file.content === 'string'
        ? new TextEncoder().encode(file.content)
        : asUint8Array(file.content);
    }
    throw new Error(`ZIP-Datei ${file.name || '(ohne Namen)'} enthält keinen Inhalt.`);
  }

  async function createZip(files, options = {}) {
    const items = safeArray(files);
    if (!items.length) throw new Error('Für den ZIP-Export wurden keine Dateien erzeugt.');
    if (items.length > 0xFFFF) throw new Error('Zu viele Dateien für ein Standard-ZIP.');

    const timestamp = dosDateTime(options.date || new Date());
    const localChunks = [];
    const centralChunks = [];
    const seen = new Set();
    let localOffset = 0;

    for (const file of items) {
      const name = normalizeZipPath(file.name);
      if (seen.has(name)) throw new Error(`Doppelter Dateiname im ZIP: ${name}`);
      seen.add(name);
      const nameBytes = new TextEncoder().encode(name);
      if (nameBytes.length > 0xFFFF) throw new Error(`ZIP-Dateiname ist zu lang: ${name}`);

      const original = await fileBytes(file);
      if (original.length > 0xFFFFFFFF) throw new Error(`Datei ist zu groß für Standard-ZIP: ${name}`);
      let method = STORE_METHOD;
      let compressed = original;
      if (options.compress !== false && original.length >= 128) {
        const candidate = await deflateRaw(original);
        if (candidate && candidate.length < original.length) {
          method = DEFLATE_METHOD;
          compressed = candidate;
        }
      }
      if (compressed.length > 0xFFFFFFFF) throw new Error(`Komprimierte Datei ist zu groß: ${name}`);
      if (localOffset > 0xFFFFFFFF) throw new Error('ZIP ist zu groß für das Standardformat.');

      const crc = crc32(original);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      setUint32(localHeader, 0, 0x04034B50);
      setUint16(localHeader, 4, 20);
      setUint16(localHeader, 6, UTF8_FLAG);
      setUint16(localHeader, 8, method);
      setUint16(localHeader, 10, timestamp.time);
      setUint16(localHeader, 12, timestamp.date);
      setUint32(localHeader, 14, crc);
      setUint32(localHeader, 18, compressed.length);
      setUint32(localHeader, 22, original.length);
      setUint16(localHeader, 26, nameBytes.length);
      setUint16(localHeader, 28, 0);
      localHeader.set(nameBytes, 30);
      localChunks.push(localHeader, compressed);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      setUint32(centralHeader, 0, 0x02014B50);
      setUint16(centralHeader, 4, 20);
      setUint16(centralHeader, 6, 20);
      setUint16(centralHeader, 8, UTF8_FLAG);
      setUint16(centralHeader, 10, method);
      setUint16(centralHeader, 12, timestamp.time);
      setUint16(centralHeader, 14, timestamp.date);
      setUint32(centralHeader, 16, crc);
      setUint32(centralHeader, 20, compressed.length);
      setUint32(centralHeader, 24, original.length);
      setUint16(centralHeader, 28, nameBytes.length);
      setUint16(centralHeader, 30, 0);
      setUint16(centralHeader, 32, 0);
      setUint16(centralHeader, 34, 0);
      setUint16(centralHeader, 36, 0);
      setUint32(centralHeader, 38, 0);
      setUint32(centralHeader, 42, localOffset);
      centralHeader.set(nameBytes, 46);
      centralChunks.push(centralHeader);

      localOffset += localHeader.length + compressed.length;
    }

    const centralDirectory = concatBytes(centralChunks);
    if (localOffset + centralDirectory.length > 0xFFFFFFFF) {
      throw new Error('ZIP ist zu groß für das Standardformat.');
    }
    const end = new Uint8Array(22);
    setUint32(end, 0, 0x06054B50);
    setUint16(end, 4, 0);
    setUint16(end, 6, 0);
    setUint16(end, 8, items.length);
    setUint16(end, 10, items.length);
    setUint32(end, 12, centralDirectory.length);
    setUint32(end, 16, localOffset);
    setUint16(end, 20, 0);
    return concatBytes([...localChunks, centralDirectory, end]);
  }

  function findEndOfCentralDirectory(bytes) {
    if (bytes.length < 22) throw new Error('Die Datei ist kein unterstütztes ZIP-Archiv.');
    const minimum = Math.max(0, bytes.length - 65_557);
    for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
      if (getUint32(bytes, offset) === 0x06054B50) return offset;
    }
    throw new Error('Die Datei ist kein unterstütztes ZIP-Archiv.');
  }

  async function extractZip(value, options = {}) {
    const bytes = asUint8Array(value);
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    const endOffset = findEndOfCentralDirectory(bytes);
    const diskNumber = getUint16(bytes, endOffset + 4);
    const centralDisk = getUint16(bytes, endOffset + 6);
    const entriesOnDisk = getUint16(bytes, endOffset + 8);
    const entryCount = getUint16(bytes, endOffset + 10);
    const centralSize = getUint32(bytes, endOffset + 12);
    const centralOffset = getUint32(bytes, endOffset + 16);

    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
      throw new Error('Mehrteilige ZIP-Archive werden nicht unterstützt.');
    }
    if (entryCount === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) {
      throw new Error('ZIP64-Archive werden nicht unterstützt.');
    }
    if (entryCount > maxEntries) throw new Error(`ZIP enthält mehr als ${maxEntries} Einträge.`);
    if (centralOffset + centralSize > endOffset || centralOffset + centralSize > bytes.length) {
      throw new Error('Beschädigtes ZIP: ungültiges Inhaltsverzeichnis.');
    }

    const decoder = new TextDecoder('utf-8');
    const result = [];
    let cursor = centralOffset;
    let totalBytes = 0;

    for (let index = 0; index < entryCount; index += 1) {
      if (getUint32(bytes, cursor) !== 0x02014B50) {
        throw new Error('Beschädigtes ZIP: zentraler Dateieintrag fehlt.');
      }
      const flags = getUint16(bytes, cursor + 8);
      const method = getUint16(bytes, cursor + 10);
      const expectedCrc = getUint32(bytes, cursor + 16);
      const compressedSize = getUint32(bytes, cursor + 20);
      const uncompressedSize = getUint32(bytes, cursor + 24);
      const nameLength = getUint16(bytes, cursor + 28);
      const extraLength = getUint16(bytes, cursor + 30);
      const commentLength = getUint16(bytes, cursor + 32);
      const startDisk = getUint16(bytes, cursor + 34);
      const localOffset = getUint32(bytes, cursor + 42);
      const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;
      if (nextCursor > bytes.length) throw new Error('Beschädigtes ZIP: Dateiname ist abgeschnitten.');
      const rawPath = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      const isDirectory = /[\\/]$/.test(rawPath);
      const path = normalizeZipPath(rawPath);
      cursor = nextCursor;

      if (startDisk !== 0) throw new Error('Mehrteilige ZIP-Archive werden nicht unterstützt.');
      if (flags & ENCRYPTED_FLAG) throw new Error(`Verschlüsselter ZIP-Eintrag wird nicht unterstützt: ${path}`);
      if (![STORE_METHOD, DEFLATE_METHOD].includes(method)) {
        throw new Error(`Nicht unterstützte ZIP-Kompression in ${path}.`);
      }
      if (uncompressedSize > maxFileBytes) {
        throw new Error(`ZIP-Eintrag ist größer als ${Math.floor(maxFileBytes / 1024 / 1024)} MB: ${path}`);
      }
      totalBytes += uncompressedSize;
      if (totalBytes > maxTotalBytes) {
        throw new Error(`Entpackte ZIP-Daten überschreiten ${Math.floor(maxTotalBytes / 1024 / 1024)} MB.`);
      }

      if (getUint32(bytes, localOffset) !== 0x04034B50) {
        throw new Error(`Beschädigtes ZIP: lokaler Dateikopf fehlt für ${path}.`);
      }
      const localNameLength = getUint16(bytes, localOffset + 26);
      const localExtraLength = getUint16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataStart < 0 || dataEnd > bytes.length) {
        throw new Error(`Beschädigtes ZIP: Dateidaten fehlen für ${path}.`);
      }

      const compressed = bytes.subarray(dataStart, dataEnd);
      const content = method === STORE_METHOD
        ? new Uint8Array(compressed)
        : await inflateRaw(compressed);
      if (content.length !== uncompressedSize) {
        throw new Error(`Beschädigtes ZIP: falsche Dateigröße für ${path}.`);
      }
      if (crc32(content) !== expectedCrc) {
        throw new Error(`Beschädigtes ZIP: Prüfsumme stimmt nicht für ${path}.`);
      }

      if (isDirectory || path.split('/').includes('__MACOSX')) continue;
      result.push({ path, name: basename(path), bytes: content });
    }

    return result;
  }

  function looksLikeZip(file) {
    const name = String(file?.name || '').toLocaleLowerCase('de-DE');
    const type = String(file?.type || '').toLocaleLowerCase('de-DE');
    return name.endsWith('.zip') || type.includes('zip');
  }

  function looksLikeCsv(file) {
    const name = String(file?.name || '').toLocaleLowerCase('de-DE');
    const type = String(file?.type || '').toLocaleLowerCase('de-DE');
    return name.endsWith('.csv') || type.includes('csv');
  }

  async function expandInputFile(file, options = {}) {
    if (!file) return [];
    if (looksLikeZip(file)) {
      if (typeof file.arrayBuffer !== 'function') throw new Error('ZIP-Datei kann nicht gelesen werden.');
      const entries = await extractZip(await file.arrayBuffer(), options);
      const csvEntries = entries.filter((entry) => entry.name.toLocaleLowerCase('de-DE').endsWith('.csv'));
      if (!csvEntries.length) throw new Error(`${file.name || 'ZIP'} enthält keine CSV-Dateien.`);
      return csvEntries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        sourceName: file.name || 'ZIP',
        text: () => Promise.resolve(new TextDecoder('utf-8').decode(entry.bytes)),
      }));
    }
    if (looksLikeCsv(file)) {
      if (typeof file.text !== 'function') throw new Error('CSV-Datei kann nicht gelesen werden.');
      return [{
        name: basename(file.name || 'daten.csv'),
        path: file.name || 'daten.csv',
        sourceName: file.name || 'CSV',
        text: () => file.text(),
      }];
    }
    throw new Error(`Nur CSV- und ZIP-Dateien werden unterstützt: ${file.name || 'unbekannte Datei'}.`);
  }

  async function expandInputFiles(files, options = {}) {
    const expanded = [];
    for (const file of Array.from(files || [])) {
      expanded.push(...await expandInputFile(file, options));
    }
    return expanded;
  }

  async function buildExchangeZip(payload = {}, exportApi = root?.GlucoseCoachExport, options = {}) {
    const files = buildExchangeFiles(payload, exportApi);
    return createZip(files, options);
  }

  const api = {
    ZIP_EXCHANGE_SCHEMA,
    COMPANION_FILENAME,
    IMPORT_FILE_DEFINITIONS,
    buildImportCompatibleCsv,
    buildCompanionCsv,
    buildExchangeFiles,
    buildExchangeZip,
    createZip,
    extractZip,
    expandInputFile,
    expandInputFiles,
    unprotectGeneratedCsv,
    isGeneratedClinicalCsv,
    isCompleteCsvSource,
    basename,
    crc32,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachZipExchange = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
