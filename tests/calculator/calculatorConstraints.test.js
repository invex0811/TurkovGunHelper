import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild } from '../../src/domain/calculator.js';
import {
  weapon,
  modMap,
  assertNoDuplicateParts,
  assertNoInstalledConflicts,
  assertStatsMatchParts,
  createCategories,
  createSlot,
  createTestWeapon,
  createTestMod,
  createModMap,
  assertInstalled,
  assertNotInstalled,
  defaultOptions,
} from './calculatorTestHelpers.js';

test('Constraints finds a build within limits taken from the Meta build', () => {
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
  assert.equal(customResult.constraintEvaluation.satisfied, true);
});


test('Constraints ergonomics minimum uses the displayed value', () => {
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
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.ergonomics, 60);
  assertInstalled(result, closePart.id);
});


test('Constraints vertical and horizontal recoil limits apply together', () => {
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
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.recoilVertical, 80);
  assert.equal(result.stats.recoilHorizontal, 160);
  assertInstalled(result, recoilPart.id);
});


test('Constraints beam keeps repeated root identifiers as distinct required slot instances', () => {
  const firstPart = createTestMod({ id: 'duplicate-root-first', ergonomicsModifier: 5 });
  const secondPart = createTestMod({ id: 'duplicate-root-second', ergonomicsModifier: 5 });
  const testWeapon = createTestWeapon({
    ergonomics: 50,
    slots: [
      createSlot('Duplicate root A', [firstPart.id], 'duplicate_root', true),
      createSlot('Duplicate root B', [secondPart.id], 'duplicate_root', true),
    ],
  });

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    60,
    100,
    createModMap(firstPart, secondPart),
    defaultOptions,
    { ergonomics: 60, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.ergonomics, 60);
  assertInstalled(result, firstPart.id);
  assertInstalled(result, secondPart.id);
});


test('Constraints reject a base weapon that already exceeds the maximum price', () => {
  const targetPart = createTestMod({ id: 'budget-target-part', ergonomicsModifier: 10, avg24hPrice: 200 });
  const testWeapon = createTestWeapon({
    basePrice: 1_000,
    avg24hPrice: 1_000,
    slots: [createSlot('Stock', [targetPart.id], 'mod_stock', true)],
  });
  const profile = { ergonomics: 60, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const overBudget = calculateBestBuild(
    testWeapon,
    'custom',
    60,
    100,
    createModMap(targetPart),
    { ...defaultOptions, maxPrice: 500 },
    profile,
  );
  const affordable = calculateBestBuild(
    testWeapon,
    'custom',
    60,
    100,
    createModMap(targetPart),
    { ...defaultOptions, maxPrice: 1_500 },
    profile,
  );

  assert.equal(overBudget.errorCode, 'MAX_PRICE_EXCEEDED');
  assert.match(overBudget.error, /selected max price/i);
  const priceError = overBudget.errorDetails.find(detail => detail.code === 'MAX_PRICE_EXCEEDED');
  assert.equal(priceError.params.maxPrice, 500);
  assert.ok(priceError.params.price > 500);
  assert.equal(affordable.error, undefined);
  assert.equal(affordable.errorDetails, undefined);
  assertInstalled(affordable, targetPart.id);
});


test('Constraints final ties choose lower price independently of allowed-item order', () => {
  const expensive = createTestMod({ id: 'target-expensive', ergonomicsModifier: 10, avg24hPrice: 1_100 });
  const cheap = createTestMod({ id: 'target-cheap', ergonomicsModifier: 10, avg24hPrice: 200 });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [expensive.id, cheap.id], 'mod_stock', true)],
  });
  const profile = { ergonomics: 60, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon, 'custom', 60, 100, createModMap(expensive, cheap), defaultOptions, profile,
  );

  assert.equal(result.constraintEvaluation.satisfied, true);
  assertInstalled(result, cheap.id);
  assertNotInstalled(result, expensive.id);
});


