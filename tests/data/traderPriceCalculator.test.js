import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeItemPriceFields } from '../../src/data/price/priceMapper.js';
import { PRICE_MODES } from '../../src/data/price/priceModes.js';
import {
  calculateBestBuild,
  recalculateBuildStats,
} from '../../src/domain/calculator.js';

function flea(priceRUB) {
  return {
    price: priceRUB,
    priceRUB,
    currency: 'RUB',
    vendor: {
      __typename: 'FleaMarket',
      name: 'Flea Market',
      normalizedName: 'flea-market',
    },
  };
}

function trader(priceRUB) {
  return {
    price: priceRUB,
    priceRUB,
    currency: 'RUB',
    vendor: {
      __typename: 'TraderOffer',
      name: 'Mechanic',
      normalizedName: 'mechanic',
      minTraderLevel: 3,
      taskUnlock: null,
    },
  };
}

function createMod(id, fleaPrice, traderPrice) {
  return normalizeItemPriceFields({
    id,
    name: id,
    shortName: id,
    weight: 0.1,
    ergonomicsModifier: 10,
    recoilModifier: 0,
    conflictingItems: [],
    categories: [{ name: 'Test Mod' }],
    properties: { slots: [] },
    buyFor: [
      flea(fleaPrice),
      ...(traderPrice ? [trader(traderPrice)] : []),
    ],
  }, PRICE_MODES.PVP);
}

function createWeapon(allowedIds) {
  return normalizeItemPriceFields({
    id: 'weapon',
    name: 'Weapon',
    shortName: 'W',
    weight: 1,
    conflictingItems: [],
    categories: [{ name: 'Weapon' }],
    properties: {
      ergonomics: 50,
      recoilVertical: 100,
      recoilHorizontal: 100,
      slots: [{
        name: 'Test Slot',
        nameId: 'test_slot',
        filters: { allowedItems: allowedIds.map(id => ({ id })) },
      }],
    },
    buyFor: [flea(5_000)],
  }, PRICE_MODES.PVP);
}

function calculate(weapon, mods, includeTraderPrices, maxPrice = 1_000_000) {
  return calculateBestBuild(
    weapon,
    'meta',
    0,
    0,
    Object.fromEntries(mods.map(mod => [mod.id, mod])),
    {
      priceMode: PRICE_MODES.PVP,
      includeTraderPrices,
      maxPrice,
    },
  );
}

test('same assembly total changes when trader prices are toggled', () => {
  const mod = createMod('trader-mod', 50_000, 10_000);
  const weapon = createWeapon([mod.id]);
  const build = [{ slotName: 'Test Slot', item: mod }];

  const withTraders = recalculateBuildStats(weapon, build, {
    priceMode: PRICE_MODES.PVP,
    includeTraderPrices: true,
  });
  const fleaOnly = recalculateBuildStats(weapon, build, {
    priceMode: PRICE_MODES.PVP,
    includeTraderPrices: false,
  });

  assert.equal(withTraders.stats.price, 15_000);
  assert.equal(fleaOnly.stats.price, 55_000);
  assert.deepEqual(withTraders.build, fleaOnly.build);
});

test('price-constrained Meta and Max Budget use the active purchase price policy', () => {
  const traderMod = createMod('trader-mod', 50_000, 10_000);
  const fleaMod = createMod('flea-mod', 20_000, null);
  const weapon = createWeapon([traderMod.id, fleaMod.id]);

  const withTraders = calculate(weapon, [traderMod, fleaMod], true, 30_000);
  const fleaOnly = calculate(weapon, [traderMod, fleaMod], false, 30_000);

  assert.deepEqual(withTraders.build.map(part => part.item.id), ['trader-mod']);
  assert.equal(withTraders.stats.price, 15_000);
  assert.deepEqual(fleaOnly.build.map(part => part.item.id), ['flea-mod']);
  assert.equal(fleaOnly.stats.price, 25_000);
});

test('missing prices are not treated as zero or basePrice by the optimizer or totals', () => {
  const missing = normalizeItemPriceFields({
    id: 'missing',
    name: 'Missing',
    shortName: 'Missing',
    basePrice: 1,
    weight: 0.1,
    ergonomicsModifier: 100,
    recoilModifier: 0,
    conflictingItems: [],
    categories: [{ name: 'Test Mod' }],
    properties: { slots: [] },
  }, PRICE_MODES.PVP);
  const priced = createMod('priced', 20_000, null);
  const weapon = createWeapon([missing.id, priced.id]);
  const result = calculate(weapon, [missing, priced], false);

  assert.deepEqual(result.build.map(part => part.item.id), ['priced']);

  const missingTotal = recalculateBuildStats(weapon, [{ slotName: 'Test Slot', item: missing }], {
    priceMode: PRICE_MODES.PVP,
    includeTraderPrices: false,
  });
  assert.equal(missingTotal.stats.price, null);
});
