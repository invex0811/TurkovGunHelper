export const PERSISTENT_CACHE_SCHEMA_VERSION = 1;
export const PERSISTENT_CACHE_FRESHNESS_MS = 60 * 60 * 1000;

const SUPPORTED_GAME_MODES = new Set(['regular', 'pve']);
const SUPPORTED_LANGUAGES = new Set(['en', 'ru']);

export function createCatalogCacheKey(gameMode, language, priceMode = gameMode === 'pve' ? 'pve' : 'pvp') {
  const safeGameMode = SUPPORTED_GAME_MODES.has(gameMode) ? gameMode : 'regular';
  const safeLanguage = SUPPORTED_LANGUAGES.has(language) ? language : 'en';
  const safePriceMode = priceMode === 'pve' ? 'pve' : 'pvp';
  return `catalog:v${PERSISTENT_CACHE_SCHEMA_VERSION}:${safeGameMode}:${safeLanguage}:${safePriceMode}`;
}

export function isValidCatalog(catalog) {
  return Boolean(
    catalog
    && typeof catalog === 'object'
    && Array.isArray(catalog.weapons)
    && catalog.itemsById
    && typeof catalog.itemsById === 'object'
    && catalog.modsById
    && typeof catalog.modsById === 'object',
  );
}

export function isValidCatalogCacheRecord(record, cacheKey) {
  return Boolean(
    record
    && record.cacheKey === cacheKey
    && record.schemaVersion === PERSISTENT_CACHE_SCHEMA_VERSION
    && record.source === 'tarkov.dev'
    && SUPPORTED_GAME_MODES.has(record.gameMode)
    && SUPPORTED_LANGUAGES.has(record.language)
    && (record.priceMode === 'pvp' || record.priceMode === 'pve')
    && Number.isFinite(record.fetchedAt)
    && Number.isFinite(record.expiresAt)
    && Number.isInteger(record.itemCount)
    && record.itemCount >= 0
    && isValidCatalog(record.catalog),
  );
}