test('Constraints final ties choose build key independently of allowed-item order', () => {
  const laterKey = createTestMod({ id: 'z-target-tie', ergonomicsModifier: 10, avg24hPrice: 200 });
  const earlierKey = createTestMod({ id: 'a-target-tie', ergonomicsModifier: 10, avg24hPrice: 200 });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [laterKey.id, earlierKey.id], 'mod_stock', true)],
  });
  const profile = { ergonomics: 60, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon, 'custom', 60, 100, createModMap(laterKey, earlierKey), defaultOptions, profile,
  );

  assert.equal(result.constraintEvaluation.satisfied, true);
  assertInstalled(result, earlierKey.id);
  assertNotInstalled(result, laterKey.id);
});


test('Constraints routes retain a ninth required-item provider', () => {
  const parts = Array.from({ length: 9 }, (_, index) => createTestMod({
    id: `route-required-${String(index + 1).padStart(2, '0')}`,
    weight: 0,
  }));
  const requiredPart = parts.at(-1);
  const testWeapon = createTestWeapon({
    slots: [createSlot('Required receiver', parts.map(part => part.id), 'mod_receiver', true)],
  });
  const profile = { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(...parts),
    { ...defaultOptions, requiredItemIds: [requiredPart.id] },
    profile,
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, requiredPart.id);
});


test('Constraints routes retain a ninth suppressor provider', () => {
  const regularParts = Array.from({ length: 8 }, (_, index) => createTestMod({
    id: `route-regular-${String(index + 1).padStart(2, '0')}`,
    weight: 0,
  }));
  const suppressor = createTestMod({
    id: 'route-suppressor-09',
    weight: 0,
    categories: createCategories(['Silencer']),
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Required muzzle', [...regularParts, suppressor].map(part => part.id), 'mod_muzzle', true)],
  });
  const profile = { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(...regularParts, suppressor),
    { ...defaultOptions, requireSuppressor: true },
    profile,
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, suppressor.id);
});


test('Constraints routes retain a ninth maximum-price-feasible required choice', () => {
  const expensiveParts = Array.from({ length: 8 }, (_, index) => createTestMod({
    id: `route-expensive-${String(index + 1).padStart(2, '0')}`,
    avg24hPrice: 1_000,
    basePrice: 1_000,
    weight: 0,
  }));
  const affordablePart = createTestMod({
    id: 'route-affordable-09',
    avg24hPrice: 100,
    basePrice: 100,
    weight: 0,
  });
  const testWeapon = createTestWeapon({
    avg24hPrice: 100,
    basePrice: 100,
    slots: [createSlot('Required stock', [...expensiveParts, affordablePart].map(part => part.id), 'mod_stock', true)],
  });
  const profile = { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(...expensiveParts, affordablePart),
    { ...defaultOptions, maxPrice: 200 },
    profile,
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.price, 200);
  assertInstalled(result, affordablePart.id);
});


test('Constraints global frontier retains required coverage from an earlier root', () => {
  const regularFirstRootParts = Array.from({ length: 8 }, (_, index) => createTestMod({
    id: `frontier-regular-first-${String(index + 1).padStart(2, '0')}`,
    weight: 0,
  }));
  const requiredPart = createTestMod({
    id: 'frontier-required-first-09',
    ergonomicsModifier: -50,
    weight: 0,
  });
  const secondRootParts = Array.from({ length: 9 }, (_, index) => createTestMod({
    id: `frontier-second-${String(index + 1).padStart(2, '0')}`,
    weight: 0,
  }));
  const testWeapon = createTestWeapon({
    slots: [
      createSlot('First required root', [...regularFirstRootParts, requiredPart].map(part => part.id), 'mod_first', true),
      createSlot('Second required root', secondRootParts.map(part => part.id), 'mod_second', true),
    ],
  });
  const profile = { ergonomics: 0, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(...regularFirstRootParts, requiredPart, ...secondRootParts),
    { ...defaultOptions, requiredItemIds: [requiredPart.id] },
    profile,
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, requiredPart.id);
});


