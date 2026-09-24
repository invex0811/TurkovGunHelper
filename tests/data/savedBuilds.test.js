import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SAVED_BUILDS,
  SAVED_BUILDS_STORAGE_KEY,
  SavedBuildStorageError,
  createBuildSnapshot,
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
    stats: { ergonomics: 60, recoilModifier: -20.4, recoilVertical: 42, recoilHorizontal: 120, weight: 4.2, price: 120000 },
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
  assert.equal(getSavedBuild('build-1', storage)?.stats.recoilModifier, -20.4);

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

test('saved builds preserve strictTraderLevels and default legacy snapshots to false', () => {
  const storage = createStorage();
  saveBuildSnapshot(createSnapshot({
    settings: {
      targetType: 'meta',
      priceMode: 'pvp',
      strictTraderLevels: true,
    },
  }), storage, { id: 'strict-levels' });

  assert.equal(getSavedBuild('strict-levels', storage).settings.strictTraderLevels, true);

  const oldStorage = createStorage();
  saveBuildSnapshot(createSnapshot(), oldStorage, { id: 'legacy-levels' });
  assert.equal(getSavedBuild('legacy-levels', oldStorage).settings.strictTraderLevels, false);
});

test('saved builds preserve includeRefOffers and default legacy snapshots to true', () => {
  const storage = createStorage();
  saveBuildSnapshot(createSnapshot({
    settings: {
      targetType: 'meta',
      priceMode: 'pvp',
      includeRefOffers: false,
    },
  }), storage, { id: 'no-ref' });

  assert.equal(getSavedBuild('no-ref', storage).settings.includeRefOffers, false);

  const oldStorage = createStorage();
  saveBuildSnapshot(createSnapshot(), oldStorage, { id: 'legacy-ref' });
  assert.equal(getSavedBuild('legacy-ref', oldStorage).settings.includeRefOffers, true);
});

test('saved builds keep their own price mode', () => {
  const storage = createStorage();
  saveBuildSnapshot(createSnapshot({
    settings: { targetType: 'meta', priceMode: 'pvp' },
  }), storage, { id: 'pvp-build' });
  saveBuildSnapshot(createSnapshot({
    settings: { targetType: 'meta', priceMode: 'pve' },
  }), storage, { id: 'pve-build' });

  assert.equal(getSavedBuild('pvp-build', storage).settings.priceMode, 'pvp');
  assert.equal(getSavedBuild('pve-build', storage).settings.priceMode, 'pve');
});

test('saved builds preserve a trader level snapshot without changing global settings', () => {
  const storage = createStorage();
  saveBuildSnapshot(createSnapshot({
    settings: {
      targetType: 'meta',
      priceMode: 'pvp',
      includeTraderPrices: true,
      traderLevelsSnapshot: { 'mechanic-id': 3 },
    },
  }), storage, { id: 'trader-snapshot' });

  assert.deepEqual(
    getSavedBuild('trader-snapshot', storage).settings.traderLevelsSnapshot,
    { 'mechanic-id': 3 },
  );
});

test('saved builds preserve owned item occurrences independently', () => {
  const storage = createStorage();
  const ownedItems = [
    { key: 'weapon:weapon-1', itemId: 'weapon-1' },
    { key: 'weapon:weapon-1/slot:mod_mount_3A1/item:part-1', itemId: 'part-1' },
  ];
  saveBuildSnapshot(createSnapshot({ ownedItems }), storage, { id: 'owned-items' });

  assert.deepEqual(getSavedBuild('owned-items', storage).ownedItems, ownedItems);
});

test('saved builds migrate legacy Custom prices to one shared limit without a schema bump', () => {
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
  const priorityAttributes = [
    'weight',
    'ergonomics',
    'weight',
    'price',
    'verticalRecoil',
    'horizontalRecoil',
  ];

  saveBuildSnapshot(createSnapshot({
    settings: {
      targetType: 'custom',
      priceMode: 'pvp',
      customProfile,
      customExactTargets,
      characteristicMode: 'priorities',
      priorityAttributes,
      prioritySelectionMode: 'weighted',
      priorityWeights: { recoil: '80', ergonomics: Number.POSITIVE_INFINITY, weight: -1 },
      priorityMaxPrice: '250000',
      customErgo: customProfile.ergonomics,
      customRecoil: customProfile.verticalRecoil,
      maxWeight: customProfile.weight,
      maxPrice: customProfile.price,
    },
  }), storage, { id: 'custom-radar' });

  const restored = getSavedBuild('custom-radar', storage);
  assert.equal(restored.version, 1);
  assert.deepEqual(restored.settings.customProfile, customProfile);
  assert.equal(Object.hasOwn(restored.settings, 'customExactTargets'), false);
  assert.equal(restored.settings.characteristicMode, 'priorities');
  assert.deepEqual(restored.settings.priorityAttributes, [
    'weight',
    'ergonomics',
    'recoil',
  ]);
  assert.equal(restored.settings.prioritySelectionMode, 'weighted');
  assert.deepEqual(restored.settings.priorityWeights, { recoil: 80, ergonomics: 30, weight: 0 });
  assert.equal(restored.settings.sharedMaxPrice, 70_000);
  assert.equal(restored.settings.maxPrice, 70_000);
  assert.equal(restored.settings.priorityMaxPrice, 70_000);
  assert.equal(restored.settings.customErgo, 62);
  assert.equal(restored.settings.customRecoil, 74);
});

