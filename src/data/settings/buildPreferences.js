import {
  DEFAULT_PRICE_MODE,
  isSupportedPriceMode,
} from '../price/priceModes.js';

const PRICE_MODE_STORAGE_KEY = 'tarkovGunHelper.priceMode';

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
const SUPPORTED_TARGET_TYPES = ['meta', 'max_ergo', 'min_recoil', 'budget', 'custom'];

export function loadTargetTypePreference() {
  if (typeof window === 'undefined') {
    return 'meta';
  }

  try {
    const storedValue = window.localStorage.getItem(TARGET_TYPE_STORAGE_KEY);
    return SUPPORTED_TARGET_TYPES.includes(storedValue) ? storedValue : 'meta';
  } catch {
    return 'meta';
  }
}

export function saveTargetTypePreference(targetType) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (!SUPPORTED_TARGET_TYPES.includes(targetType)) return;
    window.localStorage.setItem(TARGET_TYPE_STORAGE_KEY, targetType);
  } catch {
    // Ignore storage errors.
  }
}