test('Constraints global frontier retains the cheapest complete maximum-price route', () => {
  const createRootParts = prefix => [
    ...Array.from({ length: 8 }, (_, index) => createTestMod({
      id: `${prefix}-expensive-${String(index + 1).padStart(2, '0')}`,
      ergonomicsModifier: 10,
      avg24hPrice: 200,
      basePrice: 200,
      weight: 0,
    })),
    createTestMod({
      id: `${prefix}-cheap-09`,
      ergonomicsModifier: -10,
      avg24hPrice: 100,
      basePrice: 100,
      weight: 0,
    }),
  ];
  const firstRootParts = createRootParts('frontier-price-first');
  const secondRootParts = createRootParts('frontier-price-second');
  const testWeapon = createTestWeapon({
    avg24hPrice: 100,
    basePrice: 100,
    slots: [
      createSlot('First required root', firstRootParts.map(part => part.id), 'mod_first', true),
      createSlot('Second required root', secondRootParts.map(part => part.id), 'mod_second', true),
    ],
  });
  const profile = { ergonomics: 0, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(...firstRootParts, ...secondRootParts),
    { ...defaultOptions, maxPrice: 300 },
    profile,
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.price, 300);
  assertInstalled(result, firstRootParts.at(-1).id);
  assertInstalled(result, secondRootParts.at(-1).id);
});


test('Constraints ignores conflicting nested suppressor paths when retaining routes', () => {
  const blockedSuppressor = createTestMod({
    id: 'frontier-blocked-suppressor',
    categories: createCategories(['Silencer']),
    weight: 0,
  });
  const falseProviders = Array.from({ length: 24 }, (_, index) => createTestMod({
    id: `frontier-false-suppressor-${String(index + 1).padStart(2, '0')}`,
    conflictingItemIds: [blockedSuppressor.id],
    slots: [createSlot('Blocked suppressor', [blockedSuppressor.id])],
    weight: 0,
  }));
  const directSuppressor = createTestMod({
    id: 'frontier-direct-suppressor',
    ergonomicsModifier: -10,
    categories: createCategories(['Silencer']),
    weight: 0,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot(
      'Required muzzle',
      [...falseProviders, directSuppressor].map(part => part.id),
      'mod_muzzle',
      true,
    )],
  });
  const profile = { ergonomics: 0, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(...falseProviders, blockedSuppressor, directSuppressor),
    { ...defaultOptions, requireSuppressor: true },
    profile,
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, directSuppressor.id);
  assertNotInstalled(result, blockedSuppressor.id);
});


test('Constraints keeps a nested plan that covers required items from independent slots', () => {
  const requiredX = createTestMod({ id: 'frontier-required-x', weight: 0 });
  const requiredY = createTestMod({ id: 'frontier-required-y', weight: 0 });
  const falseRoots = Array.from({ length: 24 }, (_, index) => createTestMod({
    id: `frontier-exclusive-${String(index + 1).padStart(2, '0')}`,
    slots: [createSlot('Mutually exclusive', [requiredX.id, requiredY.id])],
    weight: 0,
  }));
  const completeRoot = createTestMod({
    id: 'frontier-complete-required-root',
    ergonomicsModifier: -10,
    slots: [
      createSlot('Required X', [requiredX.id]),
      createSlot('Required Y', [requiredY.id]),
    ],
    weight: 0,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot(
      'Required root',
      [...falseRoots, completeRoot].map(part => part.id),
      'mod_root',
      true,
    )],
  });
  const profile = { ergonomics: 0, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(...falseRoots, completeRoot, requiredX, requiredY),
    { ...defaultOptions, requiredItemIds: [requiredX.id, requiredY.id] },
    profile,
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, completeRoot.id);
  assertInstalled(result, requiredX.id);
  assertInstalled(result, requiredY.id);
});


