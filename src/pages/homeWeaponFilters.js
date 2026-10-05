const EXCLUDED_WEAPON_TYPE_IDENTIFIERS = new Set([
  'weapon',
  'item',
  'weapon-category',
  'item-category',
  'compound-item',
]);
const EXCLUDED_WEAPON_TYPE_NAMES = new Set(['weapon', 'item', 'compound item', 'оружие', 'предмет', 'составной предмет']);
const CALIBER_LABEL_OVERRIDES = new Map([
  ['725', '72.5mm'],
]);
const ATTACHED_CALIBER_SUFFIXES = new Set(['PM', 'PMM', 'R']);
const SPACED_CALIBER_SUFFIXES = new Set(['ACP', 'NATO', 'PARA', 'TKM', 'TT']);
const DECIMAL_CALIBER_PREFIXES = new Map([
  ['46', '4.6'],
  ['57', '5.7'],
  ['68', '6.8'],
  ['86', '8.6'],
  ['93', '9.3'],
  ['127', '12.7'],
  ['366', '.366'],
  ['545', '5.45'],
  ['556', '5.56'],
  ['762', '7.62'],
  ['784', '7.84'],
  ['1143', '11.43'],
]);

function getWeaponCaliber(weapon) {
  const caliber = weapon?.properties?.caliber;
  return typeof caliber === 'string' ? caliber.trim() : '';
}

function normalizeCategoryIdentifier(value) {
  return typeof value === 'string'
    ? value.trim().toLocaleLowerCase()
    : '';
}

function isExcludedWeaponType(category) {
  const identifier = normalizeCategoryIdentifier(category?.normalizedName)
    || normalizeCategoryIdentifier(category?.id);
  if (EXCLUDED_WEAPON_TYPE_IDENTIFIERS.has(identifier)) return true;

  // Older cached data may not have category IDs or normalized names. Keep this
  // fallback deliberately narrow, including the Russian generic labels.
  return EXCLUDED_WEAPON_TYPE_NAMES.has(normalizeCategoryIdentifier(category?.name));
}

export function getWeaponTypeLabel(weapon) {
  const category = weapon?.categories?.find(item => item?.name?.trim() && !isExcludedWeaponType(item));
  return category ? category.name.trim() : '';
}

// The catalog keeps its type filter in the URL, so other pages (the
// configurator breadcrumbs) can link to the catalog narrowed to one type.
export const HOME_TYPE_PARAM = 'type';
// The rest of the catalog state lives there too, so returning from a weapon
// or reloading the page keeps the list the user narrowed down.
export const HOME_SEARCH_PARAM = 'q';
export const HOME_SORT_PARAM = 'sort';
export const HOME_CALIBER_PARAM = 'caliber';
export const HOME_TRADER_PARAM = 'trader';

export function getHomeTypeFilterPath(type) {
  return type ? `/?${new URLSearchParams({ [HOME_TYPE_PARAM]: type })}` : '/';
}

function getWeaponTraders(weapon) {
  return (weapon?.buyFor || []).flatMap(offer => {
    const id = offer?.vendor?.normalizedName || offer?.vendor?.id;
    return id ? [{ id, name: offer.vendor.name || id }] : [];
  });
}

