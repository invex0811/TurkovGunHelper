import {
  DEFAULT_PRICE_MODE,
  isSupportedPriceMode,
} from '../price/priceModes.js';

const PRICE_MODE_STORAGE_KEY = 'tarkovGunHelper.priceMode';
const INCLUDE_TRADER_PRICES_STORAGE_KEY = 'tarkovGunHelper.includeTraderPrices';
const STRICT_TRADER_LEVELS_STORAGE_KEY = 'tarkovGunHelper.strictTraderLevels';
const LAST_SELECTED_FLASHLIGHT_ID_STORAGE_KEY = 'tarkovGunHelper.lastSelectedFlashlightId';
const LAST_SELECTED_TBL_ID_STORAGE_KEY = 'tarkovGunHelper.lastSelectedTblId';
const REMEMBER_TACTICAL_DEVICE_SELECTION_STORAGE_KEY = 'tarkovGunHelper.rememberTacticalDeviceSelection';
const NO_TACTICAL_DEVICE_STORAGE_VALUE = '__none__';
const BUILD_GOAL_MODE_STORAGE_KEY = 'tarkovGunHelper.buildGoalMode';
const TARGET_TYPE_STORAGE_KEY = 'tarkovGunHelper.targetType';
const SUPPORTED_TARGET_TYPES = ['meta', 'custom'];

export const DEFAULT_INCLUDE_TRADER_PRICES = true;
export const DEFAULT_STRICT_TRADER_LEVELS = false;
export const DEFAULT_REMEMBER_TACTICAL_DEVICE_SELECTION = false;
export const BUILD_GOAL_MODES = Object.freeze({
  META: 'meta',
  CONSTRAINTS: 'constraints',
  PRIORITIES: 'priorities',
});
export const DEFAULT_BUILD_GOAL_MODE = BUILD_GOAL_MODES.META;

const SUPPORTED_BUILD_GOAL_MODES = Object.values(BUILD_GOAL_MODES);

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

export function isSupportedBuildGoalMode(buildGoalMode) {
  return SUPPORTED_BUILD_GOAL_MODES.includes(buildGoalMode);
}

export function normalizeBuildGoalMode(buildGoalMode) {
  return isSupportedBuildGoalMode(buildGoalMode)
    ? buildGoalMode
    : DEFAULT_BUILD_GOAL_MODE;
}

export function loadBuildGoalModePreference() {
  if (typeof window === 'undefined') {
    return DEFAULT_BUILD_GOAL_MODE;
  }

  try {
    const storedMode = window.localStorage.getItem(BUILD_GOAL_MODE_STORAGE_KEY);
    if (isSupportedBuildGoalMode(storedMode)) return storedMode;

    const legacyTargetType = window.localStorage.getItem(TARGET_TYPE_STORAGE_KEY);
    return legacyTargetType === 'custom'
      ? BUILD_GOAL_MODES.CONSTRAINTS
      : DEFAULT_BUILD_GOAL_MODE;
  } catch {
    return DEFAULT_BUILD_GOAL_MODE;
  }
}

export function saveBuildGoalModePreference(buildGoalMode) {
  if (typeof window === 'undefined' || !isSupportedBuildGoalMode(buildGoalMode)) {
    return;
  }

  try {
    window.localStorage.setItem(BUILD_GOAL_MODE_STORAGE_KEY, buildGoalMode);
  } catch {
    // Ignore storage errors.
  }
}

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

export function loadStrictTraderLevelsPreference() {
  if (typeof window === 'undefined') {
    return DEFAULT_STRICT_TRADER_LEVELS;
  }

  try {
    const storedValue = window.localStorage.getItem(STRICT_TRADER_LEVELS_STORAGE_KEY);
    if (storedValue === 'true') return true;
    if (storedValue === 'false') return false;
    return DEFAULT_STRICT_TRADER_LEVELS;
  } catch {
    return DEFAULT_STRICT_TRADER_LEVELS;
  }
}

export function saveStrictTraderLevelsPreference(strictTraderLevels) {
  if (typeof window === 'undefined' || typeof strictTraderLevels !== 'boolean') {
    return;
  }

  try {
    window.localStorage.setItem(
      STRICT_TRADER_LEVELS_STORAGE_KEY,
      String(strictTraderLevels),
    );
  } catch {
    // Ignore storage errors.
  }
}

function loadTacticalDevicePreference(storageKey) {
  if (typeof window === 'undefined') return undefined;

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (storedValue === null) return undefined;
    return storedValue === NO_TACTICAL_DEVICE_STORAGE_VALUE ? null : storedValue;
  } catch {
    return undefined;
  }
}

function saveTacticalDevicePreference(storageKey, itemId) {
  if (typeof window === 'undefined' || (itemId !== null && typeof itemId !== 'string')) return;

  try {
    window.localStorage.setItem(storageKey, itemId ?? NO_TACTICAL_DEVICE_STORAGE_VALUE);
  } catch {
    // Storage is optional.
  }
}

export function loadRememberTacticalDeviceSelectionPreference() {
  if (typeof window === 'undefined') return DEFAULT_REMEMBER_TACTICAL_DEVICE_SELECTION;

  try {
    return window.localStorage.getItem(REMEMBER_TACTICAL_DEVICE_SELECTION_STORAGE_KEY) === 'true';
  } catch {
    return DEFAULT_REMEMBER_TACTICAL_DEVICE_SELECTION;
  }
}

export function saveRememberTacticalDeviceSelectionPreference(rememberSelection) {
  if (typeof window === 'undefined' || typeof rememberSelection !== 'boolean') return;

  try {
    window.localStorage.setItem(
      REMEMBER_TACTICAL_DEVICE_SELECTION_STORAGE_KEY,
      String(rememberSelection),
    );
  } catch {
    // Storage is optional.
  }
}

export function loadLastSelectedFlashlightId() {
  return loadTacticalDevicePreference(LAST_SELECTED_FLASHLIGHT_ID_STORAGE_KEY);
}

export function saveLastSelectedFlashlightId(itemId) {
  saveTacticalDevicePreference(LAST_SELECTED_FLASHLIGHT_ID_STORAGE_KEY, itemId);
}

export function loadLastSelectedTblId() {
  return loadTacticalDevicePreference(LAST_SELECTED_TBL_ID_STORAGE_KEY);
}

export function saveLastSelectedTblId(itemId) {
  saveTacticalDevicePreference(LAST_SELECTED_TBL_ID_STORAGE_KEY, itemId);
}
