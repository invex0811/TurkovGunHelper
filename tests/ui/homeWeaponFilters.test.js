import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterHomeWeapons,
  formatCaliberLabel,
  getHomeTypeFilterPath,
  getHomeWeaponFilterOptions,
  getWeaponTypeLabel,
  sortHomeWeapons,
} from '../../src/pages/homeWeaponFilters.js';

const weapons = [
  {
    name: 'AK-74N assault rifle',
    shortName: 'AK-74N',
    categories: [{ name: 'Weapon' }, { name: 'Assault rifle' }],
    properties: { caliber: 'Caliber545x39' },
  },
  {
    name: 'M4A1 assault rifle',
    shortName: 'M4A1',
    categories: [{ name: 'Assault rifle' }],
    properties: { caliber: 'Caliber556x45NATO' },
  },
  {
    name: 'MP-153 shotgun',
    shortName: 'MP-153',
    categories: [{ name: 'Shotgun' }, { name: 'Item' }],
    properties: {},
  },
];

test('filters by combined trimmed search, type, and caliber', () => {
  assert.deepEqual(
    filterHomeWeapons(weapons, { search: ' ak-74 ', type: 'Assault rifle', caliber: 'Caliber545x39' }),
    [weapons[0]],
  );
});

test('All filters retain every weapon, including weapons without a caliber', () => {
  assert.deepEqual(filterHomeWeapons(weapons), weapons);
  assert.deepEqual(filterHomeWeapons(weapons, { caliber: 'Caliber545x39' }), [weapons[0]]);
});

test('builds deduplicated sorted type and caliber options', () => {
  assert.deepEqual(getHomeWeaponFilterOptions(weapons), {
    types: ['Assault rifle', 'Shotgun'],
    calibers: ['Caliber545x39', 'Caliber556x45NATO'],
    traders: [],
  });
});

test('excludes generic category labels using stable category metadata across locales', () => {
  const localizedWeapons = [{
    name: 'AK-74N',
    shortName: 'AK-74N',
    categories: [
      { id: 'weapon-category', name: 'Оружие', normalizedName: 'weapon' },
      { id: 'assault-rifle-category', name: 'Штурмовая винтовка', normalizedName: 'assault-rifle' },
      { id: 'item-category', name: 'Предмет', normalizedName: 'item' },
    ],
    properties: { caliber: 'Caliber545x39' },
  }];

  assert.deepEqual(getHomeWeaponFilterOptions(localizedWeapons), {
    types: ['Штурмовая винтовка'],
    calibers: ['Caliber545x39'],
    traders: [],
  });
});

test('formats raw Tarkov caliber enum keys into readable labels without changing their keys', () => {
  assert.equal(formatCaliberLabel('Caliber545x39'), '5.45x39');
  assert.equal(formatCaliberLabel('Caliber556x45NATO'), '5.56x45 NATO');
  assert.equal(formatCaliberLabel('Caliber1143x23ACP'), '11.43x23 ACP');
  assert.equal(formatCaliberLabel('Caliber762x54R'), '7.62x54R');
  assert.equal(formatCaliberLabel('Caliber366TKM'), '.366 TKM');
  assert.equal(formatCaliberLabel('Caliber725'), '72.5mm');
  assert.equal(formatCaliberLabel('Caliber20x1mm'), '20x1mm');
  assert.equal(formatCaliberLabel('Caliber784x49'), '7.84x49');
  assert.equal(formatCaliberLabel('Caliber93x64'), '9.3x64');
  assert.equal(formatCaliberLabel('Caliber12g'), '12ga');
  assert.equal(formatCaliberLabel('Caliber20g'), '20ga');
});

test('search also matches the raw and readable caliber', () => {
  assert.deepEqual(filterHomeWeapons(weapons, { search: '5.45' }), [weapons[0]]);
  assert.deepEqual(filterHomeWeapons(weapons, { search: '556x45' }), [weapons[1]]);
});

