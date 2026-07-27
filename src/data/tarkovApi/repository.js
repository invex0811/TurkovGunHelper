import { DEFAULT_PRICE_MODE } from '../price/priceModes.js';
import { getEffectivePriceMode, getTarkovDevGameMode } from '../price/priceProvider.js';
import { fetchTarkovJson, TarkovApiError } from './client.js';
import { normalizeItemsCatalog } from './itemMapper.js';
import { applyTarkovTranslations } from './translations.js';
import { readCachedCatalog, writeCachedCatalog } from '../cache/catalogCache.js';
import { createCatalogCacheKey } from '../cache/catalogCacheSchema.js';

export const TARKOV_API_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = new Set(['en', 'ru']);
const cachedCatalogs = new Map();
const catalogStatuses = new Map();
const catalogStatusListeners = new Set();

function publishCatalogStatus(cacheKey, status) {
  const nextStatus = { cacheKey, ...status };
  catalogStatuses.set(cacheKey, nextStatus);
  for (const listener of catalogStatusListeners) listener(nextStatus);
}

export function getCatalogStatus(gameMode = 'regular', options = {}) {
  const safeGameMode = gameMode === 'pve' ? 'pve' : 'regular';
  const language = normalizeLanguage(options.language);
  const priceMode = getEffectivePriceMode(options.priceMode);
  return catalogStatuses.get(createCatalogCacheKey(safeGameMode, language, priceMode)) ?? null;
}

export function subscribeToCatalogStatus(listener) {
  catalogStatusListeners.add(listener);
  return () => catalogStatusListeners.delete(listener);
}

function normalizeLanguage(language) {
  return SUPPORTED_LANGUAGES.has(language) ? language : DEFAULT_LANGUAGE;
}

function createAbortedRequestError(cause) {
  return new TarkovApiError('The Tarkov.dev request was cancelled.', {
    code: 'ABORTED',
    cause,
  });
}

function awaitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortedRequestError(signal.reason));

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abortRequest);
      callback(value);
    };
    const abortRequest = () => settle(reject, createAbortedRequestError(signal.reason));
    signal.addEventListener('abort', abortRequest, { once: true });
    promise.then(value => settle(resolve, value), error => settle(reject, error));
  });
}

function subscribeToRequest(cacheKey, entry, signal) {
  if (signal?.aborted) return Promise.reject(createAbortedRequestError(signal.reason));
  entry.activeConsumers += 1;

  return new Promise((resolve, reject) => {
    let settled = false;
    const release = () => {
      entry.activeConsumers -= 1;
      if (entry.activeConsumers === 0 && entry.promise && !entry.controller.signal.aborted) {
        if (cachedCatalogs.get(cacheKey) === entry) cachedCatalogs.delete(cacheKey);
        entry.controller.abort();
      }
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abortRequest);
      release();
      callback(value);
    };
    const abortRequest = () => settle(reject, createAbortedRequestError(signal.reason));
    signal?.addEventListener('abort', abortRequest, { once: true });
    entry.promise.then(value => settle(resolve, value), error => settle(reject, error));
  });
}

function getCachedCatalog(cacheKey, load, options) {
  const { forceRefresh = false, signal } = options;
  if (signal?.aborted) return Promise.reject(createAbortedRequestError(signal.reason));

  const cachedEntry = cachedCatalogs.get(cacheKey);
  if (cachedEntry?.promise) return subscribeToRequest(cacheKey, cachedEntry, signal);
  if (!forceRefresh && cachedEntry?.expiresAt > Date.now()) {
    options.onMemoryHit?.(cachedEntry);
    return awaitWithSignal(Promise.resolve(cachedEntry.value), signal);
  }

  const entry = { activeConsumers: 0, controller: new AbortController() };
  const requestPromise = Promise.resolve()
    .then(() => load(entry.controller.signal))
    .then(value => {
      if (cachedCatalogs.get(cacheKey) === entry) {
        entry.expiresAt = Date.now() + TARKOV_API_CACHE_TTL_MS;
        entry.metadata = value.metadata;
        entry.value = value.catalog;
        delete entry.promise;
      }
      return value.catalog;
    }, error => {
      if (cachedCatalogs.get(cacheKey) === entry) cachedCatalogs.delete(cacheKey);
      throw error;
    });

  entry.promise = requestPromise;
  cachedCatalogs.set(cacheKey, entry);
  return subscribeToRequest(cacheKey, entry, signal);
}

function requireItemsObject(response) {
  if (!response?.data?.items
    || typeof response.data.items !== 'object'
    || Array.isArray(response.data.items)) {
    throw new TarkovApiError('Tarkov.dev returned invalid item catalog data.', {
      code: 'INVALID_RESPONSE',
    });
  }
}

function requireBartersArray(response) {
  if (!Array.isArray(response?.data)) {
    throw new TarkovApiError('Tarkov.dev returned invalid barter data.', {
      code: 'INVALID_RESPONSE',
    });
  }
}

async function fetchCatalog(gameMode, language, signal, timeoutMs) {
  const requestOptions = { signal, timeoutMs };
  const [itemsResponse, itemTranslations, bartersResponse, tradersResponse, traderTranslations] = await Promise.all([
    fetchTarkovJson(`${gameMode}/items`, requestOptions),
    fetchTarkovJson(`${gameMode}/items_${language}`, requestOptions),
    fetchTarkovJson(`${gameMode}/barters`, { ...requestOptions, allowArrayData: true }),
    fetchTarkovJson(`${gameMode}/traders`, requestOptions),
    fetchTarkovJson(`${gameMode}/traders_${language}`, requestOptions),
  ]);

  requireItemsObject(itemsResponse);
  requireBartersArray(bartersResponse);
  applyTarkovTranslations(itemsResponse, itemTranslations.data);
  applyTarkovTranslations(tradersResponse, traderTranslations.data);

  return {
    data: itemsResponse.data,
    barters: bartersResponse.data,
    traders: tradersResponse.data,
  };
}

