const EXCLUDED_WEAPON_TYPES = new Set(['Weapon', 'Item']);
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

export function getHomeWeaponFilterOptions(weapons) {
  const types = new Set();
  const calibers = new Set();

  weapons.forEach(weapon => {
    weapon.categories?.forEach(category => {
      const type = category?.name?.trim();
      if (type && !EXCLUDED_WEAPON_TYPES.has(type)) types.add(type);
    });
    const caliber = getWeaponCaliber(weapon);
    if (caliber) calibers.add(caliber);
  });

  return {
    types: [...types].sort((left, right) => left.localeCompare(right)),
    calibers: [...calibers].sort((left, right) => left.localeCompare(right)),
  };
}

export function filterHomeWeapons(weapons, { search = '', type = 'All', caliber = 'All' } = {}) {
  const normalizedSearch = search.trim().toLowerCase();

  return weapons.filter(weapon => {
    const name = typeof weapon.name === 'string' ? weapon.name : '';
    const shortName = typeof weapon.shortName === 'string' ? weapon.shortName : '';
    const matchesSearch = !normalizedSearch
      || name.toLowerCase().includes(normalizedSearch)
      || shortName.toLowerCase().includes(normalizedSearch);
    const matchesType = type === 'All' || weapon.categories?.some(category => category?.name === type);
    const matchesCaliber = caliber === 'All' || getWeaponCaliber(weapon) === caliber;

    return matchesSearch && matchesType && matchesCaliber;
  });
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
