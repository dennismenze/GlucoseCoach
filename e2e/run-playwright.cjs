'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const patch = path.resolve(__dirname, 'oracle-two-hour-patch.cjs');
const preload = `--require=${patch}`;
const existing = String(process.env.NODE_OPTIONS || '').trim();
const nodeOptions = existing.includes(preload)
  ? existing
  : [existing, preload].filter(Boolean).join(' ');
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  command,
  ['playwright', 'test', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
