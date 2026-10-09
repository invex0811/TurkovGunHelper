import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FAVORITE_WEAPONS_STORAGE_KEY,
  loadFavoriteWeaponIds,
  normalizeFavoriteWeaponIds,
  saveFavoriteWeaponIds,
  toggleFavoriteWeaponId,
} from '../../src/data/settings/favoriteWeapons.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

test('favorite weapons round-trip through storage', () => {
  const storage = createStorage();

  saveFavoriteWeaponIds(['m4a1', 'ak-74n'], storage);

  assert.equal(storage.values.get(FAVORITE_WEAPONS_STORAGE_KEY), '["m4a1","ak-74n"]');
  assert.deepEqual(loadFavoriteWeaponIds(storage), ['m4a1', 'ak-74n']);
});

test('missing or broken stored favorites load as an empty list', () => {
  assert.deepEqual(loadFavoriteWeaponIds(createStorage()), []);
  assert.deepEqual(loadFavoriteWeaponIds(createStorage({ [FAVORITE_WEAPONS_STORAGE_KEY]: '{oops' })), []);
  assert.deepEqual(loadFavoriteWeaponIds(createStorage({ [FAVORITE_WEAPONS_STORAGE_KEY]: '{"id":"m4a1"}' })), []);
  assert.deepEqual(loadFavoriteWeaponIds(null), []);
});

test('stored favorites keep unique weapon ids only', () => {
  assert.deepEqual(normalizeFavoriteWeaponIds(['m4a1', 'm4a1', '', 7, null, ' ', 'ak-74n']), ['m4a1', 'ak-74n']);
});

test('a storage error does not break saving favorites', () => {
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
  };

  assert.doesNotThrow(() => saveFavoriteWeaponIds(['m4a1'], storage));
});

test('toggling adds a weapon to the end and removes it again', () => {
  const added = toggleFavoriteWeaponId(['ak-74n'], 'm4a1');

  assert.deepEqual(added, ['ak-74n', 'm4a1']);
  assert.deepEqual(toggleFavoriteWeaponId(added, 'ak-74n'), ['m4a1']);
  assert.deepEqual(toggleFavoriteWeaponId(added, ''), added);
});
