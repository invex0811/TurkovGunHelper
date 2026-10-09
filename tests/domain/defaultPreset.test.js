import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeItemPriceFields } from '../../src/data/price/priceMapper.js';
import { PRICE_MODES } from '../../src/data/price/priceModes.js';
import { calculateBestBuild } from '../../src/domain/calculator.js';
import {
  assembleDefaultPresetBuild,
  getDefaultPresetFallbackItemIds,
  getDefaultPresetFallbackSteps,
  getDefaultPresetModuleIds,
} from '../../src/domain/defaultPreset.js';
import { buildWeaponAssemblyTree } from '../../src/domain/weaponAssembly.js';

const PRAPOR_ID = 'prapor-id';
const LL1 = { [PRAPOR_ID]: 1 };
const NO_FLEA_LL1 = {
  priceMode: PRICE_MODES.PVP,
  includeTraderPrices: true,
  includeFleaMarket: false,
  traderLevels: LL1,
};

function trader(priceRUB, minTraderLevel = 1) {
  return {
    price: priceRUB,
    priceRUB,
    currency: 'RUB',
    vendor: {
      __typename: 'TraderOffer',
      id: PRAPOR_ID,
      name: 'Prapor',
      normalizedName: 'prapor',
      minTraderLevel,
      taskUnlock: null,
    },
  };
}

function slot(nameId, allowedIds, required = false) {
  return {
    name: nameId.toUpperCase(),
    nameId,
    required,
    filters: { allowedItems: allowedIds.map(id => ({ id })) },
  };
}

function item(id, { slots = [], ergonomics = 0, traderLevel = 1 } = {}) {
  return normalizeItemPriceFields({
    id,
    name: id,
    shortName: id,
    weight: 0.1,
    ergonomicsModifier: ergonomics,
    recoilModifier: 0,
    conflictingItems: [],
    categories: [{ name: 'Test Mod' }],
    properties: { slots },
    buyFor: [trader(1_000, traderLevel)],
    bartersFor: [],
  }, PRICE_MODES.PVP);
}

// A small M4A1: grip and required receiver on the weapon, required barrel and
// an optional handguard on the receiver. Receivers are sold only at LL4.
function createRifle({ barrelTraderLevel = 1 } = {}) {
  const mods = {
    grip: item('grip', { ergonomics: 1 }),
    'other-grip': item('other-grip', { ergonomics: 10 }),
    receiver: item('receiver', {
      traderLevel: 4,
      slots: [slot('mod_barrel', ['barrel'], true), slot('mod_handguard', ['handguard'])],
    }),
    'other-receiver': item('other-receiver', {
      traderLevel: 4,
      slots: [slot('mod_barrel', ['barrel'], true)],
    }),
    barrel: item('barrel', { traderLevel: barrelTraderLevel }),
    handguard: item('handguard', { ergonomics: 5 }),
  };
  const weapon = {
    ...normalizeItemPriceFields({
      id: 'rifle',
      name: 'Rifle',
      shortName: 'Rifle',
      weight: 1,
      conflictingItems: [],
      categories: [{ name: 'Weapon' }],
      properties: {
        ergonomics: 50,
        recoilVertical: 100,
        recoilHorizontal: 100,
        slots: [
          slot('mod_pistol_grip', ['grip', 'other-grip']),
          slot('mod_reciever', ['receiver', 'other-receiver'], true),
        ],
      },
      buyFor: [trader(5_000)],
    }, PRICE_MODES.PVP),
    defaultPresetItem: {
      id: 'rifle-preset',
      types: ['preset'],
      containsItems: ['rifle', 'grip', 'receiver', 'barrel', 'handguard']
        .map(itemId => ({ item: itemId, count: 1 })),
    },
  };
  return { weapon, mods };
}

function calculate(weapon, mods, options = {}) {
  return calculateBestBuild(weapon, 'meta', 0, 0, mods, { ...NO_FLEA_LL1, ...options });
}

test('the default preset lists its modules without the weapon itself', () => {
  const { weapon } = createRifle();

  assert.deepEqual(getDefaultPresetModuleIds(weapon), ['grip', 'receiver', 'barrel', 'handguard']);
  assert.deepEqual(getDefaultPresetModuleIds({ id: 'bare' }), []);
});

