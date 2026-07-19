import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { getPurchasePriceValue, sumPurchasePrices } from '../../src/data/price/priceMapper.js';
import { calculateBestBuild, recalculateBuildStats } from '../../src/domain/calculator.js';

const modsFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/mods.json', import.meta.url), 'utf8'));
const weaponFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/weapon.json', import.meta.url), 'utf8'));

const mods = modsFixture.data.items;
const weapon = weaponFixture.data.item;
const modMap = Object.fromEntries(mods.map(mod => [mod.id, mod]));

function hasCategory(item, categoryName) {
  return item.categories?.some(category => category.name === categoryName) || false;
}

function getExpectedItemPrice(item, priceMode) {
  return getPurchasePriceValue(
    item,
    { priceMode, includeTraderPrices: true },
    Number.MAX_SAFE_INTEGER,
  );
}

function assertNoDuplicateParts(result) {
  const ids = result.build.map(part => part.item.id);
  assert.equal(new Set(ids).size, ids.length, 'build must not install the same item twice');
}

function assertNoInstalledConflicts(result) {
  const installedIds = new Set([weapon.id, ...result.build.map(part => part.item.id)]);

  for (const part of result.build) {
    for (const conflict of part.item.conflictingItems || []) {
      assert.equal(
        installedIds.has(conflict.id),
        false,
        `${part.item.shortName} conflicts with another installed item ${conflict.id}`,
      );
    }
  }
}

