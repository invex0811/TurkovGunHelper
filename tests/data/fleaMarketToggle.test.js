import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isItemUnavailable,
  normalizeItemPriceFields,
  selectPurchasePrice,
} from '../../src/data/price/priceMapper.js';
import { PRICE_MODES, PRICE_SOURCE_TYPE } from '../../src/data/price/priceModes.js';
import { calculateBestBuild } from '../../src/domain/calculator.js';
import { selectReplacementCandidates } from '../../src/features/configurator/services/replacementService.js';

const PRAPOR_ID = 'prapor-id';

function flea(priceRUB) {
  return {
    price: priceRUB,
    priceRUB,
    currency: 'RUB',
    vendor: { __typename: 'FleaMarket', name: 'Flea Market', normalizedName: 'flea-market' },
  };
}

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

function createMod(id, { ergonomics = 10, buyFor = [] } = {}) {
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
    bartersFor: [],
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
    buyFor: [trader(5_000)],
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

const LL1 = { [PRAPOR_ID]: 1 };
const LL4 = { [PRAPOR_ID]: 4 };

test('without the Flea Market the price comes from a trader', () => {
  const mod = createMod('mod', { buyFor: [flea(10_000), trader(15_000)] });

  const withFlea = selectPurchasePrice(mod, { priceMode: PRICE_MODES.PVP });
  assert.equal(withFlea.sourceType, PRICE_SOURCE_TYPE.FLEA_MARKET);

  const withoutFlea = selectPurchasePrice(mod, {
    priceMode: PRICE_MODES.PVP,
    includeFleaMarket: false,
  });
  assert.equal(withoutFlea.value, 15_000);
  assert.equal(withoutFlea.sourceType, PRICE_SOURCE_TYPE.TRADER);
});

test('without the Flea Market trader prices apply even when switched off', () => {
  const mod = createMod('mod', { buyFor: [flea(10_000), trader(15_000)] });
  const price = selectPurchasePrice(mod, {
    priceMode: PRICE_MODES.PVP,
    includeTraderPrices: false,
    includeFleaMarket: false,
  });

  assert.equal(price.value, 15_000);
});

test('without the Flea Market loyalty levels apply even when strict levels are off', () => {
  const mod = createMod('mod', { buyFor: [flea(10_000), trader(15_000, 3)] });
  const options = {
    priceMode: PRICE_MODES.PVP,
    strictTraderLevels: false,
    includeFleaMarket: false,
  };

  const lowLevel = selectPurchasePrice(mod, { ...options, traderLevels: LL1 });
  assert.equal(lowLevel.value, null);
  assert.equal(lowLevel.sourceType, PRICE_SOURCE_TYPE.MISSING);
  assert.equal(isItemUnavailable(mod, { ...options, traderLevels: LL1 }), true);

  // Without a level profile every trader counts as LL1.
  assert.equal(selectPurchasePrice(mod, options).value, null);

  const highLevel = selectPurchasePrice(mod, { ...options, traderLevels: LL4 });
  assert.equal(highLevel.value, 15_000);
  assert.equal(isItemUnavailable(mod, { ...options, traderLevels: LL4 }), false);
});

test('a Flea-only item is available only while the Flea Market is on', () => {
  const mod = createMod('flea-only', { buyFor: [flea(10_000)] });

  assert.equal(isItemUnavailable(mod, { priceMode: PRICE_MODES.PVP }), false);
  assert.equal(
    isItemUnavailable(mod, { priceMode: PRICE_MODES.PVP, includeFleaMarket: false }),
    true,
  );
});

test('generated builds skip parts traders do not sell when the Flea Market is off', () => {
  const fleaMod = createMod('flea-mod', { ergonomics: 30, buyFor: [flea(20_000)] });
  const lockedMod = createMod('locked-mod', { ergonomics: 20, buyFor: [trader(30_000, 4)] });
  const traderMod = createMod('trader-mod', { ergonomics: 10, buyFor: [trader(25_000)] });
  const weapon = createWeapon([fleaMod.id, lockedMod.id, traderMod.id]);
  const mods = [fleaMod, lockedMod, traderMod];

  const withFlea = calculate(weapon, mods, { traderLevels: LL1 });
  assert.deepEqual(withFlea.build.map(part => part.item.id), ['flea-mod']);

  const withoutFleaLL1 = calculate(weapon, mods, { includeFleaMarket: false, traderLevels: LL1 });
  assert.deepEqual(withoutFleaLL1.build.map(part => part.item.id), ['trader-mod']);
  assert.equal(withoutFleaLL1.stats.price, 30_000);

  const withoutFleaLL4 = calculate(weapon, mods, { includeFleaMarket: false, traderLevels: LL4 });
  assert.deepEqual(withoutFleaLL4.build.map(part => part.item.id), ['locked-mod']);
});

test('a pinned Flea-only part stays available when the Flea Market is off', () => {
  const fleaMod = createMod('flea-mod', { ergonomics: 5, buyFor: [flea(20_000)] });
  const traderMod = createMod('trader-mod', { ergonomics: 10, buyFor: [trader(25_000)] });
  const weapon = createWeapon([fleaMod.id, traderMod.id]);

  const result = calculate(weapon, [fleaMod, traderMod], {
    includeFleaMarket: false,
    traderLevels: LL1,
    requiredItemIds: [fleaMod.id],
  });
  assert.deepEqual(result.build.map(part => part.item.id), ['flea-mod']);
});

function createMagazine(id, capacity, buyFor) {
  const magazine = createMod(id, { ergonomics: 0, buyFor });
  return {
    ...magazine,
    categories: [{ name: 'Magazine' }],
    properties: { ...magazine.properties, capacity },
  };
}

function createWeaponWithMagazine(allowedIds) {
  const weapon = createWeapon([]);
  return {
    ...weapon,
    properties: {
      ...weapon.properties,
      slots: [{
        name: 'Magazine',
        nameId: 'mod_magazine',
        required: true,
        filters: { allowedItems: allowedIds.map(id => ({ id })) },
      }],
    },
  };
}

test('a build warns when the selected magazine capacity is not available', () => {
  const fleaMag = createMagazine('mag-30', 30, [flea(5_000)]);
  const traderMag = createMagazine('mag-20', 20, [trader(4_000)]);
  const weapon = createWeaponWithMagazine([fleaMag.id, traderMag.id]);
  const mods = [fleaMag, traderMag];
  const findWarning = result => (result.warnings || [])
    .find(warning => warning.code === 'MAGAZINE_CAPACITY_SUBSTITUTED');

  const withFlea = calculate(weapon, mods, { magazineCapacity: 30, traderLevels: LL1 });
  assert.deepEqual(withFlea.build.map(part => part.item.id), ['mag-30']);
  assert.equal(findWarning(withFlea), undefined);

  const withoutFlea = calculate(weapon, mods, {
    magazineCapacity: 30,
    includeFleaMarket: false,
    traderLevels: LL1,
  });
  assert.deepEqual(withoutFlea.build.map(part => part.item.id), ['mag-20']);
  assert.deepEqual(findWarning(withoutFlea)?.params, { requested: 30, installed: 20 });
});

test('a pinned magazine is installed whatever capacity is selected', () => {
  const fleaMag = createMagazine('mag-30', 30, [flea(5_000)]);
  const traderMag = createMagazine('mag-20', 20, [trader(4_000)]);
  const weapon = createWeaponWithMagazine([fleaMag.id, traderMag.id]);

  const result = calculate(weapon, [fleaMag, traderMag], {
    magazineCapacity: 20,
    includeFleaMarket: false,
    traderLevels: LL1,
    requiredItemIds: [fleaMag.id],
  });
  assert.deepEqual(result.build.map(part => part.item.id), ['mag-30']);
  assert.equal(result.error, undefined);
  assert.equal(
    (result.warnings || []).some(warning => warning.code === 'MAGAZINE_CAPACITY_SUBSTITUTED'),
    false,
  );
});

test('replacement suggestions hide parts traders do not sell when the Flea Market is off', () => {
  const current = createMod('current', { buyFor: [trader(10_000)] });
  const fleaMod = createMod('flea-mod', { buyFor: [flea(20_000)] });
  const traderMod = createMod('trader-mod', { buyFor: [trader(20_000)] });
  const options = {
    alternatives: [fleaMod, traderMod],
    targetNode: { item: current, children: [] },
    priceMode: PRICE_MODES.PVP,
    includeTraderPrices: true,
    traderLevels: LL1,
  };

  assert.deepEqual(
    selectReplacementCandidates(options).map(item => item.id).sort(),
    ['flea-mod', 'trader-mod'],
  );
  assert.deepEqual(
    selectReplacementCandidates({ ...options, includeFleaMarket: false }).map(item => item.id),
    ['trader-mod'],
  );
});
