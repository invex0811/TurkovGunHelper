import { DEFAULT_PRICE_MODE, PRICE_MODES } from '../price/priceModes.js';

export const TRADER_LEVELS_STORAGE_KEY = 'tarkovGunHelper.traderLevels';
export const TRADER_LEVELS_SCHEMA_VERSION = 1;
export const DEFAULT_TRADER_LEVEL = 1;
export const DEFAULT_MAX_TRADER_LEVEL = 4;

function emptyState() {
  return {
    schemaVersion: TRADER_LEVELS_SCHEMA_VERSION,
    profiles: { pvp: {}, pve: {} },
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeTraderLevel(value, maxLevel = DEFAULT_MAX_TRADER_LEVEL) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TRADER_LEVEL;
  const safeMax = Number.isInteger(maxLevel) && maxLevel >= 1
    ? maxLevel
    : DEFAULT_MAX_TRADER_LEVEL;
  return Math.min(safeMax, Math.max(DEFAULT_TRADER_LEVEL, Math.trunc(value)));
}

function getMaxLevel(traders, traderId) {
  const trader = (traders || []).find(entry => entry?.id === traderId);
  return trader?.maxLevel ?? DEFAULT_MAX_TRADER_LEVEL;
}

export function normalizeTraderLevels(value, traders = []) {
  const normalized = emptyState();
  const profiles = isRecord(value?.profiles) ? value.profiles : value;

  for (const mode of Object.values(PRICE_MODES)) {
    const profile = isRecord(profiles?.[mode]) ? profiles[mode] : {};
    for (const [traderId, level] of Object.entries(profile)) {
      if (!traderId || typeof level !== 'number' || !Number.isFinite(level)) continue;
      if (traders.length > 0 && !traders.some(trader => trader?.id === traderId)) continue;
      normalized.profiles[mode][traderId] = normalizeTraderLevel(
        level,
        getMaxLevel(traders, traderId),
      );
    }
  }

  return normalized;
}

function getDefaultStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function loadTraderLevels(storage = getDefaultStorage(), traders = []) {
  if (!storage) return normalizeTraderLevels(null, traders);
  try {
    const serialized = storage.getItem(TRADER_LEVELS_STORAGE_KEY);
    return normalizeTraderLevels(serialized ? JSON.parse(serialized) : null, traders);
  } catch {
    return normalizeTraderLevels(null, traders);
  }
}

export function saveTraderLevels(levels, storage = getDefaultStorage(), traders = []) {
  const normalized = normalizeTraderLevels(levels, traders);
  if (!storage) return normalized;
  try {
    storage.setItem(TRADER_LEVELS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Browsers can deny or exhaust local storage. The in-memory value remains usable.
  }
  return normalized;
}

export function getTraderLevel(traderId, priceMode = DEFAULT_PRICE_MODE, levels) {
  if (!traderId) return DEFAULT_TRADER_LEVEL;
  return normalizeTraderLevel(levels?.profiles?.[priceMode]?.[traderId]);
}

export function setTraderLevel(
  traderId,
  level,
  priceMode = DEFAULT_PRICE_MODE,
  levels,
  traders = [],
) {
  if (!traderId || !traders.some(trader => trader?.id === traderId)) {
    return normalizeTraderLevels(levels, traders);
  }
  const normalized = normalizeTraderLevels(levels, traders);
  normalized.profiles[priceMode][traderId] = normalizeTraderLevel(
    level,
    getMaxLevel(traders, traderId),
  );
  return normalized;
}

export function resetTraderLevels(priceMode = DEFAULT_PRICE_MODE, levels, traders = []) {
  const normalized = normalizeTraderLevels(levels, traders);
  normalized.profiles[priceMode] = {};
  return normalized;
}

export function initializeTraderLevels(
  priceMode = DEFAULT_PRICE_MODE,
  levels,
  traders = [],
) {
  const normalized = normalizeTraderLevels(levels, traders);
  const profile = normalized.profiles[priceMode];
  if (!profile || Object.keys(profile).length > 0) return normalized;

  for (const trader of traders) {
    if (!trader?.id) continue;
    profile[trader.id] = DEFAULT_TRADER_LEVEL;
  }
  return normalized;
}