export function clearTarkovApiCache() {
  for (const entry of cachedCatalogs.values()) {
    if (entry.promise && !entry.controller.signal.aborted) entry.controller.abort();
  }
  cachedCatalogs.clear();
}

export function loadItemsCatalog(gameMode = 'regular', options = {}) {
  const safeGameMode = gameMode === 'pve' ? 'pve' : 'regular';
  const language = normalizeLanguage(options.language);
  const effectivePriceMode = getEffectivePriceMode(options.priceMode);
  const cacheKey = createCatalogCacheKey(safeGameMode, language, effectivePriceMode);

  return getCachedCatalog(cacheKey, async signal => {
    let persistentRecord = null;
    if (globalThis.indexedDB) {
      try {
        persistentRecord = await readCachedCatalog(cacheKey);
      } catch (error) {
        if (import.meta.env?.DEV) console.warn('Persistent catalog cache is unavailable.', error);
      }
    }

    if (signal.aborted) throw createAbortedRequestError(signal.reason);

    const now = Date.now();
    if (persistentRecord && !options.forceRefresh && persistentRecord.expiresAt > now) {
      const isOfflineFallback = globalThis.navigator?.onLine === false;
      const metadata = {
        source: 'persistent-cache',
        fetchedAt: persistentRecord.fetchedAt,
        isStale: isOfflineFallback,
        isOfflineFallback,
        refreshFailed: false,
      };
      publishCatalogStatus(cacheKey, metadata);
      return { catalog: persistentRecord.catalog, metadata };
    }

    if (persistentRecord && !options.forceRefresh) {
      const metadata = {
        source: 'persistent-cache',
        fetchedAt: persistentRecord.fetchedAt,
        isStale: true,
        isOfflineFallback: globalThis.navigator?.onLine === false,
        refreshFailed: false,
      };
      publishCatalogStatus(cacheKey, metadata);
      setTimeout(() => {
        void loadItemsCatalog(safeGameMode, {
          language,
          priceMode: effectivePriceMode,
          timeoutMs: options.timeoutMs,
          forceRefresh: true,
        }).catch(() => {});
      }, 0);
      return { catalog: persistentRecord.catalog, metadata };
    }

    try {
      const source = await fetchCatalog(safeGameMode, language, signal, options.timeoutMs);
      const catalog = normalizeItemsCatalog(source.data, source.barters, source.traders, effectivePriceMode);
      const fetchedAt = Date.now();
      const metadata = {
        source: 'network',
        fetchedAt,
        isStale: false,
        isOfflineFallback: false,
        refreshFailed: false,
      };
      try {
        await writeCachedCatalog(cacheKey, catalog, {
          gameMode: safeGameMode,
          language,
          priceMode: effectivePriceMode,
          fetchedAt,
        });
      } catch (error) {
        if (import.meta.env?.DEV) console.warn('The catalog could not be persisted.', error);
      }
      publishCatalogStatus(cacheKey, metadata);
      return { catalog, metadata };
    } catch (error) {
      if (!persistentRecord || error?.code === 'ABORTED') throw error;
      const metadata = {
        source: 'persistent-cache',
        fetchedAt: persistentRecord.fetchedAt,
        isStale: true,
        isOfflineFallback: globalThis.navigator?.onLine === false,
        refreshFailed: true,
      };
      publishCatalogStatus(cacheKey, metadata);
      return { catalog: persistentRecord.catalog, metadata };
    }
  }, {
    ...options,
    onMemoryHit: entry => publishCatalogStatus(cacheKey, {
      ...(entry.metadata ?? catalogStatuses.get(cacheKey)),
      source: 'memory-cache',
    }),
  });
}

export async function getWeapons(options = {}) {
  const gameMode = options.gameMode === 'pve' || options.priceMode === 'pve'
    ? 'pve'
    : 'regular';
  const catalog = await loadItemsCatalog(gameMode, {
    ...options,
    priceMode: gameMode === 'pve' ? 'pve' : DEFAULT_PRICE_MODE,
  });
  return catalog.weapons;
}

export async function getAllMods(priceMode = DEFAULT_PRICE_MODE, options = {}) {
  const effectivePriceMode = getEffectivePriceMode(priceMode);
  const gameMode = getTarkovDevGameMode(effectivePriceMode);
  const catalog = await loadItemsCatalog(gameMode, {
    ...options,
    priceMode: effectivePriceMode,
  });
  return catalog.modsById;
}

export async function getWeaponDetails(id, priceMode = DEFAULT_PRICE_MODE, options = {}) {
  const effectivePriceMode = getEffectivePriceMode(priceMode);
  const gameMode = getTarkovDevGameMode(effectivePriceMode);
  const catalog = await loadItemsCatalog(gameMode, {
    ...options,
    priceMode: effectivePriceMode,
  });
  const item = Object.hasOwn(catalog.itemsById, id)
    ? catalog.itemsById[id]
    : null;

  if (!item) {
    throw new TarkovApiError('Tarkov.dev did not return the requested weapon.', {
      code: 'NOT_FOUND',
    });
  }
  return item;
}
