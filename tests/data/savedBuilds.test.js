import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SAVED_BUILDS,
  SAVED_BUILDS_STORAGE_KEY,
  SavedBuildStorageError,
  deleteSavedBuild,
  getSavedBuild,
  importSavedBuildSnapshots,
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

test('restoreBuildParts preserves optional slot instance metadata', () => {
  const part = { id: 'part-1', shortName: 'Rail' };
  const savedBuild = createSnapshot({
    parts: [{
      itemId: part.id,
      itemName: part.shortName,
      slotName: 'Mount',
      slotId: 'mod_mount:1',
      slotIndex: 1,
      slotInstanceId: 'weapon:one/slot:mod_mount_3A1',
      parentItemId: 'weapon-1',
      parentInstanceId: 'weapon:one',
    }],
  });

  assert.deepEqual(restoreBuildParts(savedBuild, { [part.id]: part }).build[0], {
    slotName: 'Mount',
    slotId: 'mod_mount:1',
    slotIndex: 1,
    slotInstanceId: 'weapon:one/slot:mod_mount_3A1',
    parentItemId: 'weapon-1',
    parentInstanceId: 'weapon:one',
    item: part,
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

test('saved builds preserve the new Custom radar profile without a schema bump', () => {
  const storage = createStorage();
  const customProfile = {
    ergonomics: 62,
    verticalRecoil: 74,
    horizontalRecoil: 188,
    weight: 4.25,
    price: 70_000,
  };
  const customExactTargets = {
    ergonomics: true,
    verticalRecoil: false,
    horizontalRecoil: true,
    weight: false,
    price: true,
  };

  saveBuildSnapshot(createSnapshot({
    settings: {
      targetType: 'custom',
      priceMode: 'pvp',
      customProfile,
      customExactTargets,
      customErgo: customProfile.ergonomics,
      customRecoil: customProfile.verticalRecoil,
      maxWeight: customProfile.weight,
      maxPrice: customProfile.price,
    },
  }), storage, { id: 'custom-radar' });

  const restored = getSavedBuild('custom-radar', storage);
  assert.equal(restored.version, 1);
  assert.deepEqual(restored.settings.customProfile, customProfile);
  assert.deepEqual(restored.settings.customExactTargets, customExactTargets);
  assert.equal(restored.settings.customErgo, 62);
  assert.equal(restored.settings.customRecoil, 74);
});

test('old saved builds default every Custom Exact target to disabled', () => {
  const storage = createStorage();
  saveBuildSnapshot(createSnapshot(), storage, { id: 'before-exact-targets' });

  assert.deepEqual(getSavedBuild('before-exact-targets', storage).settings.customExactTargets, {
    ergonomics: false,
    verticalRecoil: false,
    horizontalRecoil: false,
    weight: false,
    price: false,
  });
});

test('batch import skip does not add a duplicate', () => {
  const storage = createStorage();
  const existing = saveBuildSnapshot(createSnapshot(), storage, { id: 'existing' });
  const result = importSavedBuildSnapshots([{
    snapshot: createSnapshot(),
    status: 'duplicate',
    strategy: 'skip',
    duplicateOf: existing,
  }], storage);
  assert.equal(result.imported.length, 0);
  assert.equal(readSavedBuilds(storage).length, 1);
});

test('batch import copy creates a fresh ID and unique name', () => {
  const storage = createStorage();
  saveBuildSnapshot(createSnapshot(), storage, { id: 'existing' });
  const result = importSavedBuildSnapshots([{
    snapshot: createSnapshot(),
    status: 'duplicate',
    strategy: 'copy',
  }], storage, { now: '2026-07-21T10:00:00.000Z' });
  assert.notEqual(result.imported[0].id, 'existing');
  assert.equal(result.imported[0].name, 'M4A1 Meta Copy');
});

test('batch import replace changes only the selected duplicate', () => {
  const storage = createStorage();
  const first = saveBuildSnapshot(createSnapshot(), storage, { id: 'first' });
  saveBuildSnapshot(createSnapshot({ name: 'Keep me', weapon: { id: 'weapon-2', name: 'AK', shortName: 'AK' } }), storage, { id: 'second' });
  importSavedBuildSnapshots([{
    snapshot: createSnapshot({ name: 'Replacement' }),
    status: 'duplicate',
    strategy: 'replace',
    duplicateOf: first,
  }], storage, { now: '2026-07-21T10:00:00.000Z' });
  assert.equal(getSavedBuild('first', storage).name, 'Replacement');
  assert.equal(getSavedBuild('second', storage).name, 'Keep me');
});

test('batch import validates everything before one atomic write', () => {
  const storage = createStorage();
  saveBuildSnapshot(createSnapshot(), storage, { id: 'existing' });
  let writes = 0;
  const trackingStorage = {
    getItem: storage.getItem,
    setItem(key, value) { writes += 1; storage.setItem(key, value); },
  };
  importSavedBuildSnapshots([
    { snapshot: createSnapshot({ name: 'One' }), status: 'ready', strategy: 'copy' },
    { snapshot: createSnapshot({ name: 'Two' }), status: 'ready', strategy: 'copy' },
  ], trackingStorage);
  assert.equal(writes, 1);
  assert.equal(readSavedBuilds(storage).length, 3);
});
