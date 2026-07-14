export const PRICE_MODES = {
  PVP: 'pvp',
  PVE: 'pve',
};

export const DEFAULT_PRICE_MODE = PRICE_MODES.PVP;

export const PRICE_MODE_OPTIONS = [
  { value: PRICE_MODES.PVP, label: 'PvP prices' },
  { value: PRICE_MODES.PVE, label: 'PvE prices' },
];

export const PRICE_MODE_LABELS = {
  [PRICE_MODES.PVP]: 'PvP',
  [PRICE_MODES.PVE]: 'PvE',
};

export const PRICE_CURRENCY = {
  RUB: 'RUB',
};

export const PRICE_SOURCE = {
  TARKOV_DEV: 'tarkov.dev',
};

export const PRICE_SOURCE_TYPE = {
  FLEA_MARKET: 'fleaMarket',
  TRADER: 'trader',
  MISSING: 'missing',
};

export const PRICE_CONFIDENCE = {
  HIGH: 'high',
  FALLBACK: 'fallback',
  MISSING: 'missing',
};

export function isSupportedPriceMode(value) {
  return Object.values(PRICE_MODES).includes(value);
}