test('old saved builds receive current constraint and priority defaults', () => {
  const storage = createStorage();
  saveBuildSnapshot(createSnapshot(), storage, { id: 'legacy-defaults' });

  assert.equal(Object.hasOwn(getSavedBuild('legacy-defaults', storage).settings, 'customExactTargets'), false);
  assert.deepEqual(getSavedBuild('legacy-defaults', storage).settings.priorityAttributes, []);
  assert.equal(getSavedBuild('legacy-defaults', storage).settings.characteristicMode, 'constraints');
  assert.equal(getSavedBuild('legacy-defaults', storage).settings.prioritySelectionMode, 'ordered');
  assert.deepEqual(getSavedBuild('legacy-defaults', storage).settings.priorityWeights, {
    recoil: 50, ergonomics: 30, weight: 20,
  });
  assert.equal(getSavedBuild('legacy-defaults', storage).settings.sharedMaxPrice, 0);
  assert.equal(getSavedBuild('legacy-defaults', storage).settings.priorityMaxPrice, 0);
});

test('legacy stored builds load without locks and discard the field on the next save', () => {
  const storage = createStorage();
  const legacy = {
    ...createSnapshot(),
    version: 1,
    id: 'legacy-locks',
    settings: {
      targetType: 'custom',
      customProfile: { ergonomics: 50, verticalRecoil: 80, horizontalRecoil: 150, weight: 4 },
      customExactTargets: { ergonomics: true, weight: true },
    },
  };
  storage.setItem(SAVED_BUILDS_STORAGE_KEY, JSON.stringify([legacy]));

  const restored = getSavedBuild(legacy.id, storage);
  assert.equal(restored.id, legacy.id);
  assert.deepEqual(restored.settings.customProfile, { ...legacy.settings.customProfile, price: 0 });
  assert.equal(Object.hasOwn(restored.settings, 'customExactTargets'), false);
  const saved = saveBuildSnapshot(restored, storage);
  assert.equal(Object.hasOwn(saved.settings, 'customExactTargets'), false);
  assert.equal(storage.getItem(SAVED_BUILDS_STORAGE_KEY).includes('customExactTargets'), false);
});

test('new snapshots and batch saves omit legacy locks without mutating their input', () => {
  const settings = {
    targetType: 'custom',
    customExactTargets: { weight: true },
  };
  const source = createSnapshot({ settings });
  const snapshot = createBuildSnapshot({
    weapon: { ...source.weapon, properties: { slots: [] } },
    buildResult: { build: [], stats: source.stats },
    settings,
  });
  assert.equal(Object.hasOwn(snapshot.settings, 'customExactTargets'), false);

  const storage = createStorage();
  const result = importSavedBuildSnapshots([
    { snapshot: source, status: 'ready', strategy: 'copy' },
  ], storage);
  assert.equal(Object.hasOwn(result.imported[0].settings, 'customExactTargets'), false);
  assert.equal(storage.getItem(SAVED_BUILDS_STORAGE_KEY).includes('customExactTargets'), false);
  assert.deepEqual(settings.customExactTargets, { weight: true });
});

test('legacy priority-only budgets migrate when the old constraint budget was unlimited', () => {
  const storage = createStorage();
  saveBuildSnapshot(createSnapshot({
    settings: {
      targetType: 'custom',
      characteristicMode: 'priorities',
      customProfile: { ergonomics: 50, verticalRecoil: 50, horizontalRecoil: 50, weight: 0, price: 0 },
      priorityMaxPrice: 250_000,
    },
  }), storage, { id: 'legacy-priority-budget' });

  const settings = getSavedBuild('legacy-priority-budget', storage).settings;
  assert.equal(settings.sharedMaxPrice, 250_000);
  assert.equal(settings.customProfile.price, 250_000);
  assert.equal(settings.maxPrice, 250_000);
  assert.equal(settings.priorityMaxPrice, 250_000);
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
