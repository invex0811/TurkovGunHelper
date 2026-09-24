import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MATERIAL_SYMBOL_NAMES } from '../../src/ui/materialSymbolNames.js';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return /\.(jsx?|mjs)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

// Collects literal names passed to MaterialSymbol: name="x", name={a ? 'x' : 'y'}
// and createElement(MaterialSymbol, { name: 'x' }).
function collectIconNames(source) {
  const names = new Set();
  for (const [, name] of source.matchAll(/\bname="([a-z0-9_]+)"/g)) names.add(name);
  for (const [, expression] of source.matchAll(/\bname=\{([^}]*)\}/g)) {
    // Only ternary results are icon names; other literals are conditions.
    for (const [, name] of expression.matchAll(/[?:]\s*'([a-z0-9_]+)'/g)) names.add(name);
  }
  for (const [, name] of source.matchAll(/MaterialSymbol,\s*\{\s*name:\s*'([a-z0-9_]+)'/g)) names.add(name);
  return names;
}

test('every Material Symbol used in the UI is bundled in the font subset', async () => {
  const bundled = new Set(MATERIAL_SYMBOL_NAMES);
  const missing = [];
  let usages = 0;

  for (const file of await listSourceFiles(SRC)) {
    const source = await readFile(file, 'utf8');
    if (!source.includes('MaterialSymbol')) continue;
    for (const name of collectIconNames(source)) {
      usages += 1;
      if (!bundled.has(name)) missing.push(`${name} (${file})`);
    }
  }

  assert.ok(usages > 0, 'expected to find MaterialSymbol usages');
  assert.deepEqual(missing, [], 'add these names to materialSymbolNames.js and run npm run icons');
});

test('the bundled icon font subset exists', async () => {
  const font = await stat(new URL('../../src/assets/fonts/material-symbols-outlined.woff2', import.meta.url));
  assert.ok(font.size > 0);
});
