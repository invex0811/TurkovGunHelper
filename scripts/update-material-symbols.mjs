// Downloads the Material Symbols Outlined subset for the icons listed in
// src/ui/materialSymbolNames.js, so the app serves the font itself and keeps
// working offline. Run with `npm run icons` after changing the icon list.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATERIAL_SYMBOL_NAMES } from '../src/ui/materialSymbolNames.js';

const AXES = 'opsz,wght,FILL,GRAD@24,200,0,-25';
const OUTPUT = fileURLToPath(new URL('../src/assets/fonts/material-symbols-outlined.woff2', import.meta.url));
// Google Fonts serves woff2 only to browsers it recognizes.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const iconNames = [...new Set(MATERIAL_SYMBOL_NAMES)].sort();
const cssUrl = new URL('https://fonts.googleapis.com/css2');
cssUrl.searchParams.set('family', `Material Symbols Outlined:${AXES}`);
cssUrl.searchParams.set('icon_names', iconNames.join(','));
cssUrl.searchParams.set('display', 'block');

async function fetchOk(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response;
}

const css = await (await fetchOk(cssUrl)).text();
const fontUrl = css.match(/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\('woff2'\)/)?.[1];
if (!fontUrl) throw new Error(`No woff2 source in the Google Fonts response:\n${css}`);

const font = Buffer.from(await (await fetchOk(fontUrl)).arrayBuffer());
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, font);
console.log(`Saved ${iconNames.length} icons (${font.length} bytes) to ${OUTPUT}`);
