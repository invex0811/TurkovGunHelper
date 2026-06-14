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