function assertStatsMatchParts(result) {
  const totalErgo = weapon.properties.ergonomics
    + result.build.reduce((sum, part) => sum + (part.item.ergonomicsModifier || 0), 0);
  const totalRecoilMod = result.build.reduce((sum, part) => sum + (part.item.recoilModifier || 0), 0);
  const totalWeight = weapon.weight + result.build.reduce((sum, part) => sum + (part.item.weight || 0), 0);
  const totalPrice = sumPurchasePrices(
    [weapon, ...result.build.map(part => part.item)],
    { includeTraderPrices: true },
  ).value;

  assert.equal(result.stats.ergonomics, Math.min(100, Math.round(totalErgo)));
  assert.equal(result.stats.recoilVertical, Math.round(weapon.properties.recoilVertical * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.recoilHorizontal, Math.round(weapon.properties.recoilHorizontal * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.weight, totalWeight.toFixed(2));
  assert.equal(result.stats.price, totalPrice == null ? null : Math.round(totalPrice));
}

function getWeightedPartScore(item, {
  currentErgo,
  ergoWeight,
  recoilWeight,
  priceWeight = 0,
  weightWeight = 0.001,
  overflowErgoWeight = 0,
  ergoCap = 100,
}) {
  const currentUsableErgo = Math.min(ergoCap, currentErgo);
  const newUsableErgo = Math.min(ergoCap, currentErgo + (item.ergonomicsModifier || 0));
  const cappedErgoMod = newUsableErgo - currentUsableErgo;
  const currentOverflowErgo = Math.max(0, currentErgo - ergoCap);
  const newOverflowErgo = Math.max(0, currentErgo + (item.ergonomicsModifier || 0) - ergoCap);
  const overflowErgoMod = newOverflowErgo - currentOverflowErgo;
  const effectiveErgoMod = cappedErgoMod + (overflowErgoMod * overflowErgoWeight);

  return (effectiveErgoMod * ergoWeight)
    - ((item.recoilModifier || 0) * recoilWeight)
    - (getExpectedItemPrice(item) * priceWeight)
    - ((item.weight || 0) * weightWeight);
}

function createCategories(categoryNames) {
  return categoryNames.map(name => ({ name }));
}

function createSlot(
  name,
  allowedItemIds,
  nameId = name.toLowerCase().replace(/\s+/g, '_'),
  required = false,
) {
  return {
    name,
    nameId,
    required,
    filters: {
      allowedItems: allowedItemIds.map(id => ({ id })),
    },
  };
}

function createTestWeapon(overrides = {}) {
  return {
    id: overrides.id ?? 'test-weapon',
    name: overrides.name ?? 'Test Weapon',
    shortName: overrides.shortName ?? 'TW',
    weight: overrides.weight ?? 1,
    basePrice: overrides.basePrice ?? 1000,
    avg24hPrice: overrides.avg24hPrice ?? 1000,
    buyFor: overrides.buyFor,
    categories: overrides.categories ?? createCategories(['Weapon']),
    conflictingItems: overrides.conflictingItems ?? [],
    properties: {
      ergonomics: overrides.ergonomics ?? 50,
      recoilVertical: overrides.recoilVertical ?? 100,
      recoilHorizontal: overrides.recoilHorizontal ?? 100,
      slots: overrides.slots ?? [],
      ...(overrides.properties ?? {}),
    },
  };
}

function createTestMod(overrides = {}) {
  const id = overrides.id;

  return {
    id,
    name: overrides.name ?? id,
    shortName: overrides.shortName ?? id,
    weight: overrides.weight ?? 0.1,
    basePrice: overrides.basePrice ?? 1000,
    avg24hPrice: overrides.avg24hPrice ?? 1000,
    buyFor: overrides.buyFor,
    categories: overrides.categories ?? [],
    accuracyModifier: overrides.accuracyModifier ?? 0,
    recoilModifier: overrides.recoilModifier ?? 0,
    ergonomicsModifier: overrides.ergonomicsModifier ?? 0,
    conflictingItems: overrides.conflictingItemIds?.map(conflictId => ({ id: conflictId })) ?? overrides.conflictingItems ?? [],
    properties: {
      slots: overrides.slots ?? [],
      ...(overrides.properties ?? {}),
    },
  };
}

function createModMap(...items) {
  return Object.fromEntries(items.map(item => [item.id, item]));
}

function getInstalledItemIds(result) {
  return result.build.map(part => part.item.id);
}

function hasInstalledCategory(result, categoryName) {
  return result.build.some(part => hasCategory(part.item, categoryName));
}

function assertInstalled(result, itemId) {
  assert.equal(getInstalledItemIds(result).includes(itemId), true, `${itemId} should be installed`);
}

function assertNotInstalled(result, itemId) {
  assert.equal(getInstalledItemIds(result).includes(itemId), false, `${itemId} should not be installed`);
}

function assertNoDuplicatePartsForResult(result) {
  const ids = getInstalledItemIds(result);
  assert.equal(new Set(ids).size, ids.length, 'build must not install the same item twice');
}

function assertNoInstalledConflictsForWeapon(baseWeapon, result) {
  const installedItems = [baseWeapon, ...result.build.map(part => part.item)];
  const installedIds = new Set(installedItems.map(item => item.id));

  for (const item of installedItems) {
    for (const conflict of item.conflictingItems || []) {
      assert.equal(
        installedIds.has(conflict.id),
        false,
        `${item.shortName} conflicts with another installed item ${conflict.id}`,
      );
    }
  }
}

function assertStatsMatchPartsForWeapon(baseWeapon, result, options = {}) {
  const totalErgo = baseWeapon.properties.ergonomics
    + result.build.reduce((sum, part) => sum + (part.item.ergonomicsModifier || 0), 0);
  const totalRecoilMod = result.build.reduce((sum, part) => sum + (part.item.recoilModifier || 0), 0);
  const totalWeight = baseWeapon.weight + result.build.reduce((sum, part) => sum + (part.item.weight || 0), 0);
  const totalPrice = sumPurchasePrices(
    [baseWeapon, ...result.build.map(part => part.item)],
    { priceMode: options.priceMode, includeTraderPrices: true },
  ).value;

  assert.equal(result.stats.ergonomics, Math.min(100, Math.round(totalErgo)));
  assert.equal(result.stats.recoilVertical, Math.round(baseWeapon.properties.recoilVertical * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.recoilHorizontal, Math.round(baseWeapon.properties.recoilHorizontal * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.weight, totalWeight.toFixed(2));
  assert.equal(result.stats.price, totalPrice == null ? null : Math.round(totalPrice));
}

const defaultOptions = {
  forbidSuppressor: false,
  requireSuppressor: false,
  maxWeight: 0,
};

for (const targetType of ['meta', 'custom']) {
  test(`${targetType} build has valid unique parts and consistent stats`, () => {
    const result = calculateBestBuild(weapon, targetType, 70, 50, modMap, {
      forbidSuppressor: false,
      requireSuppressor: false,
      maxWeight: 0,
    });

    assert.ok(result.build.length > 0, `${targetType} should return at least one part`);
    assertNoDuplicateParts(result);
    assertNoInstalledConflicts(result);
    assertStatsMatchParts(result);
  });
}

test('legacy Custom calculation keeps its established fixture result', () => {
  const result = calculateBestBuild(weapon, 'custom', 70, 50, modMap, {
    forbidSuppressor: false,
    requireSuppressor: false,
    maxWeight: 0,
  });

  assert.deepEqual(result.build.map(part => part.item.id), [
    '5b07db875acfc40dc528a5f6',
    '63f5ed14534b2c3d5479a677',
    '5d440b9fa4b93601354d480c',
    '63d3ce281fe77d0f2801859e',
    '5f6372e2865db925d54f3869',
    '5f6339d53ada5942720e2dc3',
    '68a5dc0c2cd64a8b58023b87',
    '68a6fbfdd31595bb360c73bd',
    '665d5d9e338229cfd6078da1',
    '68a6e8fd4ac5b037cb0e9b86',
    '618b9643526131765025ab35',
    '618b9671d14d6d5ab879c5ea',
    '5a33ca0fc4a282000d72292f',
    '5d44069ca4b9361ebd26fc37',
    '5aaa5e60e5b5b000140293d6',
    '6895bf08e2d16810ba0bf43e',
  ]);
  assert.deepEqual(result.stats, {
    ergonomics: 54,
    recoilVertical: 49,
    recoilHorizontal: 140,
    weight: '4.24',
    price: null,
  });
});

test('Custom profile enforces vertical and horizontal recoil independently', () => {
  const ergonomicPart = createTestMod({
    id: 'custom-ergo-part',
    ergonomicsModifier: 30,
  });
  const recoilPart = createTestMod({
    id: 'custom-recoil-part',
    recoilModifier: -30,
  });
  const testWeapon = createTestWeapon({
    recoilVertical: 100,
    recoilHorizontal: 200,
    slots: [createSlot('Stock', [ergonomicPart.id, recoilPart.id])],
  });
  const modsMap = createModMap(ergonomicPart, recoilPart);
  const verticalResult = calculateBestBuild(
    testWeapon,
    'custom',
    50,
    70,
    modsMap,
    defaultOptions,
    { ergonomics: 50, verticalRecoil: 70, horizontalRecoil: 200, weight: 0, price: 0 },
  );
  const horizontalResult = calculateBestBuild(
    testWeapon,
    'custom',
    50,
    100,
    modsMap,
    defaultOptions,
    { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 140, weight: 0, price: 0 },
  );

  assert.equal(verticalResult.error, undefined);
  assert.equal(verticalResult.stats.recoilVertical, 70);
  assert.equal(horizontalResult.error, undefined);
  assert.equal(horizontalResult.stats.recoilHorizontal, 140);
  assertInstalled(verticalResult, recoilPart.id);
  assertInstalled(horizontalResult, recoilPart.id);
});

test('Custom profile returns an error instead of a violating closest build', () => {
  const ergonomicPart = createTestMod({ id: 'limited-ergo-part', ergonomicsModifier: 10 });
  const testWeapon = createTestWeapon({
    ergonomics: 50,
    slots: [createSlot('Stock', [ergonomicPart.id])],
  });
  const result = calculateBestBuild(
    testWeapon,
    'custom',
    90,
    100,
    createModMap(ergonomicPart),
    defaultOptions,
    { ergonomics: 90, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 },
  );

  assert.deepEqual(result.build, []);
  assert.match(result.error, /No available build satisfies all Custom requirements/);
});

test('Custom profile passes weight and price limits through the existing price policy', () => {
  const validPart = createTestMod({
    id: 'custom-valid-part',
    weight: 0.1,
    basePrice: 1_000,
    avg24hPrice: 1_000,
    recoilModifier: -10,
  });
  const expensivePart = createTestMod({
    id: 'custom-expensive-part',
    weight: 0.1,
    basePrice: 10_000,
    avg24hPrice: 10_000,
    recoilModifier: -50,
  });
  const heavyPart = createTestMod({
    id: 'custom-heavy-part',
    weight: 1,
    basePrice: 500,
    avg24hPrice: 500,
    recoilModifier: -60,
  });
  const testWeapon = createTestWeapon({
    basePrice: 1_000,
    avg24hPrice: 1_000,
    slots: [createSlot('Stock', [validPart.id, expensivePart.id, heavyPart.id], 'mod_stock', true)],
  });
  const result = calculateBestBuild(
    testWeapon,
    'custom',
    50,
    100,
    createModMap(validPart, expensivePart, heavyPart),
    { ...defaultOptions, priceMode: 'pvp', includeTraderPrices: true },
    { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: 1.2, price: 3_000 },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, validPart.id);
  assert.equal(Number(result.stats.weight) <= 1.2, true);
  assert.equal(result.stats.price <= 3_000, true);
});

test('Custom reuses a Meta build when its displayed stats satisfy the profile', () => {
  const metaResult = calculateBestBuild(weapon, 'meta', 0, 0, modMap, defaultOptions);
  const profile = {
    ergonomics: metaResult.stats.ergonomics,
    verticalRecoil: metaResult.stats.recoilVertical,
    horizontalRecoil: metaResult.stats.recoilHorizontal,
    weight: Math.ceil(Number(metaResult.stats.weight) * 20) / 20,
    price: 0,
  };
  const customResult = calculateBestBuild(
    weapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    modMap,
    defaultOptions,
    profile,
  );

  assert.equal(customResult.error, undefined);
  assert.deepEqual(getInstalledItemIds(customResult), getInstalledItemIds(metaResult));
  assert.deepEqual(customResult.stats, metaResult.stats);
});

test('Custom with every Exact flag disabled keeps the established result unchanged', () => {
  const profile = {
    ergonomics: 50,
    verticalRecoil: 80,
    horizontalRecoil: 240,
    weight: 5,
    price: 0,
  };
  const previousResult = calculateBestBuild(
    weapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    modMap,
    defaultOptions,
    profile,
  );
  const exactOffResult = calculateBestBuild(
    weapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    modMap,
    defaultOptions,
    profile,
    {
      ergonomics: false,
      verticalRecoil: false,
      horizontalRecoil: false,
      weight: false,
      price: false,
    },
  );

  assert.deepEqual(exactOffResult, previousResult);
});

test('Exact ergonomics replaces the directional minimum with a tolerance window', () => {
  const closePart = createTestMod({
    id: 'exact-ergo-close',
    ergonomicsModifier: 10,
    recoilModifier: -10,
  });
  const highPart = createTestMod({
    id: 'exact-ergo-high',
    ergonomicsModifier: 30,
  });
  const testWeapon = createTestWeapon({
    ergonomics: 50,
    recoilVertical: 100,
    recoilHorizontal: 200,
    slots: [createSlot('Stock', [closePart.id, highPart.id], 'mod_stock', true)],
  });
  const profile = {
    ergonomics: 60,
    verticalRecoil: 100,
    horizontalRecoil: 200,
    weight: 0,
    price: 0,
  };
  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(closePart, highPart),
    defaultOptions,
    profile,
    { ergonomics: true },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.ergonomics, 60);
  assertInstalled(result, closePart.id);
});

test('Exact vertical and horizontal recoil can be enabled together', () => {
  const recoilPart = createTestMod({
    id: 'exact-recoil-part',
    recoilModifier: -20,
  });
  const ergoPart = createTestMod({
    id: 'exact-recoil-ergo-part',
    ergonomicsModifier: 30,
  });
  const testWeapon = createTestWeapon({
    recoilVertical: 100,
    recoilHorizontal: 200,
    slots: [createSlot('Stock', [recoilPart.id, ergoPart.id], 'mod_stock', true)],
  });
  const profile = {
    ergonomics: 0,
    verticalRecoil: 80,
    horizontalRecoil: 160,
    weight: 0,
    price: 0,
  };
  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(recoilPart, ergoPart),
    defaultOptions,
    profile,
    { verticalRecoil: true, horizontalRecoil: true },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.recoilVertical, 80);
  assert.equal(result.stats.recoilHorizontal, 160);
  assertInstalled(result, recoilPart.id);
});

test('Exact ranking minimizes total normalized error before the existing Custom score', () => {
  const lowerScorePart = createTestMod({
    id: 'exact-total-error-a',
    ergonomicsModifier: 9,
    recoilModifier: -6,
  });
  const lowerErrorPart = createTestMod({
    id: 'exact-total-error-b',
    ergonomicsModifier: 11,
    recoilModifier: -5,
  });
  const testWeapon = createTestWeapon({
    ergonomics: 50,
    recoilVertical: 100,
    recoilHorizontal: 100,
    slots: [createSlot('Stock', [lowerScorePart.id, lowerErrorPart.id], 'mod_stock', true)],
  });
  const profile = {
    ergonomics: 60,
    verticalRecoil: 95,
    horizontalRecoil: 100,
    weight: 0,
    price: 0,
  };
  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(lowerScorePart, lowerErrorPart),
    defaultOptions,
    profile,
    { ergonomics: true, verticalRecoil: true },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, lowerErrorPart.id);
  assert.equal(result.stats.ergonomics, 61);
  assert.equal(result.stats.recoilVertical, 95);
});

test('Exact ranking uses the existing Custom score when normalized errors tie', () => {
  const betterCustomScorePart = createTestMod({
    id: 'exact-score-a',
    ergonomicsModifier: 9,
    recoilModifier: -6,
  });
  const otherPart = createTestMod({
    id: 'exact-score-b',
    ergonomicsModifier: 11,
    recoilModifier: -5,
  });
  const testWeapon = createTestWeapon({
    ergonomics: 50,
    recoilVertical: 100,
    recoilHorizontal: 200,
    slots: [createSlot('Stock', [betterCustomScorePart.id, otherPart.id], 'mod_stock', true)],
  });
  const profile = {
    ergonomics: 60,
    verticalRecoil: 100,
    horizontalRecoil: 200,
    weight: 0,
    price: 0,
  };
  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(betterCustomScorePart, otherPart),
    defaultOptions,
    profile,
    { ergonomics: true },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, betterCustomScorePart.id);
  assert.equal(result.stats.ergonomics, 59);
});

