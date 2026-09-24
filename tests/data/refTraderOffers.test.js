import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRefOnlyItem,
  normalizeItemPriceFields,
  REF_TRADER_ID,
  selectPurchasePrice,
} from '../../src/data/price/priceMapper.js';
import { PRICE_MODES, PRICE_SOURCE_TYPE } from '../../src/data/price/priceModes.js';
import { calculateBestBuild } from '../../src/domain/calculator.js';
import { selectReplacementCandidates } from '../../src/features/configurator/services/replacementService.js';

function flea(priceRUB) {
  return {
    price: priceRUB,
    priceRUB,
    currency: 'RUB',
    vendor: { __typename: 'FleaMarket', name: 'Flea Market', normalizedName: 'flea-market' },
  };
}

function trader(priceRUB) {
  return {
    price: priceRUB,
    priceRUB,
    currency: 'RUB',
    vendor: {
      __typename: 'TraderOffer',
      id: 'mechanic-id',
      name: 'Mechanic',
      normalizedName: 'mechanic',
      minTraderLevel: 1,
      taskUnlock: null,
    },
  };
}

// Tarkov.dev has no RUB price for GP coins; a priced coin covers the offer
// filtering path.
const GP_COIN = { id: 'gp-coin', basePrice: 7_500, buyFor: [] };
const PRICED_GP_COIN = { id: 'gp-coin', buyFor: [flea(7_000)] };

function refBarter(itemId, coins, coin = GP_COIN) {
  return {
    id: `ref-${itemId}`,
    level: 1,
    taskUnlock: null,
    trader: { id: REF_TRADER_ID, name: 'Ref', normalizedName: 'ref' },
    requiredItems: [{ count: coins, item: coin }],
    rewardItems: [{ count: 1, item: { id: itemId } }],
  };
}

function createMod(id, { ergonomics = 10, buyFor = [], refCoins = null, coin } = {}) {
  return normalizeItemPriceFields({
    id,
    name: id,
    shortName: id,
    weight: 0.1,
    ergonomicsModifier: ergonomics,
    recoilModifier: 0,
    conflictingItems: [],
    categories: [{ name: 'Test Mod' }],
    properties: { slots: [] },
    buyFor,
    bartersFor: refCoins ? [refBarter(id, refCoins, coin)] : [],
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

function calculate(weapon, mods, options = {}) {
  return calculateBestBuild(
    weapon,
    'meta',
    0,
    0,
    Object.fromEntries(mods.map(mod => [mod.id, mod])),
    { priceMode: PRICE_MODES.PVP, includeTraderPrices: true, ...options },
  );
}

test('Ref offers are ignored when disabled and the next source is used', () => {
  const mod = createMod('shared-mod', { buyFor: [flea(50_000)], refCoins: 2, coin: PRICED_GP_COIN });
  const options = { priceMode: PRICE_MODES.PVP, includeTraderPrices: true };

  const withRef = selectPurchasePrice(mod, options);
  assert.equal(withRef.value, 14_000);
  assert.equal(withRef.traderId, REF_TRADER_ID);

  const withoutRef = selectPurchasePrice(mod, { ...options, includeRefOffers: false });
  assert.equal(withoutRef.value, 50_000);
  assert.equal(withoutRef.sourceType, PRICE_SOURCE_TYPE.FLEA_MARKET);
});

test('a Ref-only item has no price when Ref is disabled', () => {
  const mod = createMod('ref-mod', { refCoins: 2, coin: PRICED_GP_COIN });
  const price = selectPurchasePrice(mod, {
    priceMode: PRICE_MODES.PVP,
    includeTraderPrices: true,
    includeRefOffers: false,
  });

  assert.equal(price.value, null);
  assert.equal(price.sourceType, PRICE_SOURCE_TYPE.MISSING);
});

test('isRefOnlyItem detects items that no other source sells', () => {
  assert.equal(isRefOnlyItem(createMod('ref-mod', { refCoins: 2 })), true);
  assert.equal(isRefOnlyItem(createMod('priced-ref-mod', { refCoins: 2, coin: PRICED_GP_COIN })), true);
  assert.equal(isRefOnlyItem(createMod('flea-too', { buyFor: [flea(50_000)], refCoins: 2 })), false);
  assert.equal(isRefOnlyItem(createMod('trader-too', { buyFor: [trader(40_000)], refCoins: 2 })), false);
  assert.equal(isRefOnlyItem(createMod('no-ref', { buyFor: [flea(50_000)] })), false);
  assert.equal(isRefOnlyItem(createMod('unpriced')), false);

  const otherBarter = createMod('other-barter', { refCoins: 2 });
  otherBarter.bartersFor.push({
    ...refBarter('other-barter', 1),
    trader: { id: 'mechanic-id', name: 'Mechanic', normalizedName: 'mechanic' },
  });
  assert.equal(isRefOnlyItem(otherBarter), false);
});

test('generated builds skip Ref-only parts when Ref is disabled', () => {
  const refMod = createMod('ref-mod', { ergonomics: 30, refCoins: 2 });
  const fleaMod = createMod('flea-mod', { ergonomics: 10, buyFor: [flea(20_000)] });
  const weapon = createWeapon([refMod.id, fleaMod.id]);

  const withRef = calculate(weapon, [refMod, fleaMod]);
  assert.deepEqual(withRef.build.map(part => part.item.id), ['ref-mod']);

  const withoutRef = calculate(weapon, [refMod, fleaMod], { includeRefOffers: false });
  assert.deepEqual(withoutRef.build.map(part => part.item.id), ['flea-mod']);
});

test('generated builds keep parts that Ref and the Flea Market both sell', () => {
  const sharedMod = createMod('shared-mod', { ergonomics: 30, buyFor: [flea(50_000)], refCoins: 2 });
  const fleaMod = createMod('flea-mod', { ergonomics: 10, buyFor: [flea(20_000)] });
  const weapon = createWeapon([sharedMod.id, fleaMod.id]);

  const result = calculate(weapon, [sharedMod, fleaMod], { includeRefOffers: false });
  assert.deepEqual(result.build.map(part => part.item.id), ['shared-mod']);
  assert.equal(result.stats.price, 55_000);
});

test('a pinned Ref-only part stays available when Ref is disabled', () => {
  const refMod = createMod('ref-mod', { ergonomics: 5, refCoins: 2 });
  const fleaMod = createMod('flea-mod', { ergonomics: 10, buyFor: [flea(20_000)] });
  const weapon = createWeapon([refMod.id, fleaMod.id]);

  const result = calculate(weapon, [refMod, fleaMod], {
    includeRefOffers: false,
    requiredItemIds: [refMod.id],
  });
  assert.deepEqual(result.build.map(part => part.item.id), ['ref-mod']);
});

test('replacement suggestions hide Ref-only parts when Ref is disabled', () => {
  const current = createMod('current', { buyFor: [flea(10_000)] });
  const refMod = createMod('ref-mod', { refCoins: 2 });
  const fleaMod = createMod('flea-mod', { buyFor: [flea(20_000)] });
  const options = {
    alternatives: [refMod, fleaMod],
    targetNode: { item: current, children: [] },
    priceMode: PRICE_MODES.PVP,
    includeTraderPrices: true,
  };

  assert.deepEqual(
    selectReplacementCandidates(options).map(item => item.id).sort(),
    ['flea-mod', 'ref-mod'],
  );
  assert.deepEqual(
    selectReplacementCandidates({ ...options, includeRefOffers: false }).map(item => item.id),
    ['flea-mod'],
  );
});
