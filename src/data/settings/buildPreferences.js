import {
  DEFAULT_PRICE_MODE,
  isSupportedPriceMode,
} from '../price/priceModes.js';

const PRICE_MODE_STORAGE_KEY = 'tarkovGunHelper.priceMode';
const INCLUDE_TRADER_PRICES_STORAGE_KEY = 'tarkovGunHelper.includeTraderPrices';

export const DEFAULT_INCLUDE_TRADER_PRICES = true;

export function loadPriceModePreference() {
  if (typeof window === 'undefined') {
    return DEFAULT_PRICE_MODE;
  }

  try {
    const storedValue = window.localStorage.getItem(PRICE_MODE_STORAGE_KEY);
    return isSupportedPriceMode(storedValue) ? storedValue : DEFAULT_PRICE_MODE;
  } catch {
    return DEFAULT_PRICE_MODE;
  }
}

export function savePriceModePreference(priceMode) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (!isSupportedPriceMode(priceMode)) return;
    window.localStorage.setItem(PRICE_MODE_STORAGE_KEY, priceMode);
  } catch {
    // Ignore storage errors.
  }
}

const TARGET_TYPE_STORAGE_KEY = 'tarkovGunHelper.targetType';
const SUPPORTED_TARGET_TYPES = ['meta', 'custom'];

export function normalizeTargetType(targetType) {
  return SUPPORTED_TARGET_TYPES.includes(targetType) ? targetType : 'meta';
}

export function loadTargetTypePreference() {
  if (typeof window === 'undefined') {
    return 'meta';
  }

  try {
    const storedValue = window.localStorage.getItem(TARGET_TYPE_STORAGE_KEY);
    return normalizeTargetType(storedValue);
  } catch {
    return 'meta';
  }
}

export function saveTargetTypePreference(targetType) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(TARGET_TYPE_STORAGE_KEY, normalizeTargetType(targetType));
  } catch {
    // Ignore storage errors.
  }
}

export function loadIncludeTraderPricesPreference() {
  if (typeof window === 'undefined') {
    return DEFAULT_INCLUDE_TRADER_PRICES;
  }

  try {
    const storedValue = window.localStorage.getItem(INCLUDE_TRADER_PRICES_STORAGE_KEY);
    if (storedValue === 'false') return false;
    if (storedValue === 'true') return true;
    return DEFAULT_INCLUDE_TRADER_PRICES;
  } catch {
    return DEFAULT_INCLUDE_TRADER_PRICES;
  }
}

export function saveIncludeTraderPricesPreference(includeTraderPrices) {
  if (typeof window === 'undefined' || typeof includeTraderPrices !== 'boolean') {
    return;
  }

  try {
    window.localStorage.setItem(
      INCLUDE_TRADER_PRICES_STORAGE_KEY,
      String(includeTraderPrices),
    );
  } catch {
    // Ignore storage errors.
  }
}
