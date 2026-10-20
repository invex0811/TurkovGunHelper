// Runs after `vite build`: writes a static index.html for every weapon page
// and section, plus 404.html, sitemap.xml and robots.txt. The app replaces the
// static text once its JS loads. Weapons come from tarkov.dev; when it is
// unreachable (or answers with a much shorter list) the committed snapshot in
// scripts/data/weapons-snapshot.json is used, so the build never fails or
// loses pages because of the network.
//
//   node scripts/prerender.mjs             build pages (API, then snapshot)
//   PRERENDER_OFFLINE=1 node scripts/...   build pages from the snapshot only
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWeaponSlugIndex } from '../src/domain/weaponSlugs.js';
import { HOME_META, STATIC_PAGE_META, getWeaponPageMeta } from '../src/features/seo/pageMeta.js';
import {
  assertAbsoluteAssetPaths,
  renderPage,
  renderRobots,
  renderSitemap,
  renderStaticBody,
  renderWeaponBody,
} from './lib/prerenderHtml.mjs';
import { fetchWeaponSummaries, readWeaponSnapshot } from './lib/weaponCatalog.mjs';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
// A list this much shorter than the snapshot is a broken response, not a patch.
const MIN_API_SHARE_OF_SNAPSHOT = 0.9;

const SECTION_BODIES = {
  '/builds/': {
    eyebrow: 'Saved builds',
    heading: 'Saved weapon builds',
    paragraphs: [
      'Your Escape from Tarkov weapon builds, saved in this browser. Compare up to four builds side by side: '
        + 'recoil, ergonomics, weight and price.',
      'Export builds to a file and import them on another device, or share any build as a link.',
    ],
  },
  '/module-comparison/': {
    eyebrow: 'Module comparison',
    heading: 'Weapon mod comparison',
    paragraphs: [
      'Compare Escape from Tarkov weapon mods of one category side by side: recoil, ergonomics, weight '
        + 'and the flea market or trader price, for PvP and PvE.',
    ],
  },
  '/settings/': {
    eyebrow: 'Settings',
    heading: 'Settings',
    paragraphs: [
      'Language, theme, trader levels, flea market access and the price rules used for generated builds.',
    ],
  },
};

async function loadWeapons() {
  const snapshot = await readWeaponSnapshot();
  if (process.env.PRERENDER_OFFLINE) return { weapons: snapshot.weapons, source: 'snapshot (offline)' };
  try {
    const weapons = await fetchWeaponSummaries();
    const minimum = Math.ceil(snapshot.weapons.length * MIN_API_SHARE_OF_SNAPSHOT);
    if (weapons.length < minimum) {
      throw new Error(`tarkov.dev returned ${weapons.length} weapons, the snapshot has ${snapshot.weapons.length}.`);
    }
    return { weapons, source: 'tarkov.dev' };
  } catch (error) {
    console.warn(`prerender: ${error.message} Using the snapshot from ${snapshot.updatedAt}.`);
    return { weapons: snapshot.weapons, source: `snapshot (${snapshot.updatedAt})` };
  }
}

async function writePage(path, html) {
  const file = join(DIST, path, 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}

const template = await readFile(join(DIST, 'index.html'), 'utf8');
assertAbsoluteAssetPaths(template);

const { weapons, source } = await loadWeapons();
const { slugById } = createWeaponSlugIndex(weapons);
const weaponPaths = [];
for (const weapon of weapons) {
  const meta = getWeaponPageMeta({ ...weapon, slug: slugById.get(weapon.id) });
  await writePage(meta.path, renderPage(template, { meta, body: renderWeaponBody(weapon) }));
  weaponPaths.push(meta.path);
}

for (const [path, body] of Object.entries(SECTION_BODIES)) {
  await writePage(path, renderPage(template, {
    meta: STATIC_PAGE_META[path],
    body: renderStaticBody({ ...body, links: [{ href: '/', label: 'All weapons' }] }),
  }));
}

// GitHub Pages answers any other path with 404.html: the app shell then
// shows the route (a weapon added after this build, for example).
await writeFile(join(DIST, '404.html'), template);
await writeFile(join(DIST, 'sitemap.xml'), renderSitemap([
  HOME_META.path,
  '/builds/',
  '/module-comparison/',
  ...weaponPaths.sort(),
]));
await writeFile(join(DIST, 'robots.txt'), renderRobots());

console.log(`prerender: ${weaponPaths.length} weapon pages from ${source}, 3 section pages, 404.html, sitemap.xml, robots.txt.`);
