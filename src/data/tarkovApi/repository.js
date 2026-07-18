import { DEFAULT_PRICE_MODE } from '../price/priceModes.js';
import { normalizeItemPriceFields } from '../price/priceMapper.js';
import {
  getEffectivePriceMode,
  getTarkovDevGameMode,
} from '../price/priceProvider.js';
import { fetchGraphQL, TarkovApiError } from './client.js';
import {
  GET_ALL_MODS_QUERY,
  GET_WEAPONS_QUERY,
  GET_WEAPON_DETAILS_QUERY,
} from './queries.js';

export const TARKOV_API_CACHE_TTL_MS = 5 * 60 * 1000;

const cachedResources = new Map();

function createAbortedRequestError(cause) {
  return new TarkovApiError('The Tarkov.dev request was cancelled.', {
    code: 'ABORTED',
    cause,
  });
}

function awaitWithSignal(promise, signal) {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(createAbortedRequestError(signal.reason));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      signal.removeEventListener('abort', abortRequest);
      callback(value);
    };

    const abortRequest = () => settle(reject, createAbortedRequestError(signal.reason));

    signal.addEventListener('abort', abortRequest, { once: true });
    promise.then(
      value => settle(resolve, value),
      error => settle(reject, error),
    );
  });
}

function subscribeToRequest(cacheKey, entry, signal) {
  if (signal?.aborted) {
    return Promise.reject(createAbortedRequestError(signal.reason));
  }

  entry.activeConsumers += 1;

  return new Promise((resolve, reject) => {
    let settled = false;

    const release = () => {
      entry.activeConsumers -= 1;

      if (entry.activeConsumers === 0 && entry.promise && !entry.controller.signal.aborted) {
        if (cachedResources.get(cacheKey) === entry) {
          cachedResources.delete(cacheKey);
        }

        entry.controller.abort();
      }
    };

    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      signal?.removeEventListener('abort', abortRequest);
      release();
      callback(value);
    };

    const abortRequest = () => settle(reject, createAbortedRequestError(signal.reason));

    signal?.addEventListener('abort', abortRequest, { once: true });
    entry.promise.then(
      value => settle(resolve, value),
      error => settle(reject, error),
    );
  });
}

function getCachedResource(cacheKey, load, options = {}) {
  const { forceRefresh = false, signal } = options;

  if (signal?.aborted) {
    return Promise.reject(createAbortedRequestError(signal.reason));
  }

  const cachedEntry = cachedResources.get(cacheKey);

  if (cachedEntry?.promise) {
    return subscribeToRequest(cacheKey, cachedEntry, signal);
  }

  if (!forceRefresh && cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return awaitWithSignal(Promise.resolve(cachedEntry.value), signal);
  }

  const entry = {
    activeConsumers: 0,
    controller: new AbortController(),
  };
  const requestPromise = Promise.resolve()
    .then(() => load(entry.controller.signal))
    .then(
      value => {
        if (cachedResources.get(cacheKey) === entry) {
          entry.value = value;
          entry.expiresAt = Date.now() + TARKOV_API_CACHE_TTL_MS;
          delete entry.promise;
        }

        return value;
      },
      error => {
        if (cachedResources.get(cacheKey) === entry) {
          cachedResources.delete(cacheKey);
        }

        throw error;
      },
    );

  entry.promise = requestPromise;
  cachedResources.set(cacheKey, entry);

  return subscribeToRequest(cacheKey, entry, signal);
}

function getItems(data, operation) {
  if (!Array.isArray(data?.items)) {
    throw new TarkovApiError(
      `Tarkov.dev returned invalid ${operation} data.`,
      { code: 'INVALID_RESPONSE' },
    );
  }

  return data.items;
}

function getRequestOptions({ timeoutMs } = {}) {
  return { timeoutMs };
}

export function clearTarkovApiCache() {
  cachedResources.clear();
}

export async function getWeapons(options = {}) {
  return getCachedResource(
    'weapons',
    async signal => {
      const data = await fetchGraphQL(GET_WEAPONS_QUERY, {}, {
        signal,
        ...getRequestOptions(options),
      });
      return getItems(data, 'weapon list').filter(item => item?.name && item.shortName);
    },
    options,
  );
}

export async function getAllMods(priceMode = DEFAULT_PRICE_MODE, options = {}) {
  const effectivePriceMode = getEffectivePriceMode(priceMode);

  return getCachedResource(
    `mods:${effectivePriceMode}`,
    async signal => {
      const gameMode = getTarkovDevGameMode(effectivePriceMode);
      const data = await fetchGraphQL(
        GET_ALL_MODS_QUERY,
        { gameMode },
        { signal, ...getRequestOptions(options) },
      );
      const modMap = {};

      getItems(data, 'mod list').forEach(item => {
        if (!item?.id) {
          return;
        }

        const normalizedItem = normalizeItemPriceFields(item, effectivePriceMode);
        modMap[normalizedItem.id] = normalizedItem;
      });

      return modMap;
    },
    options,
  );
}

export async function getWeaponDetails(id, priceMode = DEFAULT_PRICE_MODE, options = {}) {
  const effectivePriceMode = getEffectivePriceMode(priceMode);
  const gameMode = getTarkovDevGameMode(effectivePriceMode);

  const data = await fetchGraphQL(
    GET_WEAPON_DETAILS_QUERY,
    { id, gameMode },
    { signal: options.signal, ...getRequestOptions(options) },
  );

  if (!data?.item || typeof data.item !== 'object') {
    throw new TarkovApiError('Tarkov.dev did not return the requested weapon.', {
      code: 'NOT_FOUND',
    });
  }

  return normalizeItemPriceFields(data.item, effectivePriceMode);
}