test('Constraints frontier retains a compatible first root for a mandatory later root', () => {
  const requiredSecondRoot = createTestMod({ id: 'frontier-required-second-root', weight: 0 });
  const conflictingCheapRoots = Array.from({ length: 24 }, (_, index) => createTestMod({
    id: `frontier-conflicting-first-${String(index + 1).padStart(2, '0')}`,
    conflictingItemIds: [requiredSecondRoot.id],
    weight: 0,
  }));
  const compatibleFirstRoot = createTestMod({
    id: 'frontier-compatible-first-root',
    ergonomicsModifier: -10,
    weight: 0,
  });
  const testWeapon = createTestWeapon({
    slots: [
      createSlot('First required root', [...conflictingCheapRoots, compatibleFirstRoot].map(part => part.id), 'mod_first', true),
      createSlot('Second required root', [requiredSecondRoot.id], 'mod_second', true),
    ],
  });
  const profile = { ergonomics: 0, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(...conflictingCheapRoots, compatibleFirstRoot, requiredSecondRoot),
    { ...defaultOptions, requiredItemIds: [requiredSecondRoot.id] },
    profile,
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, compatibleFirstRoot.id);
  assertInstalled(result, requiredSecondRoot.id);
});


test('Constraints frontier retains a combined required-item, suppressor, and budget route', () => {
  const requiredItem = createTestMod({
    id: 'frontier-combined-required-item',
    avg24hPrice: 50,
    basePrice: 50,
    weight: 0,
  });
  const suppressor = createTestMod({
    id: 'frontier-combined-suppressor',
    avg24hPrice: 50,
    basePrice: 50,
    categories: createCategories(['Silencer']),
    weight: 0,
  });
  const feasibleParent = createTestMod({
    id: 'frontier-combined-parent',
    avg24hPrice: 50,
    basePrice: 50,
    slots: [
      createSlot('Required item path', [requiredItem.id]),
      createSlot('Suppressor path', [suppressor.id]),
    ],
    weight: 0,
  });
  const expensiveParents = Array.from({ length: 8 }, (_, index) => createTestMod({
    id: `frontier-combined-expensive-${String(index + 1).padStart(2, '0')}`,
    avg24hPrice: 200,
    basePrice: 200,
    weight: 0,
  }));
  const requiredSecondRoot = createTestMod({
    id: 'frontier-combined-second-root',
    avg24hPrice: 50,
    basePrice: 50,
    weight: 0,
  });
  const testWeapon = createTestWeapon({
    avg24hPrice: 100,
    basePrice: 100,
    slots: [
      createSlot('First required root', [...expensiveParents, feasibleParent].map(part => part.id), 'mod_first', true),
      createSlot('Second required root', [requiredSecondRoot.id], 'mod_second', true),
    ],
  });
  const profile = { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(
      ...expensiveParents,
      feasibleParent,
      requiredItem,
      suppressor,
      requiredSecondRoot,
    ),
    {
      ...defaultOptions,
      maxPrice: 300,
      requireSuppressor: true,
      requiredItemIds: [requiredItem.id],
    },
    profile,
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.price, 300);
  assertInstalled(result, feasibleParent.id);
  assertInstalled(result, requiredItem.id);
  assertInstalled(result, suppressor.id);
  assertInstalled(result, requiredSecondRoot.id);
});


test('Constraints price follows the active trader policy', () => {
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
  );
  const fleaOnly = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(pricedPart),
    { ...defaultOptions, includeTraderPrices: false },
    profile,
  );

  assert.equal(withTrader.error, undefined);
  assert.equal(withTrader.stats.price, 5_000);
  assert.equal(fleaOnly.error, undefined);
  assert.equal(fleaOnly.stats.price, 11_000);
});


