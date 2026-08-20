'use strict';

const zlib = require('node:zlib');

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

function crc32(bytes) {
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

function setUint64(bytes, offset, value) {
  const numeric = Number(value);
  const low = numeric >>> 0;
  const high = Math.floor(numeric / 0x1_0000_0000);
  setUint32(bytes, offset, low);
  setUint32(bytes, offset + 4, high);
}

function concat(chunks) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function zip64Extra(uncompressedSize, compressedSize) {
  const extra = new Uint8Array(20);
  setUint16(extra, 0, 0x0001);
  setUint16(extra, 2, 16);
  setUint64(extra, 4, uncompressedSize);
  setUint64(extra, 12, compressedSize);
  return extra;
}

function createZip64EntryArchive({
  path = 'Nested export/CGM/cgm_data_1.csv',
  text = [
    'Name:Testperson,Datumsbereich:20.08.2026 - 20.08.2026',
    'Zeitstempel,CGM-Glukosewert (mg/dl)',
    '20.08.2026 08:00,"123,0"',
  ].join('\n'),
} = {}) {
  const name = new TextEncoder().encode(path);
  const original = new TextEncoder().encode(text);
  const compressed = new Uint8Array(zlib.deflateRawSync(Buffer.from(original)));
  const extra = zip64Extra(original.length, compressed.length);
  const checksum = crc32(original);

  const localHeader = new Uint8Array(30 + name.length + extra.length);
  setUint32(localHeader, 0, 0x04034B50);
  setUint16(localHeader, 4, 45);
  setUint16(localHeader, 6, 0);
  setUint16(localHeader, 8, 8);
  setUint16(localHeader, 10, 0);
  setUint16(localHeader, 12, 0);
  setUint32(localHeader, 14, checksum);
  setUint32(localHeader, 18, 0xFFFFFFFF);
  setUint32(localHeader, 22, 0xFFFFFFFF);
  setUint16(localHeader, 26, name.length);
  setUint16(localHeader, 28, extra.length);
  localHeader.set(name, 30);
  localHeader.set(extra, 30 + name.length);

  const centralOffset = localHeader.length + compressed.length;
  const centralHeader = new Uint8Array(46 + name.length + extra.length);
  setUint32(centralHeader, 0, 0x02014B50);
  setUint16(centralHeader, 4, 0x0334);
  setUint16(centralHeader, 6, 45);
  setUint16(centralHeader, 8, 0);
  setUint16(centralHeader, 10, 8);
  setUint16(centralHeader, 12, 0);
  setUint16(centralHeader, 14, 0);
  setUint32(centralHeader, 16, checksum);
  setUint32(centralHeader, 20, 0xFFFFFFFF);
  setUint32(centralHeader, 24, 0xFFFFFFFF);
  setUint16(centralHeader, 28, name.length);
  setUint16(centralHeader, 30, extra.length);
  setUint16(centralHeader, 32, 0);
  setUint16(centralHeader, 34, 0);
  setUint16(centralHeader, 36, 1);
  setUint32(centralHeader, 38, 0x81A40000);
  setUint32(centralHeader, 42, 0);
  centralHeader.set(name, 46);
  centralHeader.set(extra, 46 + name.length);

  const end = new Uint8Array(22);
  setUint32(end, 0, 0x06054B50);
  setUint16(end, 4, 0);
  setUint16(end, 6, 0);
  setUint16(end, 8, 1);
  setUint16(end, 10, 1);
  setUint32(end, 12, centralHeader.length);
  setUint32(end, 16, centralOffset);
  setUint16(end, 20, 0);

  return concat([localHeader, compressed, centralHeader, end]);
}

module.exports = { createZip64EntryArchive };
