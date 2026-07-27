import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRADER_LEVELS_STORAGE_KEY,
  getTraderLevel,
  loadTraderLevels,
  normalizeTraderLevels,
  resetTraderLevels,
  saveTraderLevels,
  setTraderLevel,
} from '../../src/data/settings/traderLevels.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const traders = [
  { id: 'mechanic-id', name: 'Mechanic', maxLevel: 4 },
  { id: 'fence-id', name: 'Fence', maxLevel: 1 },
];

test('trader levels default to LL1 and persist by stable ID', () => {
  const storage = createStorage();
  let levels = loadTraderLevels(storage, traders);
  assert.equal(getTraderLevel('mechanic-id', 'pvp', levels), 1);

  levels = setTraderLevel('mechanic-id', 3, 'pvp', levels, traders);
  saveTraderLevels(levels, storage, traders);
  const restored = loadTraderLevels(storage, traders);

  assert.equal(getTraderLevel('mechanic-id', 'pvp', restored), 3);
  assert.equal(getTraderLevel('Mechanic', 'pvp', restored), 1);
});

test('PvP and PvE profiles remain independent and reset only the selected mode', () => {
  let levels = normalizeTraderLevels(null, traders);
  levels = setTraderLevel('mechanic-id', 2, 'pvp', levels, traders);
  levels = setTraderLevel('mechanic-id', 4, 'pve', levels, traders);
  levels = resetTraderLevels('pvp', levels, traders);

  assert.equal(getTraderLevel('mechanic-id', 'pvp', levels), 1);
  assert.equal(getTraderLevel('mechanic-id', 'pve', levels), 4);
});

test('corrupt, non-numeric, out-of-range and unknown values are normalized safely', () => {
  const corruptStorage = createStorage({ [TRADER_LEVELS_STORAGE_KEY]: '{broken' });
  assert.deepEqual(loadTraderLevels(corruptStorage, traders).profiles, { pvp: {}, pve: {} });

  const normalized = normalizeTraderLevels({
    profiles: {
      pvp: {
        'mechanic-id': 99,
        'fence-id': -4,
        unknown: 3,
        text: '3',
        nan: Number.NaN,
      },
      pve: {},
    },
  }, traders);

  assert.deepEqual(normalized.profiles.pvp, {
    'mechanic-id': 4,
    'fence-id': 1,
  });
});

test('new traders implicitly receive LL1', () => {
  const levels = normalizeTraderLevels({
    profiles: { pvp: { 'mechanic-id': 2 }, pve: {} },
  }, [...traders, { id: 'new-id', name: 'New trader', maxLevel: 4 }]);
  assert.equal(getTraderLevel('new-id', 'pvp', levels), 1);
});

