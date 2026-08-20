'use strict';

const assert = require('node:assert/strict');
const app = require('../docs/app-v3.js');
const zip = require('../docs/app-zip64-compat.js');
const { createZip64EntryArchive } = require('./zip64_fixture.cjs');

async function main() {
  const archive = createZip64EntryArchive();
  const entries = await zip.extractZip(archive);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, 'Nested export/CGM/cgm_data_1.csv');
  assert.equal(entries[0].name, 'cgm_data_1.csv');
  assert.match(new TextDecoder().decode(entries[0].bytes), /123,0/);

  const expanded = await zip.expandInputFile({
    name: 'zip64-export.zip',
    type: 'application/zip',
    arrayBuffer: async () => archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength,
    ),
  });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].path, 'Nested export/CGM/cgm_data_1.csv');

  const parsed = app.parseClinicalCsv(await expanded[0].text(), expanded[0].name);
  assert.equal(parsed.kind, 'cgm');
  assert.equal(parsed.cgm.length, 1);
  assert.equal(parsed.cgm[0][1], 123);
  assert.equal(parsed.rejected, 0);
  console.log('ZIP64 per-entry sizes and nested CSV paths verified');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
