(function (root) {
  'use strict';

  const base = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('./app-zip-core.js')
    : root?.GlucoseCoachZipExchange;
  if (!base) return;

  const DEFAULT_MAX_ENTRIES = 200;
  const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
  const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
  const ENCRYPTED_FLAG = 0x0001;
  const STORE_METHOD = 0;
  const DEFLATE_METHOD = 8;
  const ZIP64_EXTRA_ID = 0x0001;
  const UINT32_SENTINEL = 0xFFFFFFFF;
  const UINT16_SENTINEL = 0xFFFF;
  const UINT32_FACTOR = 0x1_0000_0000;

  function asUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError('Binärdaten werden als ArrayBuffer oder Uint8Array erwartet.');
  }

  function getUint16(bytes, offset, end = bytes.length) {
    if (offset < 0 || offset + 2 > end || end > bytes.length) {
      throw new Error('Beschädigtes ZIP: unerwartetes Dateiende.');
    }
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
  }

  function getUint32(bytes, offset, end = bytes.length) {
    if (offset < 0 || offset + 4 > end || end > bytes.length) {
      throw new Error('Beschädigtes ZIP: unerwartetes Dateiende.');
    }
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
  }

  function getUint64(bytes, offset, end = bytes.length) {
    if (offset < 0 || offset + 8 > end || end > bytes.length) {
      throw new Error('Beschädigtes ZIP: ZIP64-Wert ist abgeschnitten.');
    }
    const low = getUint32(bytes, offset, end);
    const high = getUint32(bytes, offset + 4, end);
    const value = high * UINT32_FACTOR + low;
    if (!Number.isSafeInteger(value)) {
      throw new Error('ZIP64-Wert überschreitet den sicher verarbeitbaren Zahlenbereich.');
    }
    return value;
  }

  function findEndOfCentralDirectory(bytes) {
    if (bytes.length < 22) throw new Error('Die Datei ist kein unterstütztes ZIP-Archiv.');
    const minimum = Math.max(0, bytes.length - 65_557);
    for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
      if (getUint32(bytes, offset) === 0x06054B50) return offset;
    }
    throw new Error('Die Datei ist kein unterstütztes ZIP-Archiv.');
  }

  function normalizeZipPath(value) {
    const source = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!source || source.includes('\u0000')) throw new Error('Ungültiger Dateiname im ZIP.');
    const parts = source.split('/').filter(Boolean);
    if (parts.some((part) => part === '..')) throw new Error('Unsicherer Dateipfad im ZIP.');
    return parts.join('/');
  }

  function basename(value) {
    return typeof base.basename === 'function'
      ? base.basename(value)
      : String(value ?? '').replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || '';
  }

  function resolveZip64Entry(bytes, extraOffset, extraLength, raw, path) {
    const needs = {
      uncompressedSize: raw.uncompressedSize === UINT32_SENTINEL,
      compressedSize: raw.compressedSize === UINT32_SENTINEL,
      localOffset: raw.localOffset === UINT32_SENTINEL,
      startDisk: raw.startDisk === UINT16_SENTINEL,
    };
    if (!Object.values(needs).some(Boolean)) return raw;

    const extraEnd = extraOffset + extraLength;
    if (extraOffset < 0 || extraEnd > bytes.length) {
      throw new Error(`Beschädigtes ZIP: Zusatzdaten fehlen für ${path}.`);
    }

    let cursor = extraOffset;
    while (cursor + 4 <= extraEnd) {
      const headerId = getUint16(bytes, cursor, extraEnd);
      const dataLength = getUint16(bytes, cursor + 2, extraEnd);
      const dataStart = cursor + 4;
      const dataEnd = dataStart + dataLength;
      if (dataEnd > extraEnd) {
        throw new Error(`Beschädigtes ZIP: Zusatzfeld ist abgeschnitten für ${path}.`);
      }

      if (headerId === ZIP64_EXTRA_ID) {
        const resolved = { ...raw };
        let valueOffset = dataStart;
        const read64 = (field) => {
          if (!needs[field]) return;
          resolved[field] = getUint64(bytes, valueOffset, dataEnd);
          valueOffset += 8;
        };
        read64('uncompressedSize');
        read64('compressedSize');
        read64('localOffset');
        if (needs.startDisk) {
          resolved.startDisk = getUint32(bytes, valueOffset, dataEnd);
          valueOffset += 4;
        }
        return resolved;
      }
      cursor = dataEnd;
    }

    throw new Error(`ZIP64-Größenangaben fehlen für ${path}.`);
  }

  async function inflateRaw(bytes) {
    if (
      typeof root?.DecompressionStream === 'function'
      && typeof Blob === 'function'
      && typeof Response === 'function'
    ) {
      try {
        const transformed = new Blob([bytes])
          .stream()
          .pipeThrough(new root.DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(transformed).arrayBuffer());
      } catch {
        // Fall back to Node's zlib below.
      }
    }
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      const zlib = require('node:zlib');
      return new Uint8Array(zlib.inflateRawSync(Buffer.from(bytes)));
    }
    throw new Error('Dieses Gerät kann komprimierte ZIP-Einträge nicht entpacken.');
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
    if (entryCount === UINT16_SENTINEL || centralSize === UINT32_SENTINEL || centralOffset === UINT32_SENTINEL) {
      throw new Error('ZIP64-Gesamtarchive werden nicht unterstützt.');
    }
    if (entryCount > maxEntries) throw new Error(`ZIP enthält mehr als ${maxEntries} Einträge.`);
    if (centralOffset + centralSize > endOffset || centralOffset + centralSize > bytes.length) {
      throw new Error('Beschädigtes ZIP: ungültiges Inhaltsverzeichnis.');
    }

    const decoder = new TextDecoder('utf-8');
    const result = [];
    const centralEnd = centralOffset + centralSize;
    let cursor = centralOffset;
    let totalBytes = 0;

    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > centralEnd || getUint32(bytes, cursor, centralEnd) !== 0x02014B50) {
        throw new Error('Beschädigtes ZIP: zentraler Dateieintrag fehlt.');
      }
      const flags = getUint16(bytes, cursor + 8, centralEnd);
      const method = getUint16(bytes, cursor + 10, centralEnd);
      const expectedCrc = getUint32(bytes, cursor + 16, centralEnd);
      const rawCompressedSize = getUint32(bytes, cursor + 20, centralEnd);
      const rawUncompressedSize = getUint32(bytes, cursor + 24, centralEnd);
      const nameLength = getUint16(bytes, cursor + 28, centralEnd);
      const extraLength = getUint16(bytes, cursor + 30, centralEnd);
      const commentLength = getUint16(bytes, cursor + 32, centralEnd);
      const rawStartDisk = getUint16(bytes, cursor + 34, centralEnd);
      const rawLocalOffset = getUint32(bytes, cursor + 42, centralEnd);
      const nameOffset = cursor + 46;
      const extraOffset = nameOffset + nameLength;
      const nextCursor = extraOffset + extraLength + commentLength;
      if (nextCursor > centralEnd) throw new Error('Beschädigtes ZIP: Dateiname ist abgeschnitten.');

      const rawPath = decoder.decode(bytes.subarray(nameOffset, extraOffset));
      const isDirectory = /[\\/]$/.test(rawPath);
      const path = normalizeZipPath(rawPath);
      const resolved = resolveZip64Entry(bytes, extraOffset, extraLength, {
        compressedSize: rawCompressedSize,
        uncompressedSize: rawUncompressedSize,
        localOffset: rawLocalOffset,
        startDisk: rawStartDisk,
      }, path);
      cursor = nextCursor;

      if (resolved.startDisk !== 0) throw new Error('Mehrteilige ZIP-Archive werden nicht unterstützt.');
      if (flags & ENCRYPTED_FLAG) throw new Error(`Verschlüsselter ZIP-Eintrag wird nicht unterstützt: ${path}`);
      if (![STORE_METHOD, DEFLATE_METHOD].includes(method)) {
        throw new Error(`Nicht unterstützte ZIP-Kompression in ${path}.`);
      }
      if (resolved.uncompressedSize > maxFileBytes) {
        throw new Error(`ZIP-Eintrag ist größer als ${Math.floor(maxFileBytes / 1024 / 1024)} MB: ${path}`);
      }
      totalBytes += resolved.uncompressedSize;
      if (totalBytes > maxTotalBytes) {
        throw new Error(`Entpackte ZIP-Daten überschreiten ${Math.floor(maxTotalBytes / 1024 / 1024)} MB.`);
      }

      if (resolved.localOffset + 30 > bytes.length || getUint32(bytes, resolved.localOffset) !== 0x04034B50) {
        throw new Error(`Beschädigtes ZIP: lokaler Dateikopf fehlt für ${path}.`);
      }
      const localNameLength = getUint16(bytes, resolved.localOffset + 26);
      const localExtraLength = getUint16(bytes, resolved.localOffset + 28);
      const dataStart = resolved.localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + resolved.compressedSize;
      if (dataStart < 0 || dataEnd > bytes.length) {
        throw new Error(`Beschädigtes ZIP: Dateidaten fehlen für ${path}.`);
      }

      const compressed = bytes.subarray(dataStart, dataEnd);
      const content = method === STORE_METHOD
        ? new Uint8Array(compressed)
        : await inflateRaw(compressed);
      if (content.length !== resolved.uncompressedSize) {
        throw new Error(`Beschädigtes ZIP: falsche Dateigröße für ${path}.`);
      }
      if (typeof base.crc32 !== 'function' || base.crc32(content) !== expectedCrc) {
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

  const api = {
    ...base,
    extractZip,
    expandInputFile,
    expandInputFiles,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachZipExchange = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