export function getHomeWeaponFilterOptions(weapons) {
  const types = new Set();
  const calibers = new Set();
  const traders = new Map();

  weapons.forEach(weapon => {
    weapon.categories?.forEach(category => {
      const type = category?.name?.trim();
      if (type && !isExcludedWeaponType(category)) types.add(type);
    });
    const caliber = getWeaponCaliber(weapon);
    if (caliber) calibers.add(caliber);
    getWeaponTraders(weapon).forEach(trader => {
      if (!traders.has(trader.id)) traders.set(trader.id, trader);
    });
  });

  return {
    types: [...types].sort((left, right) => left.localeCompare(right)),
    calibers: [...calibers].sort((left, right) => left.localeCompare(right)),
    traders: [...traders.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function filterHomeWeapons(weapons, {
  search = '',
  type = 'All',
  caliber = 'All',
  trader = 'All',
} = {}) {
  const normalizedSearch = search.trim().toLowerCase();

  return weapons.filter(weapon => {
    const name = typeof weapon.name === 'string' ? weapon.name : '';
    const shortName = typeof weapon.shortName === 'string' ? weapon.shortName : '';
    const weaponCaliber = getWeaponCaliber(weapon);
    const matchesSearch = !normalizedSearch
      || name.toLowerCase().includes(normalizedSearch)
      || shortName.toLowerCase().includes(normalizedSearch)
      || (weaponCaliber && (
        weaponCaliber.toLowerCase().includes(normalizedSearch)
        || formatCaliberLabel(weaponCaliber).toLowerCase().includes(normalizedSearch)
      ));
    const matchesType = type === 'All' || weapon.categories?.some(category => category?.name === type);
    const matchesCaliber = caliber === 'All' || weaponCaliber === caliber;
    const matchesTrader = trader === 'All' || getWeaponTraders(weapon).some(item => item.id === trader);

    return matchesSearch && matchesType && matchesCaliber && matchesTrader;
  });
}

export const HOME_WEAPON_SORTS = Object.freeze(['name', 'price', 'ergonomics', 'recoil']);

function compareNumbers(left, right, direction) {
  const leftValid = Number.isFinite(left);
  const rightValid = Number.isFinite(right);
  // Missing values always go last.
  if (!leftValid || !rightValid) return Number(!leftValid) - Number(!rightValid);
  return direction * (left - right);
}

// getPrice(weapon) returns the displayed base price, or NaN when unknown.
export function sortHomeWeapons(weapons, sort = 'name', getPrice = () => Number.NaN) {
  const byName = (left, right) => String(left.shortName || left.name || '')
    .localeCompare(String(right.shortName || right.name || ''));
  const compare = {
    price: (left, right) => compareNumbers(getPrice(left), getPrice(right), 1),
    ergonomics: (left, right) => compareNumbers(
      Number(left.properties?.ergonomics),
      Number(right.properties?.ergonomics),
      -1,
    ),
    recoil: (left, right) => compareNumbers(
      Number(left.properties?.recoilVertical),
      Number(right.properties?.recoilVertical),
      1,
    ),
  }[sort];

  return [...weapons].sort((left, right) => (compare?.(left, right) || 0) || byName(left, right));
}

export function formatCaliberLabel(caliber) {
  if (typeof caliber !== 'string' || !caliber.trim()) return 'Unknown caliber';

  const withoutPrefix = caliber.trim().replace(/^caliber\s*/i, '');
  const override = CALIBER_LABEL_OVERRIDES.get(withoutPrefix);
  if (override) return override;
  const match = withoutPrefix.match(/^(\d+)(x\d+)?([a-z]+)?$/i);
  if (match) {
    const [, numericPrefix, cartridgeLength = '', suffix = ''] = match;
    const readablePrefix = DECIMAL_CALIBER_PREFIXES.get(numericPrefix) || numericPrefix;
    const normalizedSuffix = suffix.toUpperCase();
    let readableSuffix = normalizedSuffix;
    if (suffix.toLowerCase() === 'g') readableSuffix = 'ga';
    if (suffix.toLowerCase() === 'mm') readableSuffix = 'mm';
    if (SPACED_CALIBER_SUFFIXES.has(normalizedSuffix)) readableSuffix = ` ${normalizedSuffix}`;
    if (ATTACHED_CALIBER_SUFFIXES.has(normalizedSuffix)) readableSuffix = normalizedSuffix;
    return `${readablePrefix}${cartridgeLength}${readableSuffix}`;
  }

  const readable = withoutPrefix.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return readable || caliber.trim();
}
