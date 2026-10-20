// Titles, descriptions and canonical URLs for every indexable page. The app
// sets them on route changes and scripts/prerender.mjs writes the same values
// into the static HTML, so a page reads the same before and after the JS runs.
import { formatCaliberLabel, getWeaponTypeLabel } from '../../pages/homeWeaponFilters.js';
import { getWeaponPath } from '../../domain/weaponSlugs.js';

export const SITE_URL = 'https://tarkovgunhelper.com';
export const SITE_NAME = 'Tarkov Gun Helper';
export const OG_IMAGE_URL = `${SITE_URL}/og-image.png`;

export const HOME_META = Object.freeze({
  path: '/',
  title: 'Tarkov Gun Helper - Optimal Weapon Builds',
  description: 'Generate optimal Escape from Tarkov weapon builds: lowest recoil, best ergonomics, '
    + 'budget and weight limits, priced with live flea market and trader offers for PvP and PvE.',
});

// Pages with a fixed title. Their static copies live at <path>index.html.
export const STATIC_PAGE_META = Object.freeze({
  '/builds/': {
    path: '/builds/',
    title: `Saved Weapon Builds – Compare and Share | ${SITE_NAME}`,
    description: 'Your saved Escape from Tarkov weapon builds: compare up to four side by side, '
      + 'export and import them as files, and share any build as a link.',
  },
  '/module-comparison/': {
    path: '/module-comparison/',
    title: `Weapon Mod Comparison – Recoil, Ergonomics, Price | ${SITE_NAME}`,
    description: 'Compare Escape from Tarkov weapon mods of one category side by side: recoil, '
      + 'ergonomics, weight and flea market or trader price for PvP and PvE.',
  },
  '/settings/': {
    path: '/settings/',
    title: `Settings | ${SITE_NAME}`,
    description: 'Tarkov Gun Helper settings: language, theme, trader levels, flea market access '
      + 'and how prices are picked for generated weapon builds.',
  },
});

// An unknown page or weapon. GitHub Pages serves it as 404.html with a 404
// status, so the canonical URL only fills the tag.
export const NOT_FOUND_META = Object.freeze({
  path: '/',
  title: `Page Not Found | ${SITE_NAME}`,
  description: HOME_META.description,
});

export function getCanonicalUrl(path) {
  return `${SITE_URL}${path}`;
}

function withTrailingSlash(pathname) {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

// The meta of a page that does not depend on loaded data, or null for weapon
// pages, which need the weapon first, and for unknown paths, whose not-found
// page sets its own.
export function getStaticRouteMeta(pathname) {
  if (typeof pathname !== 'string' || pathname === '/' || pathname === '') return HOME_META;
  const normalized = withTrailingSlash(pathname);
  if (Object.hasOwn(STATIC_PAGE_META, normalized)) return STATIC_PAGE_META[normalized];
  return null;
}

// The labels a weapon page shows, from a catalog weapon.
export function describeWeapon(weapon) {
  const caliber = weapon?.properties?.caliber;
  return {
    name: (weapon?.name || weapon?.shortName || '').trim(),
    shortName: (weapon?.shortName || weapon?.name || '').trim(),
    caliber: caliber ? formatCaliberLabel(caliber) : '',
    type: getWeaponTypeLabel(weapon),
  };
}

function toShortNameKey(shortName) {
  return (shortName || '').trim().toLowerCase();
}

// Short names that several weapons share (a variant in another color, the
// MDR in two calibers). Their titles use the full name to stay unique.
export function getAmbiguousShortNames(describedWeapons) {
  const counts = new Map();
  for (const weapon of describedWeapons) {
    const key = toShortNameKey(weapon.shortName);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

// The title leads with the short name and keeps "Tarkov" early, so a typical
// title fits the ~60 characters a search result shows. The full name stays in
// the description and the page heading.
export function getWeaponPageMeta({ name, shortName, caliber, slug }, { ambiguousShortNames = new Set() } = {}) {
  const caliberText = caliber ? ` (${caliber})` : '';
  const shortKey = toShortNameKey(shortName);
  const titleName = shortKey && !ambiguousShortNames.has(shortKey) ? shortName.trim() : name;
  return {
    path: getWeaponPath(slug),
    title: `${titleName} Build – Tarkov Meta & Budget Builds | ${SITE_NAME}`,
    description: `Optimal ${name}${caliberText} builds for Escape from Tarkov: lowest recoil, `
      + 'best ergonomics or a budget setup, priced with flea market and trader offers for PvP and PvE.',
  };
}
