import {
  isValidCatalog,
  isValidCatalogCacheRecord,
  PERSISTENT_CACHE_FRESHNESS_MS,
  PERSISTENT_CACHE_SCHEMA_VERSION,
} from './catalogCacheSchema.js';

const DATABASE_NAME = 'tarkov-gun-helper';
const DATABASE_VERSION = 1;
const STORE_NAME = 'catalogs';

function getIndexedDb() {
  return globalThis.indexedDB;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
}

async function openDatabase() {
  const indexedDb = getIndexedDb();
  if (!indexedDb) throw new Error('IndexedDB is unavailable.');

  const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener('upgradeneeded', () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
    }
  }, { once: true });
  return requestAsPromise(request);
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const result = await operation(transaction.objectStore(STORE_NAME));
    await transactionDone(transaction);
    return result;
  } finally {
    database.close();
  }
}

export async function readCachedCatalog(cacheKey) {
  const record = await withStore('readonly', store => requestAsPromise(store.get(cacheKey)));
  return isValidCatalogCacheRecord(record, cacheKey) ? record : null;
}

export async function writeCachedCatalog(cacheKey, catalog, metadata) {
  if (!isValidCatalog(catalog)) throw new TypeError('Cannot cache an invalid catalog.');

  const fetchedAt = Number.isFinite(metadata?.fetchedAt) ? metadata.fetchedAt : Date.now();
  const record = {
    cacheKey,
    schemaVersion: PERSISTENT_CACHE_SCHEMA_VERSION,
    source: 'tarkov.dev',
    gameMode: metadata.gameMode,
    language: metadata.language,
    priceMode: metadata.priceMode,
    fetchedAt,
    expiresAt: fetchedAt + PERSISTENT_CACHE_FRESHNESS_MS,
    itemCount: Object.keys(catalog.itemsById).length,
    catalog,
  };

  const current = await readCachedCatalog(cacheKey);
  if (current?.fetchedAt > fetchedAt) return current;
  await withStore('readwrite', store => requestAsPromise(store.put(record)));
  return record;
}

export function deleteCachedCatalog(cacheKey) {
  return withStore('readwrite', store => requestAsPromise(store.delete(cacheKey)));
}

export function clearCatalogCache() {
  return withStore('readwrite', store => requestAsPromise(store.clear()));
}

export async function readCatalogCacheMetadata(cacheKey) {
  const record = await readCachedCatalog(cacheKey);
  if (!record) return null;
  const metadata = { ...record };
  delete metadata.catalog;
  return metadata;
}
