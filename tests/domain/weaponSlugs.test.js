import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWeaponSlugIndex,
  getLegacyConfigurePath,
  getWeaponPath,
  getWeaponSlugIndex,
  toWeaponSlug,
} from '../../src/domain/weaponSlugs.js';

test('a slug is the normalized name in lowercase with single dashes', () => {
  assert.equal(toWeaponSlug('colt-m4a1-556x45-assault-rifle'), 'colt-m4a1-556x45-assault-rifle');
  assert.equal(toWeaponSlug('  AK-74N  5.45x39 / Rifle '), 'ak-74n-5-45x39-rifle');
  assert.equal(toWeaponSlug(null), '');
});

test('each weapon gets its normalized name as the slug', () => {
  const { slugById, idBySlug } = createWeaponSlugIndex([
    { id: 'b', normalizedName: 'second-gun' },
    { id: 'a', normalizedName: 'first-gun' },
  ]);
  assert.equal(slugById.get('a'), 'first-gun');
  assert.equal(idBySlug.get('second-gun'), 'b');
});

test('colliding names get numbered suffixes in id order, whatever the list order', () => {
  const weapons = [
    { id: 'c', normalizedName: 'twin' },
    { id: 'a', normalizedName: 'twin' },
    { id: 'b', normalizedName: 'twin' },
  ];
  const forward = createWeaponSlugIndex(weapons);
  const reversed = createWeaponSlugIndex([...weapons].reverse());
  assert.deepEqual([...forward.slugById].sort(), [['a', 'twin'], ['b', 'twin-2'], ['c', 'twin-3']]);
  assert.deepEqual([...reversed.slugById].sort(), [...forward.slugById].sort());
});

test('a suffix never takes the plain slug of another weapon', () => {
  const { slugById } = createWeaponSlugIndex([
    { id: 'a', normalizedName: 'twin' },
    { id: 'b', normalizedName: 'twin' },
    { id: 'c', normalizedName: 'twin-2' },
  ]);
  assert.equal(slugById.get('c'), 'twin-2');
  assert.equal(slugById.get('b'), 'twin-3');
});

test('a weapon without a normalized name falls back to its id', () => {
  const { slugById } = createWeaponSlugIndex([{ id: '5447A9cd', normalizedName: '' }]);
  assert.equal(slugById.get('5447A9cd'), '5447a9cd');
});

test('the index is cached per weapons array', () => {
  const weapons = [{ id: 'a', normalizedName: 'gun' }];
  assert.equal(getWeaponSlugIndex(weapons), getWeaponSlugIndex(weapons));
});

test('weapon pages end with a slash; the old route keeps the id', () => {
  assert.equal(getWeaponPath('colt-m4a1'), '/weapon/colt-m4a1/');
  assert.equal(getLegacyConfigurePath('5447a9cd4bdc2dbd208b4567'), '/configure/5447a9cd4bdc2dbd208b4567');
});
