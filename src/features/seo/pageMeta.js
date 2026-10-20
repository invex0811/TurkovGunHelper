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

export function getCanonicalUrl(path) {
  return `${SITE_URL}${path}`;
}

function withTrailingSlash(pathname) {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

// The meta of a page that does not depend on loaded data, or null for weapon
// pages, which need the weapon first.
export function getStaticRouteMeta(pathname) {
  if (typeof pathname !== 'string' || pathname === '/' || pathname === '') return HOME_META;
  const normalized = withTrailingSlash(pathname);
  if (Object.hasOwn(STATIC_PAGE_META, normalized)) return STATIC_PAGE_META[normalized];
  if (normalized.startsWith('/weapon/') || normalized.startsWith('/configure/')) return null;
  return HOME_META;
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

export function getWeaponPageMeta({ name, caliber, slug }) {
  const caliberText = caliber ? ` (${caliber})` : '';
  return {
    path: getWeaponPath(slug),
    title: `${name} Build – Meta & Budget Builds | ${SITE_NAME}`,
    description: `Optimal ${name}${caliberText} builds for Escape from Tarkov: lowest recoil, `
      + 'best ergonomics or a budget setup, priced with flea market and trader offers for PvP and PvE.',
  };
}