test('Exact weight and price allow their tolerance above the entered targets', () => {
  const exactPart = createTestMod({
    id: 'exact-weight-price',
    weight: 0.55,
    avg24hPrice: 5_000,
    ergonomicsModifier: 20,
  });
  const cheapPart = createTestMod({
    id: 'exact-weight-price-cheap',
    weight: 0.2,
    avg24hPrice: 1_000,
    recoilModifier: -10,
  });
  const testWeapon = createTestWeapon({
    weight: 1,
    avg24hPrice: 1_000,
    slots: [createSlot('Stock', [exactPart.id, cheapPart.id], 'mod_stock', true)],
  });
  const profile = {
    ergonomics: 0,
    verticalRecoil: 100,
    horizontalRecoil: 100,
    weight: 1.5,
    price: 5_000,
  };
  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(exactPart, cheapPart),
    defaultOptions,
    profile,
    { weight: true, price: true },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.weight, '1.55');
  assert.equal(result.stats.price, 6_000);
});

test('Exact price uses the active trader policy', () => {
  const pricedPart = createTestMod({
    id: 'exact-trader-price',
    avg24hPrice: 10_000,
    buyFor: [
      { priceRUB: 10_000, vendor: { __typename: 'FleaMarket', name: 'Flea Market' } },
      { priceRUB: 4_000, vendor: { name: 'Mechanic', minTraderLevel: 2 } },
    ],
  });
  const testWeapon = createTestWeapon({
    avg24hPrice: 1_000,
    slots: [createSlot('Stock', [pricedPart.id], 'mod_stock', true)],
  });
  const profile = {
    ergonomics: 0,
    verticalRecoil: 100,
    horizontalRecoil: 100,
    weight: 0,
    price: 5_000,
  };
  const withTrader = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(pricedPart),
    { ...defaultOptions, includeTraderPrices: true },
    profile,
    { price: true },
  );
  const fleaOnly = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(pricedPart),
    { ...defaultOptions, includeTraderPrices: false },
    profile,
    { price: true },
  );

  assert.equal(withTrader.error, undefined);
  assert.equal(withTrader.stats.price, 5_000);
  assert.equal(fleaOnly.errorCode, 'CUSTOM_EXACT_TARGETS_UNMET');
});

test('impossible Exact targets return structured failures without a violating build', () => {
  const part = createTestMod({ id: 'exact-impossible', ergonomicsModifier: 10 });
  const testWeapon = createTestWeapon({
    ergonomics: 50,
    slots: [createSlot('Stock', [part.id], 'mod_stock', true)],
  });
  const profile = {
    ergonomics: 80,
    verticalRecoil: 100,
    horizontalRecoil: 100,
    weight: 0,
    price: 0,
  };
  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(part),
    defaultOptions,
    profile,
    { ergonomics: true },
  );

  assert.deepEqual(result.build, []);
  assert.equal(result.errorCode, 'CUSTOM_EXACT_TARGETS_UNMET');
  assert.deepEqual(result.exactTargetFailures.map(failure => failure.key), ['ergonomics']);
  assert.equal(result.exactTargetFailures[0].actual, 60);
  assert.match(result.error, /Disable Exact/);
});

test('Meta ignores Custom Exact flags', () => {
  const normal = calculateBestBuild(weapon, 'meta', 0, 0, modMap, defaultOptions);
  const withCustomFlags = calculateBestBuild(
    weapon,
    'meta',
    100,
    0,
    modMap,
    defaultOptions,
    null,
    { ergonomics: true, price: true },
  );

  assert.deepEqual(withCustomFlags, normal);
});

test('Custom retries another weighting when an early recoil route starves a required charging handle', () => {
  const heavyRecoilStock = createTestMod({
    id: 'heavy-recoil-stock',
    weight: 3,
    recoilModifier: -30,
  });
  const lightErgoStock = createTestMod({
    id: 'light-ergo-stock',
    weight: 0.5,
    ergonomicsModifier: 20,
  });
  const requiredChargingHandle = createTestMod({
    id: 'required-charging-handle',
    weight: 0.2,
  });
  const testWeapon = createTestWeapon({
    weight: 1,
    slots: [
      createSlot(
        'Stock',
        [heavyRecoilStock.id, lightErgoStock.id],
        'mod_stock',
        true,
      ),
      createSlot(
        'Ch. Handle',
        [requiredChargingHandle.id],
        'mod_charge',
        true,
      ),
    ],
  });
  const result = calculateBestBuild(
    testWeapon,
    'custom',
    50,
    100,
    createModMap(heavyRecoilStock, lightErgoStock, requiredChargingHandle),
    defaultOptions,
    {
      ergonomics: 50,
      verticalRecoil: 100,
      horizontalRecoil: 100,
      weight: 4,
      price: 0,
    },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, lightErgoStock.id);
  assertInstalled(result, requiredChargingHandle.id);
  assertNotInstalled(result, heavyRecoilStock.id);
  assert.equal(Number(result.stats.weight) <= 4, true);
});

