// The weapon list of the static pages: the same tarkov.dev JSON API, the same
// normalization and the same "buildable" filter as the catalog in the app.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchTarkovJson } from '../../src/data/tarkovApi/client.js';
import { normalizeItemsCatalog } from '../../src/data/tarkovApi/itemMapper.js';
import { isBuildableWeapon } from '../../src/data/tarkovApi/repository.js';
import { applyTarkovTranslations } from '../../src/data/tarkovApi/translations.js';
import { describeWeapon } from '../../src/features/seo/pageMeta.js';

export const SNAPSHOT_PATH = fileURLToPath(new URL('../data/weapons-snapshot.json', import.meta.url));
const REQUEST_TIMEOUT_MS = 60_000;

function toSummary(weapon) {
  const { name, shortName, caliber, type } = describeWeapon(weapon);
  return { id: weapon.id, normalizedName: weapon.normalizedName ?? '', name, shortName, caliber, type };
}

function sortById(weapons) {
  return [...weapons].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function fetchWeaponSummaries({ timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const [items, translations] = await Promise.all([
    fetchTarkovJson('regular/items', { timeoutMs }),
    fetchTarkovJson('regular/items_en', { timeoutMs }),
  ]);
  applyTarkovTranslations(items, translations.data);
  // Prices, barters and traders do not matter for the page list.
  const catalog = normalizeItemsCatalog(items.data, [], {}, 'pvp');
  return sortById(catalog.weapons.filter(isBuildableWeapon).map(toSummary).filter(weapon => weapon.name));
}

export async function readWeaponSnapshot() {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'));
  if (!Array.isArray(snapshot.weapons) || snapshot.weapons.length === 0) {
    throw new Error(`${SNAPSHOT_PATH} has no weapons.`);
  }
  return snapshot;
}

export async function writeWeaponSnapshot(weapons) {
  const snapshot = {
    source: 'https://json.tarkov.dev/regular/items',
    updatedAt: new Date().toISOString(),
    weapons: sortById(weapons),
  };
  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}