test('the default preset is assembled into the weapon slot tree', () => {
  const { weapon, mods } = createRifle();

  const build = assembleDefaultPresetBuild(weapon, mods);
  const tree = buildWeaponAssemblyTree(weapon, build);

  assert.deepEqual(tree.unattachedParts, []);
  assert.deepEqual(
    Object.fromEntries(build.map(part => [part.item.id, part.parentItemId])),
    { grip: 'rifle', receiver: 'rifle', barrel: 'receiver', handguard: 'receiver' },
  );
});

test('a module that fits several slots leaves room for one that fits only one', () => {
  const mods = { wide: item('wide'), narrow: item('narrow') };
  const weapon = {
    ...item('rifle', { slots: [slot('mod_mount_000', ['wide', 'narrow']), slot('mod_mount_001', ['wide'])] }),
    defaultPresetItem: { id: 'preset', containsItems: [{ item: 'wide' }, { item: 'narrow' }] },
  };

  const build = assembleDefaultPresetBuild(weapon, mods);

  assert.deepEqual(
    Object.fromEntries(build.map(part => [part.item.id, part.slotId])),
    { narrow: 'mod_mount_000:0', wide: 'mod_mount_001:1' },
  );
});

test('no preset build is assembled when its modules are missing or do not fit', () => {
  const { weapon, mods } = createRifle();
  const misfit = {
    ...weapon,
    defaultPresetItem: { id: 'preset', containsItems: [{ item: 'barrel' }] },
  };

  assert.equal(assembleDefaultPresetBuild(weapon, { ...mods, handguard: undefined }), null);
  assert.equal(assembleDefaultPresetBuild(misfit, mods), null);
  assert.equal(assembleDefaultPresetBuild({ ...weapon, defaultPresetItem: undefined }, mods), null);
});

test('only the preset module for a slot nothing on sale can fill is a fallback', () => {
  const { weapon, mods } = createRifle();

  assert.deepEqual(getDefaultPresetFallbackItemIds(weapon, mods, NO_FLEA_LL1), ['receiver']);
});

test('a fallback module also takes preset parts for its own blocked required slots', () => {
  const { weapon, mods } = createRifle({ barrelTraderLevel: 4 });

  assert.deepEqual(getDefaultPresetFallbackItemIds(weapon, mods, NO_FLEA_LL1), ['receiver', 'barrel']);
});

test('no fallback is needed when every required slot can be filled', () => {
  const { weapon, mods } = createRifle();

  assert.deepEqual(getDefaultPresetFallbackItemIds(weapon, mods, { ...NO_FLEA_LL1, includeFleaMarket: true }), []);
  assert.deepEqual(getDefaultPresetFallbackItemIds(weapon, mods, { ...NO_FLEA_LL1, traderLevels: { [PRAPOR_ID]: 4 } }), []);
  assert.deepEqual(getDefaultPresetFallbackItemIds({ ...weapon, defaultPresetItem: undefined }, mods, NO_FLEA_LL1), []);
});

test('a retry pins the preset chain of required slots after the fallback modules', () => {
  const { weapon, mods } = createRifle();
  const blockedBarrel = createRifle({ barrelTraderLevel: 4 });

  assert.deepEqual(getDefaultPresetFallbackSteps(weapon, mods, NO_FLEA_LL1), [['receiver'], ['receiver', 'barrel']]);
  assert.deepEqual(
    getDefaultPresetFallbackSteps(blockedBarrel.weapon, blockedBarrel.mods, NO_FLEA_LL1),
    [['receiver', 'barrel']],
  );
  assert.deepEqual(getDefaultPresetFallbackSteps(weapon, mods, { ...NO_FLEA_LL1, includeFleaMarket: true }), []);
});

test('pinning the fallback modules completes the build and leaves other slots to the calculator', () => {
  const { weapon, mods } = createRifle();
  const failed = calculate(weapon, mods);
  const fallbackItemIds = getDefaultPresetFallbackItemIds(weapon, mods, NO_FLEA_LL1);

  const result = calculate(weapon, mods, { requiredItemIds: fallbackItemIds });
  const installedIds = result.build.map(part => part.item.id);

  assert.ok(failed.error);
  assert.equal(result.error, undefined);
  assert.ok(installedIds.includes('receiver'));
  assert.ok(installedIds.includes('barrel'));
  // The calculator still picks the better grip over the preset one.
  assert.ok(installedIds.includes('other-grip'));
  assert.ok(!installedIds.includes('grip'));
});