test('budget build reserves enough money for every required nested weapon slot', () => {
  const gasBlock = createTestMod({
    id: 'required-gas-block',
    basePrice: 10,
    avg24hPrice: 10,
    categories: createCategories(['Gas block']),
  });
  const optionalMuzzle = createTestMod({
    id: 'optional-muzzle',
    basePrice: 60,
    avg24hPrice: 60,
    recoilModifier: -100,
    categories: createCategories(['Muzzle device']),
  });
  const barrel = createTestMod({
    id: 'required-barrel',
    basePrice: 20,
    avg24hPrice: 20,
    categories: createCategories(['Barrel']),
    slots: [
      createSlot('Gas Block', [gasBlock.id], 'mod_gas_block', true),
      createSlot('Muzzle', [optionalMuzzle.id], 'mod_muzzle', false),
    ],
  });
  const handguard = createTestMod({
    id: 'required-handguard',
    basePrice: 30,
    avg24hPrice: 30,
    categories: createCategories(['Handguard']),
  });
  const cheapReceiver = createTestMod({
    id: 'cheap-receiver',
    basePrice: 10,
    avg24hPrice: 10,
    categories: createCategories(['Receiver']),
    slots: [
      createSlot('Barrel', [barrel.id], 'mod_barrel', true),
      createSlot('Handguard', [handguard.id], 'mod_handguard', true),
    ],
  });
  const expensiveReceiver = createTestMod({
    id: 'expensive-receiver',
    basePrice: 60,
    avg24hPrice: 60,
    ergonomicsModifier: 20,
    categories: createCategories(['Receiver']),
    slots: cheapReceiver.properties.slots,
  });
  const testWeapon = createTestWeapon({
    basePrice: 10,
    avg24hPrice: 10,
    slots: [
      createSlot(
        'Receiver',
        [expensiveReceiver.id, cheapReceiver.id],
        'mod_reciever',
        true,
      ),
    ],
  });
  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(
      gasBlock,
      optionalMuzzle,
      barrel,
      handguard,
      cheapReceiver,
      expensiveReceiver,
    ),
    { ...defaultOptions, maxPrice: 80 },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.price, 80);
  assertInstalled(result, cheapReceiver.id);
  assertInstalled(result, barrel.id);
  assertInstalled(result, gasBlock.id);
  assertInstalled(result, handguard.id);
  assertNotInstalled(result, expensiveReceiver.id);
  assertNotInstalled(result, optionalMuzzle.id);
});

test('budget build reports when required weapon slots cannot fit the price limit', () => {
  const receiver = createTestMod({
    id: 'unaffordable-receiver',
    basePrice: 100,
    avg24hPrice: 100,
    categories: createCategories(['Receiver']),
  });
  const testWeapon = createTestWeapon({
    basePrice: 10,
    avg24hPrice: 10,
    slots: [createSlot('Receiver', [receiver.id], 'mod_reciever', true)],
  });
  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(receiver),
    { ...defaultOptions, maxPrice: 80 },
  );

  assert.match(result.error, /Required weapon slots could not be completed/);
  assertNotInstalled(result, receiver.id);
});

test('budget build can skip an early optional upgrade for a stronger later recoil part', () => {
  const optionalMuzzle = createTestMod({
    id: 'early-muzzle',
    basePrice: 25000,
    avg24hPrice: 25000,
    recoilModifier: -5,
    categories: createCategories(['Muzzle device']),
  });
  const barrel = createTestMod({
    id: 'required-budget-barrel',
    basePrice: 10000,
    avg24hPrice: 10000,
    slots: [createSlot('Muzzle', [optionalMuzzle.id], 'mod_muzzle')],
    categories: createCategories(['Barrel']),
  });
  const receiver = createTestMod({
    id: 'required-budget-receiver',
    basePrice: 10000,
    avg24hPrice: 10000,
    slots: [createSlot('Barrel', [barrel.id], 'mod_barrel', true)],
    categories: createCategories(['Receiver']),
  });
  const cheapStock = createTestMod({
    id: 'cheap-budget-stock',
    basePrice: 1000,
    avg24hPrice: 1000,
    categories: createCategories(['Stock']),
  });
  const recoilStock = createTestMod({
    id: 'recoil-budget-stock',
    basePrice: 8000,
    avg24hPrice: 8000,
    recoilModifier: -20,
    ergonomicsModifier: 10,
    categories: createCategories(['Stock']),
  });
  const optionalErgoLever = createTestMod({
    id: 'optional-ergo-lever',
    basePrice: 5000,
    avg24hPrice: 5000,
    ergonomicsModifier: 2,
  });
  const testWeapon = createTestWeapon({
    basePrice: 10000,
    avg24hPrice: 10000,
    slots: [
      createSlot('Receiver', [receiver.id], 'mod_reciever', true),
      createSlot('Stock', [cheapStock.id, recoilStock.id], 'mod_stock', true),
      createSlot('Ch. Handle', [optionalErgoLever.id], 'mod_charge_001'),
    ],
  });
  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(
      optionalMuzzle,
      barrel,
      receiver,
      cheapStock,
      recoilStock,
      optionalErgoLever,
    ),
    { ...defaultOptions, maxPrice: 62000 },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, recoilStock.id);
  assertNotInstalled(result, cheapStock.id);
  assertNotInstalled(result, optionalMuzzle.id);
  assertNotInstalled(result, optionalErgoLever.id);
  assert.equal(result.stats.recoilVertical, 80);
  assert.equal(result.stats.price, 38000);
});

test('budget build spends remaining money on the strongest affordable recoil replacement', () => {
  const cheapMuzzle = createTestMod({
    id: 'cheap-recoil-muzzle',
    basePrice: 1000,
    avg24hPrice: 1000,
    recoilModifier: -5,
    categories: createCategories(['Muzzle device']),
  });
  const strongMuzzle = createTestMod({
    id: 'strong-recoil-muzzle',
    basePrice: 10000,
    avg24hPrice: 10000,
    recoilModifier: -10,
    categories: createCategories(['Muzzle device']),
  });
  const unaffordableMuzzle = createTestMod({
    id: 'unaffordable-recoil-muzzle',
    basePrice: 25000,
    avg24hPrice: 25000,
    recoilModifier: -12,
    categories: createCategories(['Muzzle device']),
  });
  const barrel = createTestMod({
    id: 'upgrade-budget-barrel',
    basePrice: 10000,
    avg24hPrice: 10000,
    slots: [
      createSlot(
        'Muzzle',
        [unaffordableMuzzle.id, strongMuzzle.id, cheapMuzzle.id],
        'mod_muzzle',
      ),
    ],
    categories: createCategories(['Barrel']),
  });
  const receiver = createTestMod({
    id: 'upgrade-budget-receiver',
    basePrice: 10000,
    avg24hPrice: 10000,
    slots: [createSlot('Barrel', [barrel.id], 'mod_barrel', true)],
    categories: createCategories(['Receiver']),
  });
  const cheapStock = createTestMod({
    id: 'upgrade-cheap-stock',
    basePrice: 1000,
    avg24hPrice: 1000,
    categories: createCategories(['Stock']),
  });
  const recoilStock = createTestMod({
    id: 'upgrade-recoil-stock',
    basePrice: 8000,
    avg24hPrice: 8000,
    recoilModifier: -20,
    ergonomicsModifier: 10,
    categories: createCategories(['Stock']),
  });
  const testWeapon = createTestWeapon({
    basePrice: 10000,
    avg24hPrice: 10000,
    slots: [
      createSlot('Receiver', [receiver.id], 'mod_reciever', true),
      createSlot('Stock', [cheapStock.id, recoilStock.id], 'mod_stock', true),
    ],
  });
  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(
      cheapMuzzle,
      strongMuzzle,
      unaffordableMuzzle,
      barrel,
      receiver,
      cheapStock,
      recoilStock,
    ),
    { ...defaultOptions, maxPrice: 62000 },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, recoilStock.id);
  assertInstalled(result, strongMuzzle.id);
  assertNotInstalled(result, cheapMuzzle.id);
  assertNotInstalled(result, unaffordableMuzzle.id);
  assert.equal(result.stats.recoilVertical, 70);
  assert.equal(result.stats.price, 48000);
});

test('meta build with a price limit compares a complete price-aware alternative', () => {
  const optionalMuzzle = createTestMod({
    id: 'meta-early-muzzle',
    basePrice: 25000,
    avg24hPrice: 25000,
    recoilModifier: -5,
    categories: createCategories(['Muzzle device']),
  });
  const barrel = createTestMod({
    id: 'meta-required-barrel',
    basePrice: 10000,
    avg24hPrice: 10000,
    slots: [createSlot('Muzzle', [optionalMuzzle.id], 'mod_muzzle')],
    categories: createCategories(['Barrel']),
  });
  const receiver = createTestMod({
    id: 'meta-required-receiver',
    basePrice: 10000,
    avg24hPrice: 10000,
    slots: [createSlot('Barrel', [barrel.id], 'mod_barrel', true)],
    categories: createCategories(['Receiver']),
  });
  const cheapStock = createTestMod({
    id: 'meta-cheap-stock',
    basePrice: 1000,
    avg24hPrice: 1000,
    categories: createCategories(['Stock']),
  });
  const recoilStock = createTestMod({
    id: 'meta-recoil-stock',
    basePrice: 8000,
    avg24hPrice: 8000,
    recoilModifier: -20,
    ergonomicsModifier: 10,
    categories: createCategories(['Stock']),
  });
  const testWeapon = createTestWeapon({
    basePrice: 10000,
    avg24hPrice: 10000,
    slots: [
      createSlot('Receiver', [receiver.id], 'mod_reciever', true),
      createSlot('Stock', [cheapStock.id, recoilStock.id], 'mod_stock', true),
    ],
  });
  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(optionalMuzzle, barrel, receiver, cheapStock, recoilStock),
    { ...defaultOptions, maxPrice: 62000 },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, recoilStock.id);
  assertNotInstalled(result, cheapStock.id);
  assertNotInstalled(result, optionalMuzzle.id);
  assert.equal(result.stats.recoilVertical, 80);
  assert.equal(result.stats.price, 38000);
});

