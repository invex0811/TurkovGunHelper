import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild } from '../../src/domain/calculator.js';
import {
  weapon,
  modMap,
  assertNoDuplicateParts,
  assertStatsMatchParts,
  createCategories,
  createSlot,
  createTestWeapon,
  createTestMod,
  createModMap,
  assertInstalled,
  assertNotInstalled,
  assertStatsMatchPartsForWeapon,
  defaultOptions,
} from './calculatorTestHelpers.js';

test('budget Custom prioritizes required module branches before expensive optional root parts', () => {
  const expensiveGrip = createTestMod({
    id: 'expensive-grip',
    avg24hPrice: 60,
    ergonomicsModifier: 20,
    categories: createCategories(['Pistol grip']),
  });
  const cheapGrip = createTestMod({
    id: 'cheap-grip',
    avg24hPrice: 10,
    ergonomicsModifier: 1,
    categories: createCategories(['Pistol grip']),
  });
  const requiredCup = createTestMod({
    id: 'required-cup',
    avg24hPrice: 5,
    categories: createCategories(['Auxiliary Mod']),
  });
  const requiredScope = createTestMod({
    id: 'required-scope',
    avg24hPrice: 50,
    categories: createCategories(['Sights', 'Special scope']),
    slots: [createSlot('Tactical', [requiredCup.id])],
  });
  const receiver = createTestMod({
    id: 'receiver',
    avg24hPrice: 10,
    categories: createCategories(['Receiver']),
    slots: [createSlot('Scope', [requiredScope.id])],
  });
  const testWeapon = createTestWeapon({
    avg24hPrice: 10,
    ergonomics: 0,
    slots: [
      createSlot('Pistol Grip', [expensiveGrip.id, cheapGrip.id]),
      createSlot('Receiver', [receiver.id]),
    ],
  });
  const result = calculateBestBuild(
    testWeapon,
    'custom',
    1,
    200,
    createModMap(expensiveGrip, cheapGrip, receiver, requiredScope, requiredCup),
    {
      maxPrice: 85,
      requiredItemIds: [requiredScope.id, requiredCup.id],
    },
    {
      ergonomics: 1,
      verticalRecoil: 200,
      horizontalRecoil: 200,
      weight: 0,
      price: 85,
    },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, requiredScope.id);
  assertInstalled(result, requiredCup.id);
  assertInstalled(result, cheapGrip.id);
  assertNotInstalled(result, expensiveGrip.id);
  assert.equal(result.stats.price, 85);
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
  assert.equal(resultTooLow.errorCode, 'MAX_PRICE_EXCEEDED');
  assert.match(resultTooLow.error, /selected max price/i);
});