test('unreachable limits return the closest build with structured diagnostics', () => {
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
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, part.id);
  assert.equal(result.constraintEvaluation.satisfied, false);
  assert.deepEqual(result.constraintEvaluation.failures.map(failure => failure.key), ['ergonomics']);
  assert.equal(result.constraintEvaluation.failures[0].actual, 60);
  assert.equal(result.constraintEvaluation.failures[0].violation, 20);
});


test('Constraints prefer a build within the desired weight limit', () => {
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
  assert.equal(result.constraintEvaluation.satisfied, true);
});


test('Constraints return a heavy required stock above the soft weight limit', () => {
  const heavyStock = createTestMod({ id: 'only-heavy-stock', weight: 3 });
  const testWeapon = createTestWeapon({
    weight: 1,
    slots: [createSlot('Stock', [heavyStock.id], 'mod_stock', true)],
  });
  const profile = { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: 3.5, price: 0 };

  const result = calculateBestBuild(
    testWeapon, 'custom', 50, 100, createModMap(heavyStock), defaultOptions, profile,
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, heavyStock.id);
  assert.equal(result.stats.weight, '4.00');
  assert.deepEqual(result.constraintEvaluation.failures.map(failure => failure.key), ['weight']);
  assert.equal(result.constraintEvaluation.axes.weight.violation, 0.5);
});


test('Constraints keep the profile weight soft and the maxWeight option hard', () => {
  const heavyStock = createTestMod({ id: 'weight-limit-heavy-stock', weight: 2, recoilModifier: -30 });
  const lightStock = createTestMod({ id: 'weight-limit-light-stock', weight: 0.5 });
  const testWeapon = createTestWeapon({
    weight: 1,
    slots: [createSlot('Stock', [heavyStock.id, lightStock.id], 'mod_stock', true)],
  });
  const modsMap = createModMap(heavyStock, lightStock);
  const calculate = (profileWeight, maxWeight) => calculateBestBuild(
    testWeapon, 'custom', 50, 100, modsMap, { ...defaultOptions, maxWeight },
    { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: profileWeight, price: 0 },
  );

  assertInstalled(calculate(0, 0), heavyStock.id);
  assertInstalled(calculate(2.5, 0), lightStock.id);
  assertInstalled(calculate(0, 2.5), lightStock.id);
  assertInstalled(calculate(5, 2.5), lightStock.id);
  assertInstalled(calculate(2.5, 5), lightStock.id);
});


test('Constraints keep a specific builder failure for an unmet hard requirement', () => {
  const stock = createTestMod({ id: 'no-suppressor-stock' });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [stock.id], 'mod_stock', true)],
  });

  const result = calculateBestBuild(
    testWeapon, 'custom', 50, 100, createModMap(stock),
    { ...defaultOptions, requireSuppressor: true },
    { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 0 },
  );

  assert.match(result.error, /No compatible suppressor/);
  assert.deepEqual(result.build, []);
});


test('M4A1 Constraints 4 / 50 / 50 / 50 returns the nearest build instead of an error', () => {
  const limits = { weight: 4, verticalRecoil: 50, horizontalRecoil: 50, ergonomics: 50, price: 0 };
  const result = calculateBestBuild(
    weapon,
    'custom',
    limits.ergonomics,
    limits.verticalRecoil,
    modMap,
    { forbidSuppressor: false, requireSuppressor: false, maxWeight: 0 },
    limits,
  );

  assert.equal(result.error, undefined);
  assert.ok(result.build.length > 0);
  assertNoDuplicateParts(result);
  assertNoInstalledConflicts(result);
  assertStatsMatchParts(result);
  assert.equal(result.constraintEvaluation.satisfied, false);
  assert.ok(result.constraintEvaluation.totalViolation > 0);
  assert.equal(result.constraintEvaluation.axes.horizontalRecoil.satisfied, false);
  assert.ok(result.warnings.some(warning => warning.code === 'REQUIREMENTS_UNMET_CLOSEST_BUILD'));
});