test('empty required modules skip reachability traversal in skipped tactical slots', () => {
  const skippedTacticalDescendant = createTestMod({
    id: 'skipped-tactical-descendant',
    categories: createCategories(['Comb. tact. device']),
  });
  Object.defineProperty(skippedTacticalDescendant, 'properties', {
    configurable: true,
    get() {
      throw new Error('reachability traversal should not inspect this descendant');
    },
  });

  const stock = createTestMod({
    id: 'stock-with-skipped-tactical-slot',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 5,
    slots: [createSlot('Tactical', [skippedTacticalDescendant.id], 'mod_tactical_000')],
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [stock.id])],
  });

  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(stock, skippedTacticalDescendant),
    { ...defaultOptions, requiredItemIds: [] },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, stock.id);
});

test('meta build selects critical ergonomics parts before choosing a longer barrel', () => {
  const cqrPistolGripId = '5a33e75ac4a2826c6e06d759';
  const adarWoodStockId = '5c0e2ff6d174af02a1659d4a';
  const tacticalDynamicsGripId = '5b07db875acfc40dc528a5f6';
  const baHansonBarrelId = '63d3ce0446bd475bcb50f55f';
  const ar15TwentyInchBarrelId = '5d440b9fa4b93601354d480c';
  const ar15A2TwentyInchBarrelId = '68a63ac58e1fe612970728f2';
  const prsGen3Id = '5d44069ca4b9361ebd26fc37';
  const shortBarrelId = '55d35ee94bdc2d61338b4568';
  const coltA2StockId = '68a63c1fc92ee33ffa01bf5a';
  const options = {
    forbidSuppressor: false,
    requireSuppressor: false,
    maxWeight: 0,
  };

  const metaResult = calculateBestBuild(weapon, 'meta', 70, 50, modMap, options);
  assert.equal(metaResult.build[0]?.item.id, tacticalDynamicsGripId, 'meta should install a real pistol grip before receiver/barrel scoring');
  assert.equal(hasCategory(metaResult.build[0].item, 'Pistol grip'), true);
  assert.equal(hasCategory(metaResult.build[0].item, 'Stock'), false);
  assertNotInstalled(metaResult, cqrPistolGripId);
  assertNotInstalled(metaResult, adarWoodStockId);
  assert.equal(
    [ar15TwentyInchBarrelId, ar15A2TwentyInchBarrelId].some(itemId => getInstalledItemIds(metaResult).includes(itemId)),
    true,
    'meta should upgrade to a 508 mm barrel after the final ergonomics pass',
  );
  assertNotInstalled(metaResult, baHansonBarrelId);
  assertNotInstalled(metaResult, shortBarrelId);
  assertNotInstalled(metaResult, coltA2StockId);
  assertNotInstalled(metaResult, prsGen3Id);
  assert.ok(metaResult.stats.ergonomics >= 50, `meta ergonomics ${metaResult.stats.ergonomics} should stay above the meta floor`);
  assert.ok(metaResult.stats.recoilVertical <= 52, `meta recoil ${metaResult.stats.recoilVertical} should benefit from a 508 mm barrel`);
  assertNoDuplicateParts(metaResult);
  assertNoInstalledConflicts(metaResult);
  assertStatsMatchParts(metaResult);
});

test('meta stock scoring partially counts ergonomics over cap to beat A2 and heavier PRS GEN3', () => {
  const prsGen3 = modMap['5d44069ca4b9361ebd26fc37'];
  const coltA2Stock = modMap['68a63c1fc92ee33ffa01bf5a'];
  const moeSlkStock = modMap['6529370c405a5f51dd023db8'];
  const ctrStock = modMap['5d135ecbd7ad1a21c176542e'];
  const ddEcbStock = modMap['6516e91f609aaf354b34b3e2'];

  assert.ok(prsGen3, 'PRS GEN3 fixture should exist');
  assert.ok(coltA2Stock, 'Colt A2 stock fixture should exist');
  assert.ok(moeSlkStock, 'MOE SL-K fixture should exist');
  assert.ok(ctrStock, 'CTR fixture should exist');
  assert.ok(ddEcbStock, 'DD ECB fixture should exist');

  const scoreOptions = {
    currentErgo: 50,
    ergoWeight: 1,
    recoilWeight: 3,
    weightWeight: 15,
    overflowErgoWeight: 0.45,
    ergoCap: 50,
  };

  const prsScore = getWeightedPartScore(prsGen3, scoreOptions);
  const coltA2Score = getWeightedPartScore(coltA2Stock, scoreOptions);
  const moeSlkScore = getWeightedPartScore(moeSlkStock, scoreOptions);
  const ctrScore = getWeightedPartScore(ctrStock, scoreOptions);
  const ddEcbScore = getWeightedPartScore(ddEcbStock, scoreOptions);

  assert.ok(moeSlkScore > coltA2Score, `MOE SL-K score ${moeSlkScore} should beat Colt A2 score ${coltA2Score}`);
  assert.ok(moeSlkScore > prsScore, `MOE SL-K score ${moeSlkScore} should beat PRS GEN3 score ${prsScore}`);
  assert.ok(ctrScore > coltA2Score, `CTR score ${ctrScore} should beat Colt A2 score ${coltA2Score}`);
  assert.ok(ddEcbScore > prsScore, `DD ECB score ${ddEcbScore} should beat PRS GEN3 score ${prsScore}`);
  assert.equal(prsGen3.recoilModifier, -24);
  assert.equal(prsGen3.weight, 0.78);
  assert.equal(coltA2Stock.recoilModifier, -23);
  assert.equal(coltA2Stock.weight, 0.42);
});

test('forbidSuppressor excludes silencer parts', () => {
  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    forbidSuppressor: true,
    requireSuppressor: false,
    maxWeight: 0,
  });

  assert.equal(result.build.some(part => hasCategory(part.item, 'Silencer')), false);
  assertNoDuplicateParts(result);
  assertStatsMatchParts(result);
});

test('requireSuppressor installs a compatible silencer', () => {
  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    forbidSuppressor: false,
    requireSuppressor: true,
    maxWeight: 0,
  });

  assert.equal(result.build.some(part => hasCategory(part.item, 'Silencer')), true);
  assertNoDuplicateParts(result);
  assertStatsMatchParts(result);
});

test('maxWeight is enforced as a hard limit when physically possible', () => {
  const maxWeight = 2;
  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    forbidSuppressor: false,
    requireSuppressor: false,
    maxWeight,
  });

  assert.ok(Number(result.stats.weight) <= maxWeight, `weight ${result.stats.weight} exceeds ${maxWeight}`);
  assertNoDuplicateParts(result);
  assertStatsMatchParts(result);
});

