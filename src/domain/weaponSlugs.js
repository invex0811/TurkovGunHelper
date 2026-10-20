// Weapon pages live at /weapon/<slug>/. The slug comes from tarkov.dev's
// normalizedName. The app and scripts/prerender.mjs both build slugs here, so
// the static pages and the router agree. Saved data keeps weapon ids.

export const WEAPON_PATH_PREFIX = '/weapon/';

export function toWeaponSlug(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function compareIds(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Maps weapons to unique slugs. Weapons that share a normalizedName are
 * ordered by id: the first keeps the plain slug, the others get -2, -3...
 * The result depends only on the list, not on its order.
 */
export function createWeaponSlugIndex(weapons) {
  const sorted = (Array.isArray(weapons) ? weapons : [])
    .filter(weapon => typeof weapon?.id === 'string' && weapon.id)
    .sort((a, b) => compareIds(a.id, b.id));
  const baseSlugs = new Map(sorted.map(weapon => [
    weapon.id,
    toWeaponSlug(weapon.normalizedName) || toWeaponSlug(weapon.id) || 'weapon',
  ]));
  const baseCounts = new Map();
  for (const slug of baseSlugs.values()) baseCounts.set(slug, (baseCounts.get(slug) || 0) + 1);

  const slugById = new Map();
  const idBySlug = new Map();
  const weaponById = new Map();
  const assign = (weapon, slug) => {
    slugById.set(weapon.id, slug);
    idBySlug.set(slug, weapon.id);
    weaponById.set(weapon.id, weapon);
  };

  // Unique names first, so a suffixed slug never takes another weapon's name.
  const collisions = [];
  for (const weapon of sorted) {
    const slug = baseSlugs.get(weapon.id);
    if (baseCounts.get(slug) === 1) assign(weapon, slug);
    else collisions.push(weapon);
  }
  for (const weapon of collisions) {
    const base = baseSlugs.get(weapon.id);
    let slug = base;
    for (let suffix = 2; idBySlug.has(slug); suffix += 1) slug = `${base}-${suffix}`;
    assign(weapon, slug);
  }

  return { slugById, idBySlug, weaponById };
}

// Keyed by the weapons array, so repeated lookups on one catalog are free.
const indexByWeapons = new WeakMap();

export function getWeaponSlugIndex(weapons) {
  if (!Array.isArray(weapons)) return createWeaponSlugIndex([]);
  if (!indexByWeapons.has(weapons)) indexByWeapons.set(weapons, createWeaponSlugIndex(weapons));
  return indexByWeapons.get(weapons);
}

export function getWeaponPath(slug) {
  return `${WEAPON_PATH_PREFIX}${encodeURIComponent(slug)}/`;
}

export function getLegacyConfigurePath(weaponId) {
  return `/configure/${encodeURIComponent(weaponId)}`;
}