test('returns the first specific weapon type label', () => {
  assert.equal(getWeaponTypeLabel(weapons[0]), 'Assault rifle');
  assert.equal(getWeaponTypeLabel(weapons[2]), 'Shotgun');
  assert.equal(getWeaponTypeLabel({ categories: [{ name: 'Weapon' }] }), '');
  assert.equal(getWeaponTypeLabel({
    categories: [{ name: 'Compound item', normalizedName: 'compound-item' }, { name: 'Grenade launcher' }],
  }), 'Grenade launcher');
});

test('lists traders once and filters weapons sold by a trader', () => {
  const sold = [
    { ...weapons[0], buyFor: [{ vendor: { normalizedName: 'prapor', name: 'Prapor' } }] },
    { ...weapons[1], buyFor: [{ vendor: { normalizedName: 'peacekeeper', name: 'Peacekeeper' } }, { vendor: { normalizedName: 'prapor', name: 'Prapor' } }] },
    weapons[2],
  ];
  assert.deepEqual(getHomeWeaponFilterOptions(sold).traders, [
    { id: 'peacekeeper', name: 'Peacekeeper' },
    { id: 'prapor', name: 'Prapor' },
  ]);
  assert.deepEqual(filterHomeWeapons(sold, { trader: 'peacekeeper' }), [sold[1]]);
  assert.deepEqual(filterHomeWeapons(sold, { trader: 'prapor' }), [sold[0], sold[1]]);
});

test('sorts by name, price, ergonomics and recoil with missing values last', () => {
  const list = [
    { shortName: 'B', properties: { ergonomics: 40, recoilVertical: 90 }, price: 300 },
    { shortName: 'A', properties: { ergonomics: 55, recoilVertical: 120 }, price: Number.NaN },
    { shortName: 'C', properties: {}, price: 100 },
  ];
  const names = items => items.map(item => item.shortName);
  const getPrice = item => item.price;
  assert.deepEqual(names(sortHomeWeapons(list, 'name', getPrice)), ['A', 'B', 'C']);
  assert.deepEqual(names(sortHomeWeapons(list, 'price', getPrice)), ['C', 'B', 'A']);
  assert.deepEqual(names(sortHomeWeapons(list, 'ergonomics', getPrice)), ['A', 'B', 'C']);
  assert.deepEqual(names(sortHomeWeapons(list, 'recoil', getPrice)), ['B', 'A', 'C']);
});

test('favorite weapons come first, each group in the selected order', () => {
  const list = [
    { id: 'b', shortName: 'B', price: 300 },
    { id: 'a', shortName: 'A', price: 200 },
    { id: 'd', shortName: 'D', price: 100 },
    { id: 'c', shortName: 'C', price: 400 },
  ];
  const names = items => items.map(item => item.shortName);
  const getPrice = item => item.price;
  const isFavorite = id => id === 'c' || id === 'd';

  assert.deepEqual(names(sortHomeWeapons(list, 'name', getPrice, isFavorite)), ['C', 'D', 'A', 'B']);
  assert.deepEqual(names(sortHomeWeapons(list, 'price', getPrice, isFavorite)), ['D', 'C', 'A', 'B']);
});

test('the favorites filter keeps only favorite weapons', () => {
  const list = weapons.map((weapon, index) => ({ ...weapon, id: `weapon-${index}` }));
  const isFavorite = id => id === 'weapon-1';

  assert.deepEqual(filterHomeWeapons(list, { favoritesOnly: true, isFavorite }), [list[1]]);
  assert.deepEqual(filterHomeWeapons(list, { favoritesOnly: false, isFavorite }), list);
  assert.deepEqual(filterHomeWeapons(list, { favoritesOnly: true }), []);
});

test('builds a catalog link narrowed to one weapon type', () => {
  assert.equal(getHomeTypeFilterPath('Assault rifle'), '/?type=Assault+rifle');
  assert.equal(
    new URLSearchParams(getHomeTypeFilterPath('Штурм. винтовка').slice(2)).get('type'),
    'Штурм. винтовка',
  );
  assert.equal(getHomeTypeFilterPath(''), '/');
});
