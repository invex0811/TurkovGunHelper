import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SAVED_BUILDS,
  SAVED_BUILDS_STORAGE_KEY,
  SavedBuildStorageError,
  deleteSavedBuild,
  getSavedBuild,
  readSavedBuilds,
  restoreBuildParts,
  saveBuildSnapshot,
} from '../../src/data/savedBuilds.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function createSnapshot(overrides = {}) {
  return {
    name: 'M4A1 Meta',
    weapon: { id: 'weapon-1', name: 'M4A1', shortName: 'M4A1', imageUrl: '' },
    parts: [{ itemId: 'part-1', itemName: 'Stock', slotName: 'Stock' }],
    stats: { ergonomics: 60, recoilVertical: 42, recoilHorizontal: 120, weight: 4.2, price: 120000 },
    settings: { targetType: 'meta', priceMode: 'pvp' },
    ...overrides,
  };
}

test('saved builds can be created, updated, read, and deleted', () => {
  const storage = createStorage();
  const created = saveBuildSnapshot(createSnapshot(), storage, {
    id: 'build-1',
    now: '2026-07-11T10:00:00.000Z',
  });

  assert.equal(getSavedBuild('build-1', storage)?.name, 'M4A1 Meta');

  const updated = saveBuildSnapshot({ ...created, name: 'Updated build' }, storage, {
    now: '2026-07-11T11:00:00.000Z',
  });

  assert.equal(readSavedBuilds(storage).length, 1);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, '2026-07-11T11:00:00.000Z');
  assert.equal(deleteSavedBuild('build-1', storage), true);
  assert.deepEqual(readSavedBuilds(storage), []);
});

test('invalid local storage data is ignored safely', () => {
  const storage = createStorage();
  storage.setItem(SAVED_BUILDS_STORAGE_KEY, '{not-json');
  assert.deepEqual(readSavedBuilds(storage), []);
});

test('saved build limit prevents local storage from growing without bounds', () => {
  const storage = createStorage();
  for (let index = 0; index < MAX_SAVED_BUILDS; index += 1) {
    saveBuildSnapshot(createSnapshot(), storage, { id: `build-${index}` });
  }

  assert.throws(
    () => saveBuildSnapshot(createSnapshot(), storage, { id: 'one-too-many' }),
    error => error instanceof SavedBuildStorageError && error.code === 'LIMIT_REACHED',
  );
});

test('restoreBuildParts reports modules that are no longer available', () => {
  const savedBuild = createSnapshot({
    parts: [
      { itemId: 'part-1', itemName: 'Stock', slotName: 'Stock' },
      { itemId: 'missing', itemName: 'Old sight', slotName: 'Sight' },
    ],
  });
  const part = { id: 'part-1', shortName: 'Stock' };

  assert.deepEqual(restoreBuildParts(savedBuild, { [part.id]: part }), {
    build: [{ slotName: 'Stock', item: part }],
    missingItemIds: ['missing'],
  });
});

test('saved builds preserve includeTraderPrices and default old snapshots to true', () => {
  const storage = createStorage();
  saveBuildSnapshot(createSnapshot({
    settings: {
      targetType: 'meta',
      priceMode: 'pvp',
      includeTraderPrices: false,
    },
  }), storage, { id: 'flea-only' });

  assert.equal(getSavedBuild('flea-only', storage).settings.includeTraderPrices, false);

  const oldStorage = createStorage();
  saveBuildSnapshot(createSnapshot(), oldStorage, { id: 'legacy' });
  assert.equal(getSavedBuild('legacy', oldStorage).settings.includeTraderPrices, true);
});