test('requireSuppressor installs directly compatible silencer', () => {
  const silencer = createTestMod({
    id: 'direct-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: -10,
    ergonomicsModifier: -2,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Muzzle', [silencer.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(silencer), {
    ...defaultOptions,
    requireSuppressor: true,
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, silencer.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), true);
  assertNoDuplicatePartsForResult(result);
  assertNoInstalledConflictsForWeapon(testWeapon, result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('requireSuppressor installs silencer through adapter chain', () => {
  const silencer = createTestMod({
    id: 'chain-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: -12,
    ergonomicsModifier: -3,
  });
  const adapter = createTestMod({
    id: 'muzzle-adapter',
    categories: createCategories(['Mount']),
    slots: [createSlot('Suppressor', [silencer.id])],
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Muzzle', [adapter.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(adapter, silencer), {
    ...defaultOptions,
    requireSuppressor: true,
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, adapter.id);
  assertInstalled(result, silencer.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), true);
  assertNoDuplicatePartsForResult(result);
  assertNoInstalledConflictsForWeapon(testWeapon, result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('requireSuppressor returns error when no compatible silencer exists', () => {
  const muzzleBrake = createTestMod({
    id: 'muzzle-brake',
    categories: createCategories(['Muzzle Device']),
    recoilModifier: -8,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Muzzle', [muzzleBrake.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(muzzleBrake), {
    ...defaultOptions,
    requireSuppressor: true,
  });

  assert.match(result.error, /suppressor/i);
  assert.equal(hasInstalledCategory(result, 'Silencer'), false);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('forbidSuppressor rejects directly compatible silencer', () => {
  const silencer = createTestMod({
    id: 'forbidden-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: -20,
  });
  const muzzleBrake = createTestMod({
    id: 'allowed-muzzle-brake',
    categories: createCategories(['Muzzle Device']),
    recoilModifier: -5,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Muzzle', [silencer.id, muzzleBrake.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(silencer, muzzleBrake), {
    ...defaultOptions,
    forbidSuppressor: true,
  });

  assert.equal(result.error, undefined);
  assertNotInstalled(result, silencer.id);
  assertInstalled(result, muzzleBrake.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), false);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('optional suppressor can choose non-silencer when it scores better', () => {
  const poorSuppressor = createTestMod({
    id: 'poor-optional-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: 0,
    ergonomicsModifier: -20,
    weight: 1,
  });
  const muzzleBrake = createTestMod({
    id: 'better-muzzle-brake',
    categories: createCategories(['Muzzle Device']),
    recoilModifier: -10,
    ergonomicsModifier: 1,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Muzzle', [poorSuppressor.id, muzzleBrake.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(poorSuppressor, muzzleBrake), defaultOptions);

  assert.equal(result.error, undefined);
  assertInstalled(result, muzzleBrake.id);
  assertNotInstalled(result, poorSuppressor.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), false);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('requireSuppressor skips conflicting part to install silencer chain', () => {
  const silencer = createTestMod({
    id: 'required-chain-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: -10,
    ergonomicsModifier: -2,
  });
  const adapter = createTestMod({
    id: 'required-chain-adapter',
    categories: createCategories(['Mount']),
    slots: [createSlot('Suppressor', [silencer.id])],
  });
  const conflictingStock = createTestMod({
    id: 'conflicting-stock',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 30,
    conflictingItemIds: [silencer.id],
  });
  const testWeapon = createTestWeapon({
    slots: [
      createSlot('Stock', [conflictingStock.id]),
      createSlot('Muzzle', [adapter.id]),
    ],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(conflictingStock, adapter, silencer), {
    ...defaultOptions,
    requireSuppressor: true,
  });

  assert.equal(result.error, undefined);
  assertNotInstalled(result, conflictingStock.id);
  assertInstalled(result, adapter.id);
  assertInstalled(result, silencer.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), true);
  assertNoDuplicatePartsForResult(result);
  assertNoInstalledConflictsForWeapon(testWeapon, result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('requireSuppressor returns error when compatible silencer exceeds max weight', () => {
  const heavySilencer = createTestMod({
    id: 'heavy-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: -20,
    weight: 1,
  });
  const testWeapon = createTestWeapon({
    weight: 1,
    slots: [createSlot('Muzzle', [heavySilencer.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(heavySilencer), {
    ...defaultOptions,
    requireSuppressor: true,
    maxWeight: 1.1,
  });

  assert.match(result.error, /suppressor/i);
  assertNotInstalled(result, heavySilencer.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), false);
  assert.ok(Number(result.stats.weight) <= 1.1, `weight ${result.stats.weight} exceeds 1.1`);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('requiredItemIds force compatible modules into the build', () => {
  const bestStock = createTestMod({
    id: 'best-stock',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 12,
    recoilModifier: -20,
  });
  const requiredStock = createTestMod({
    id: 'required-stock',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 1,
    recoilModifier: -1,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [bestStock.id, requiredStock.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(bestStock, requiredStock), {
    ...defaultOptions,
    requiredItemIds: [requiredStock.id],
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, requiredStock.id);
  assertNotInstalled(result, bestStock.id);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('requiredItemIds can force nested modules even when regular options would filter them', () => {
  const requiredSight = createTestMod({
    id: 'required-sight',
    categories: createCategories(['Sights', 'Reflex sight']),
    ergonomicsModifier: -4,
  });
  const receiver = createTestMod({
    id: 'receiver-with-scope-slot',
    categories: createCategories(['Receiver']),
    slots: [createSlot('Scope', [requiredSight.id], 'mod_scope')],
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Receiver', [receiver.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(receiver, requiredSight), {
    ...defaultOptions,
    requireSight: false,
    sightMode: 'none',
    requiredItemIds: [requiredSight.id],
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, receiver.id);
  assertInstalled(result, requiredSight.id);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('required sight replaces optional sight assemblies instead of stacking with them', () => {
  const mpr45MountId = '5649a2464bdc2d91118b45a8';
  const ffwbMountId = '577d128124597739d65d0e56';
  const ff3SightId = '577d141e24597739c5255e01';
  const geisseleMountId = '618b9643526131765025ab35';
  const razorSightId = '618ba27d9008e4636a67f61d';

  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    ...defaultOptions,
    requireSight: true,
    sightMode: 'any',
    requiredItemIds: [razorSightId],
  });

  const installedSights = result.build.filter(part => hasCategory(part.item, 'Sights'));

  assert.equal(result.error, undefined);
  assertInstalled(result, geisseleMountId);
  assertInstalled(result, razorSightId);
  assertNotInstalled(result, mpr45MountId);
  assertNotInstalled(result, ffwbMountId);
  assertNotInstalled(result, ff3SightId);
  assert.equal(installedSights.length, 1);
  assertNoDuplicateParts(result);
  assertNoInstalledConflicts(result);
  assertStatsMatchParts(result);
});

test('any sight installs only one optional sight assembly across separate mount slots', () => {
  const firstSight = createTestMod({
    id: 'first-optional-sight',
    recoilModifier: -2,
    categories: createCategories(['Sights', 'Reflex sight']),
  });
  const secondSight = createTestMod({
    id: 'second-optional-sight',
    recoilModifier: -3,
    categories: createCategories(['Sights', 'Reflex sight']),
  });
  const firstMount = createTestMod({
    id: 'first-optional-mount',
    ergonomicsModifier: 5,
    categories: createCategories(['Mount']),
    slots: [createSlot('Scope', [firstSight.id], 'mod_scope', true)],
  });
  const secondMount = createTestMod({
    id: 'second-optional-mount',
    ergonomicsModifier: 5,
    categories: createCategories(['Mount']),
    slots: [createSlot('Scope', [secondSight.id], 'mod_scope', true)],
  });
  const receiver = createTestMod({
    id: 'receiver-with-two-scope-slots',
    categories: createCategories(['Receiver']),
    slots: [
      createSlot('Scope', [firstMount.id], 'mod_scope_000'),
      createSlot('Scope', [secondMount.id], 'mod_scope_001'),
    ],
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Receiver', [receiver.id], 'mod_reciever', true)],
  });
  const result = calculateBestBuild(
    testWeapon,
    'meta',
    50,
    100,
    createModMap(receiver, firstSight, secondSight, firstMount, secondMount),
    { ...defaultOptions, requireSight: true, sightMode: 'any' },
  );
  const installedSights = result.build.filter(part => hasCategory(part.item, 'Sights'));
  const installedMounts = result.build.filter(part => hasCategory(part.item, 'Mount'));

  assert.equal(result.error, undefined);
  assert.equal(installedSights.length, 1);
  assert.equal(installedMounts.length, 1);
});

test('required nested flashlight keeps tactical mount slots available', () => {
  const mlokMountId = '669a6a4a525be1d2d004b8eb';
  const ringMountId = '6267c6396b642f77f56f5c1c';
  const xhp35Id = '59d790f486f77403cb06aec6';

  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    ...defaultOptions,
    includeLaser: false,
    includeFlashlight: false,
    requiredItemIds: [xhp35Id],
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, mlokMountId);
  assertInstalled(result, ringMountId);
  assertInstalled(result, xhp35Id);
  assertNoDuplicateParts(result);
  assertNoInstalledConflicts(result);
  assertStatsMatchParts(result);
});

test('required nested flashlight is not blocked by the flashlight option', () => {
  const duplicateMlokMountId = '6269545d0e57f218e4548ca2';
  const duplicateRingMountId = '57d17e212459775a1179a0f5';
  const xhp35Id = '59d790f486f77403cb06aec6';

  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    ...defaultOptions,
    includeLaser: false,
    includeFlashlight: true,
    requiredItemIds: [xhp35Id],
  });

  const installedFlashlights = result.build.filter(part => hasCategory(part.item, 'Flashlight'));

  assert.equal(result.error, undefined);
  assertInstalled(result, xhp35Id);
  assertNotInstalled(result, duplicateMlokMountId);
  assertNotInstalled(result, duplicateRingMountId);
  assert.equal(installedFlashlights.length, 1);
  assertNoDuplicateParts(result);
  assertNoInstalledConflicts(result);
  assertStatsMatchParts(result);
});

test('requiredItemIds reports incompatible modules', () => {
  const compatibleStock = createTestMod({
    id: 'compatible-stock',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 5,
  });
  const incompatibleGrip = createTestMod({
    id: 'incompatible-grip',
    shortName: 'Bad Req',
    categories: createCategories(['Pistol grip']),
    ergonomicsModifier: 20,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [compatibleStock.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(compatibleStock, incompatibleGrip), {
    ...defaultOptions,
    requiredItemIds: [incompatibleGrip.id],
  });

  assert.match(result.error, /Required modules could not be installed/i);
  assert.match(result.error, /Bad Req/);
  assertNotInstalled(result, incompatibleGrip.id);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('price-constrained Meta uses normalized price for selected price mode', () => {
  const normalizedCheapMod = createTestMod({
    id: 'normalized-cheap-mod',
    shortName: 'NCM',
    avg24hPrice: 100000,
    basePrice: 100000,
    ergonomicsModifier: 0,
    recoilModifier: -1,
    weight: 0.1,
  });

  normalizedCheapMod.price = {
    value: 100,
    mode: 'pvp',
  };

  const normalizedExpensiveMod = createTestMod({
    id: 'normalized-expensive-mod',
    shortName: 'NEM',
    avg24hPrice: 1,
    basePrice: 1,
    ergonomicsModifier: 0,
    recoilModifier: -1,
    weight: 0.1,
  });

  normalizedExpensiveMod.price = {
    value: 100000,
    mode: 'pvp',
  };

  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [normalizedCheapMod.id, normalizedExpensiveMod.id])],
  });

  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(normalizedCheapMod, normalizedExpensiveMod),
    {
      ...defaultOptions,
      priceMode: 'pvp',
      maxPrice: 1_000_000,
    },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, normalizedCheapMod.id);
  assertNotInstalled(result, normalizedExpensiveMod.id);
  assertStatsMatchPartsForWeapon(testWeapon, result, { priceMode: 'pvp' });
});

test('price-constrained Meta ignores normalized price from a different price mode', () => {
  const wrongModeCheapMod = createTestMod({
    id: 'wrong-mode-cheap-mod',
    shortName: 'WMCM',
    avg24hPrice: 100000,
    basePrice: 100000,
    ergonomicsModifier: 0,
    recoilModifier: -1,
    weight: 0.1,
  });

  wrongModeCheapMod.price = {
    value: 1,
    mode: 'pve',
  };

  const selectedModeMod = createTestMod({
    id: 'selected-mode-mod',
    shortName: 'SMM',
    avg24hPrice: 1000,
    basePrice: 1000,
    ergonomicsModifier: 0,
    recoilModifier: -1,
    weight: 0.1,
  });

  selectedModeMod.price = {
    value: 1000,
    mode: 'pvp',
  };

  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [wrongModeCheapMod.id, selectedModeMod.id])],
  });

  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(wrongModeCheapMod, selectedModeMod),
    {
      ...defaultOptions,
      priceMode: 'pvp',
      maxPrice: 1_000_000,
    },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, selectedModeMod.id);
  assertNotInstalled(result, wrongModeCheapMod.id);
  assertStatsMatchPartsForWeapon(testWeapon, result, { priceMode: 'pvp' });
});

test('Magazine Selection Logic: should fallback to 30 capacity by default and select better candidate', () => {
  const mag30Steel = createTestMod({
    id: 'mag_30_steel',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -2,
    recoilModifier: -0.01,
    properties: { capacity: 30, loadModifier: 0.05, ammoCheckModifier: 0.1 }
  });
  const mag30Pmag = createTestMod({
    id: 'mag_30_pmag',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -1,
    recoilModifier: -0.01,
    properties: { capacity: 30, loadModifier: 0.02, ammoCheckModifier: 0.05 }
  });
  const mag60Drum = createTestMod({
    id: 'mag_60_drum',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -8,
    recoilModifier: -0.03,
    properties: { capacity: 60, loadModifier: 0.15, ammoCheckModifier: 0.25 }
  });

  const testWeapon = createTestWeapon({
    slots: [createSlot('mag', [mag30Steel.id, mag30Pmag.id, mag60Drum.id])],
  });

  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(mag30Steel, mag30Pmag, mag60Drum),
    defaultOptions
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, mag30Pmag.id);
  assertNotInstalled(result, mag30Steel.id);
  assertNotInstalled(result, mag60Drum.id);
});

test('Magazine Selection Logic: should choose exact requested capacity', () => {
  const mag30Pmag = createTestMod({
    id: 'mag_30_pmag',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -1,
    recoilModifier: -0.01,
    properties: { capacity: 30, loadModifier: 0.02, ammoCheckModifier: 0.05 }
  });
  const mag60Drum = createTestMod({
    id: 'mag_60_drum',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -8,
    recoilModifier: -0.03,
    properties: { capacity: 60, loadModifier: 0.15, ammoCheckModifier: 0.25 }
  });

  const testWeapon = createTestWeapon({
    slots: [createSlot('mag', [mag30Pmag.id, mag60Drum.id])],
  });

  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(mag30Pmag, mag60Drum),
    {
      ...defaultOptions,
      magazineCapacity: 60,
    }
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, mag60Drum.id);
  assertNotInstalled(result, mag30Pmag.id);
});

test('Magazine Selection Logic: should fallback to nearest capacity if exact match is missing', () => {
  const mag30Pmag = createTestMod({
    id: 'mag_30_pmag',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -1,
    recoilModifier: -0.01,
    properties: { capacity: 30, loadModifier: 0.02, ammoCheckModifier: 0.05 }
  });
  const mag60Drum = createTestMod({
    id: 'mag_60_drum',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -8,
    recoilModifier: -0.03,
    properties: { capacity: 60, loadModifier: 0.15, ammoCheckModifier: 0.25 }
  });

  const testWeapon = createTestWeapon({
    slots: [createSlot('mag', [mag30Pmag.id, mag60Drum.id])],
  });

  // Requesting 40: 30 is closer (diff 10) than 60 (diff 20)
  const result30 = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(mag30Pmag, mag60Drum),
    {
      ...defaultOptions,
      magazineCapacity: 40,
    }
  );

  assert.equal(result30.error, undefined);
  assertInstalled(result30, mag30Pmag.id);
  assertNotInstalled(result30, mag60Drum.id);

  // Requesting 50: 60 is closer (diff 10) than 30 (diff 20)
  const result60 = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(mag30Pmag, mag60Drum),
    {
      ...defaultOptions,
      magazineCapacity: 50,
    }
  );

  assert.equal(result60.error, undefined);
  assertInstalled(result60, mag60Drum.id);
  assertNotInstalled(result60, mag30Pmag.id);
});

test('Budget Limit Option: should restrict the build cost to maxPrice', () => {
  const expensiveMod = createTestMod({
    id: 'expensive_mod',
    avg24hPrice: 100000,
    basePrice: 100000,
    ergonomicsModifier: 20,
    recoilModifier: -10,
  });
  const cheapMod = createTestMod({
    id: 'cheap_mod',
    avg24hPrice: 1000,
    basePrice: 1000,
    ergonomicsModifier: 5,
    recoilModifier: -2,
  });

  const testWeapon = createTestWeapon({
    basePrice: 10000,
    avg24hPrice: 10000,
    slots: [createSlot('Stock', [expensiveMod.id, cheapMod.id])],
  });

  // Scenario 1: No budget limit, should choose expensiveMod for better stats
  const resultNoLimit = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(expensiveMod, cheapMod),
    defaultOptions
  );
  assert.equal(resultNoLimit.error, undefined);
  assertInstalled(resultNoLimit, expensiveMod.id);
  assertNotInstalled(resultNoLimit, cheapMod.id);

  // Scenario 2: Budget limit allows cheapMod but not expensiveMod
  // Weapon (10000) + cheapMod (1000) = 11000 <= 12000
  const resultWithLimit = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(expensiveMod, cheapMod),
    {
      ...defaultOptions,
      maxPrice: 12000,
    }
  );
  assert.equal(resultWithLimit.error, undefined);
  assertInstalled(resultWithLimit, cheapMod.id);
  assertNotInstalled(resultWithLimit, expensiveMod.id);

  // Scenario 3: Budget limit is too low, even weapon itself exceeds it
  const resultTooLow = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(expensiveMod, cheapMod),
    {
      ...defaultOptions,
      maxPrice: 5000,
    }
  );
  assert.match(resultTooLow.warning, /exceeds the selected max price/i);
});

test('recalculateBuildStats should correctly sum ergonomics, recoil, weight and price', () => {
  const testWeapon = createTestWeapon({
    ergonomics: 50,
    recoilVertical: 100,
    recoilHorizontal: 100,
    weight: 2.0,
    basePrice: 50000,
    avg24hPrice: 50000,
  });

  const part1 = createTestMod({
    id: 'part1',
    ergonomicsModifier: 5,
    recoilModifier: -3,
    weight: 0.2,
    basePrice: 10000,
    avg24hPrice: 10000,
  });

  const part2 = createTestMod({
    id: 'part2',
    ergonomicsModifier: -2,
    recoilModifier: -5,
    weight: 0.3,
    basePrice: 15000,
    avg24hPrice: 15000,
  });

  const buildParts = [
    { slotName: 'Stock', item: part1 },
    { slotName: 'Foregrip', item: part2 },
  ];

  const result = recalculateBuildStats(testWeapon, buildParts);

  assert.equal(result.stats.ergonomics, 53);
  assert.equal(result.stats.recoilVertical, 92);
  assert.equal(result.stats.recoilHorizontal, 92);
  assert.equal(result.stats.weight, '2.50');
  assert.equal(result.stats.price, 75000);
});

test('tactical accessories options should correctly filter and install laser/flashlight devices', () => {
  const laserMod = createTestMod({
    id: 'laser_pointer',
    name: 'Laser Pointer',
    shortName: 'Laser',
    ergonomicsModifier: 2,
    weight: 0.1,
    basePrice: 5000,
    avg24hPrice: 5000,
    categories: createCategories(['Comb. tact. device']),
  });

  const flashlightMod = createTestMod({
    id: 'flashlight',
    name: 'Tactical Flashlight',
    shortName: 'Flashlight',
    ergonomicsModifier: 1,
    weight: 0.1,
    basePrice: 4000,
    avg24hPrice: 4000,
    categories: createCategories(['Flashlight']),
  });

  const testWeapon = createTestWeapon({
    slots: [
      createSlot('mod_tactical_000', [laserMod.id, flashlightMod.id]),
      createSlot('mod_tactical_001', [laserMod.id, flashlightMod.id]),
    ],
  });

  const defaultOptions = {
    magazineCapacity: 30,
  };

  const modsMap = createModMap(laserMod, flashlightMod);

  // 1. both disabled -> should not install any tactical devices
  const resultExclude = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, includeLaser: false, includeFlashlight: false });
  assert.equal(resultExclude.error, undefined);
  assertNotInstalled(resultExclude, laserMod.id);
  assertNotInstalled(resultExclude, flashlightMod.id);

  // 2. only laser enabled -> should install laserMod but not flashlightMod
  const resultLaser = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, includeLaser: true, includeFlashlight: false });
  assert.equal(resultLaser.error, undefined);
  assertInstalled(resultLaser, laserMod.id);
  assertNotInstalled(resultLaser, flashlightMod.id);
  assert.equal(resultLaser.build.length, 1);

  // 3. only flashlight enabled -> should install flashlightMod but not laserMod
  const resultFlashlight = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, includeLaser: false, includeFlashlight: true });
  assert.equal(resultFlashlight.error, undefined);
  assertInstalled(resultFlashlight, flashlightMod.id);
  assertNotInstalled(resultFlashlight, laserMod.id);
  assert.equal(resultFlashlight.build.length, 1);

  // 4. both enabled -> should install both laserMod and flashlightMod (one of each type)
  const resultBoth = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, includeLaser: true, includeFlashlight: true });
  assert.equal(resultBoth.error, undefined);
  assertInstalled(resultBoth, laserMod.id);
  assertInstalled(resultBoth, flashlightMod.id);
  assert.equal(resultBoth.build.length, 2);
});

test('requireSight and sightMode options should correctly filter and guarantee sight installation', () => {
  const reflexSight = createTestMod({
    id: 'reflex_sight',
    name: 'Reflex Sight',
    shortName: 'Reflex',
    ergonomicsModifier: -1,
    weight: 0.1,
    basePrice: 10000,
    avg24hPrice: 10000,
    categories: createCategories(['Reflex sight', 'Sights']),
    properties: {
      zoomLevels: [[1]],
    },
  });

  const scopeSight = createTestMod({
    id: 'scope_sight',
    name: 'Sniper Scope',
    shortName: 'Scope',
    ergonomicsModifier: -4,
    weight: 0.5,
    basePrice: 30000,
    avg24hPrice: 30000,
    categories: createCategories(['Scope', 'Sights']),
    properties: {
      zoomLevels: [[4]],
    },
  });

  const testWeapon = createTestWeapon({
    slots: [
      createSlot('mod_scope', [reflexSight.id, scopeSight.id]),
    ],
  });

  const defaultOptions = {
    magazineCapacity: 30,
    requireSight: true,
  };

  const modsMap = createModMap(reflexSight, scopeSight);

  // 1. requireSight = true, sightMode = 'reflex' -> should install reflexSight
  const resultReflex = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, sightMode: 'reflex' });
  assert.equal(resultReflex.error, undefined);
  assertInstalled(resultReflex, reflexSight.id);
  assertNotInstalled(resultReflex, scopeSight.id);

  // 2. requireSight = true, sightMode = 'scope' -> should install scopeSight
  const resultScope = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, sightMode: 'scope' });
  assert.equal(resultScope.error, undefined);
  assertInstalled(resultScope, scopeSight.id);
  assertNotInstalled(resultScope, reflexSight.id);

  // 3. requireSight = true, sightMode = 'any' -> should choose reflexSight (better ergonomics -1 > -4)
  const resultAny = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, sightMode: 'any' });
  assert.equal(resultAny.error, undefined);
  assertInstalled(resultAny, reflexSight.id);
  assertNotInstalled(resultAny, scopeSight.id);

  // 4. requireSight = true, sightMode = 1 -> should install reflexSight
  const resultZoom1 = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, sightMode: 1 });
  assert.equal(resultZoom1.error, undefined);
  assertInstalled(resultZoom1, reflexSight.id);
  assertNotInstalled(resultZoom1, scopeSight.id);

  // 5. requireSight = true, sightMode = 4 -> should install scopeSight
  const resultZoom4 = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, sightMode: 4 });
  assert.equal(resultZoom4.error, undefined);
  assertInstalled(resultZoom4, scopeSight.id);
  assertNotInstalled(resultZoom4, reflexSight.id);

  // 6. requireSight = false, sightMode = 'none' -> should not install any sights
  const resultNone = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, requireSight: false, sightMode: 'none' });
  assert.equal(resultNone.error, undefined);
  assertNotInstalled(resultNone, reflexSight.id);
  assertNotInstalled(resultNone, scopeSight.id);
});
