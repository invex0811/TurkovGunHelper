import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterHomeWeapons,
  formatCaliberLabel,
  getHomeWeaponFilterOptions,
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
