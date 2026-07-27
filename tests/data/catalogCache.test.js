import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import {
  clearCatalogCache,
  readCachedCatalog,
  readCatalogCacheMetadata,
  writeCachedCatalog,
} from '../../src/data/cache/catalogCache.js';
import {
  createCatalogCacheKey,
  PERSISTENT_CACHE_FRESHNESS_MS,
} from '../../src/data/cache/catalogCacheSchema.js';

const catalog = {
  weapons: [{ id: 'weapon' }],
  itemsById: { weapon: { id: 'weapon' } },
  modsById: {},
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  delete globalThis.indexedDB;
});

test('writes and reads a normalized catalog with metadata', async () => {
  const cacheKey = createCatalogCacheKey('regular', 'en');
  const fetchedAt = 1_000;
  await writeCachedCatalog(cacheKey, catalog, {
    gameMode: 'regular', language: 'en', priceMode: 'pvp', fetchedAt,
  });

  const record = await readCachedCatalog(cacheKey);
  assert.deepEqual(record.catalog, catalog);
  assert.equal(record.fetchedAt, fetchedAt);
  assert.equal(record.expiresAt, fetchedAt + PERSISTENT_CACHE_FRESHNESS_MS);
  assert.equal(record.itemCount, 1);
  assert.equal((await readCatalogCacheMetadata(cacheKey)).catalog, undefined);
});

test('keeps language, game mode, and schema entries separate', async () => {
  const keys = [
    createCatalogCacheKey('regular', 'en'),
    createCatalogCacheKey('regular', 'ru'),
    createCatalogCacheKey('pve', 'en'),
  ];
  await Promise.all(keys.map((cacheKey, index) => writeCachedCatalog(cacheKey, {
    ...catalog,
    weapons: [{ id: String(index) }],
  }, {
    gameMode: cacheKey.includes(':pve:') ? 'pve' : 'regular',
    language: cacheKey.includes(':ru:') ? 'ru' : 'en',
    priceMode: cacheKey.endsWith(':pve') ? 'pve' : 'pvp',
    fetchedAt: index,
  })));

  assert.deepEqual(await Promise.all(keys.map(key => readCachedCatalog(key)))
    .then(records => records.map(record => record.catalog.weapons[0].id)), ['0', '1', '2']);
});

test('ignores corrupted and incompatible records', async () => {
  const cacheKey = createCatalogCacheKey('regular', 'en');
  await writeCachedCatalog(cacheKey, catalog, {
    gameMode: 'regular', language: 'en', priceMode: 'pvp', fetchedAt: 1,
  });

  const request = indexedDB.open('tarkov-gun-helper', 1);
  const database = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction('catalogs', 'readwrite');
  transaction.objectStore('catalogs').put({ cacheKey, schemaVersion: 999 });
  await new Promise(resolve => { transaction.oncomplete = resolve; });
  database.close();

  assert.equal(await readCachedCatalog(cacheKey), null);
});

test('persistent entries can only be cleared explicitly', async () => {
  const cacheKey = createCatalogCacheKey('regular', 'en');
  await writeCachedCatalog(cacheKey, catalog, {
    gameMode: 'regular', language: 'en', priceMode: 'pvp', fetchedAt: 1,
  });
  await clearCatalogCache();
  assert.equal(await readCachedCatalog(cacheKey), null);
});
