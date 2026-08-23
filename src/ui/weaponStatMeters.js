// The recoil maximum is replaced with the selected weapon's unmodified value
// in the configurator. These limits are only fallbacks for missing API data.
export const WEAPON_STAT_UI_RANGES = Object.freeze({
  weight: Object.freeze({ min: 0, max: 15, direction: 'lower-is-better' }),
  ergonomics: Object.freeze({ min: 0, max: 100, direction: 'higher-is-better' }),
  accuracyMoa: Object.freeze({ min: 0, max: 25, direction: 'higher-is-better' }),
  verticalRecoil: Object.freeze({ min: 0, max: 350, direction: 'lower-is-better' }),
  horizontalRecoil: Object.freeze({ min: 0, max: 600, direction: 'lower-is-better' }),
  // Shared fixed ceiling for the radar and the numeric Max Budget fallback.
  // It keeps the full control range useful for both budget and end-game builds.
  price: Object.freeze({ min: 0, max: 2_000_000, direction: 'lower-is-better' }),
});

export function withBaseStatMaximum(range, baseValue) {
  if (
    typeof baseValue !== 'number'
    || !Number.isFinite(baseValue)
    || baseValue <= range.min
  ) {
    return range;
  }

  return { ...range, max: baseValue };
}

export function toFiniteStatNumber(value) {
  const numericValue = typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value;

  return typeof numericValue === 'number' && Number.isFinite(numericValue)
    ? numericValue
    : Number.NaN;
}

export function formatAccuracyMoa(value, locale = 'en') {
  const numericValue = toFiniteStatNumber(value);
  if (!Number.isFinite(numericValue)) return null;

  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue)} MOA`;
}

export function normalizeStatPercent(value, min, max) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || typeof min !== 'number'
    || !Number.isFinite(min)
    || typeof max !== 'number'
    || !Number.isFinite(max)
    || max <= min
  ) {
    return 0;
  }

  const percent = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, percent));
}
