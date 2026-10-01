import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild } from '../../src/domain/calculator.js';
import {
  weapon,
  modMap,
  hasCategory,
  assertNoDuplicateParts,
  assertStatsMatchParts,
  createCategories,
  createSlot,
  createTestWeapon,
  createTestMod,
  createModMap,
  hasInstalledCategory,
  assertInstalled,
  assertNotInstalled,
  assertNoDuplicatePartsForResult,
  assertNoInstalledConflictsForWeapon,
  assertStatsMatchPartsForWeapon,
  defaultOptions,
} from './calculatorTestHelpers.js';

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


function createFinalMuzzleOptimizationFixture(suppressorOverrides = {}) {
  const suppressor = createTestMod({
    id: 'ak308-final-suppressor',
    categories: createCategories(['Silencer', 'Muzzle device']),
    recoilModifier: -3,
    ergonomicsModifier: -8,
    weight: 0.1,
    basePrice: 5000,
    avg24hPrice: 5000,
    ...suppressorOverrides,
  });
  const muzzleBrake = createTestMod({
    id: 'ak308-chain-muzzle-brake',
    categories: createCategories(['Muzzle device']),
    recoilModifier: -2,
    weight: 0.05,
    slots: [createSlot('Suppressor', [suppressor.id], 'mod_muzzle_001')],
  });
  const adapter = createTestMod({
    id: 'ak308-muzzle-adapter',
    categories: createCategories(['Muzzle device']),
    recoilModifier: -1,
    weight: 0.05,
    slots: [createSlot('Muzzle', [muzzleBrake.id], 'mod_muzzle_000')],
  });
  const directBrake = createTestMod({
    id: 'ak308-direct-brake',
    categories: createCategories(['Muzzle device']),
    recoilModifier: -2,
    weight: 0.05,
  });
  const stock = createTestMod({
    id: 'ak308-ergo-stock',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 20,
    recoilModifier: -5,
    weight: 0.1,
  });
  const testWeapon = createTestWeapon({
    id: 'ak308-final-muzzle-fixture',
    ergonomics: 40,
    slots: [
      createSlot('Muzzle', [adapter.id, directBrake.id], 'mod_muzzle'),
      createSlot('Stock', [stock.id], 'mod_stock'),
    ],
  });

  return {
    adapter,
    directBrake,
    modMap: createModMap(adapter, directBrake, muzzleBrake, stock, suppressor),
    muzzleBrake,
    stock,
    suppressor,
    weapon: testWeapon,
  };
}


test('final meta muzzle optimization selects a suppressor after the stock restores ergonomics', () => {
  const fixture = createFinalMuzzleOptimizationFixture();
  const allowed = calculateBestBuild(fixture.weapon, 'meta', 70, 50, fixture.modMap, defaultOptions);
  const forbidden = calculateBestBuild(fixture.weapon, 'meta', 70, 50, fixture.modMap, {
    ...defaultOptions,
    forbidSuppressor: true,
  });

  assertInstalled(allowed, fixture.adapter.id);
  assertInstalled(allowed, fixture.muzzleBrake.id);
  assertInstalled(allowed, fixture.suppressor.id);
  assert.ok(allowed.stats.ergonomics >= 50);
  assert.ok(allowed.stats.recoilVertical < forbidden.stats.recoilVertical);
  assertStatsMatchPartsForWeapon(fixture.weapon, allowed);
});


test('final meta muzzle optimization respects forbid and require suppressor modes', () => {
  const fixture = createFinalMuzzleOptimizationFixture();
  const forbidden = calculateBestBuild(fixture.weapon, 'meta', 70, 50, fixture.modMap, {
    ...defaultOptions,
    forbidSuppressor: true,
  });
  const required = calculateBestBuild(fixture.weapon, 'meta', 70, 50, fixture.modMap, {
    ...defaultOptions,
    requireSuppressor: true,
  });

  assertNotInstalled(forbidden, fixture.suppressor.id);
  assertInstalled(required, fixture.suppressor.id);
  assert.equal(required.error, undefined);
});


test('final meta muzzle optimization keeps the better unsuppressed branch', () => {
  const fixture = createFinalMuzzleOptimizationFixture({
    id: 'poor-final-suppressor',
    recoilModifier: -1,
    ergonomicsModifier: -20,
    weight: 0.5,
  });
  const result = calculateBestBuild(fixture.weapon, 'meta', 70, 50, fixture.modMap, defaultOptions);

  assertNotInstalled(result, fixture.suppressor.id);
  assert.ok(result.stats.ergonomics >= 50);
});


test('final meta muzzle optimization rejects a suppressor over the weight limit', () => {
  const fixture = createFinalMuzzleOptimizationFixture();
  const result = calculateBestBuild(fixture.weapon, 'meta', 70, 50, fixture.modMap, {
    ...defaultOptions,
    maxWeight: 1.25,
  });

  assertNotInstalled(result, fixture.suppressor.id);
  assert.ok(Number(result.stats.weight) <= 1.25);
});


test('final meta muzzle optimization rejects a suppressor over the budget', () => {
  const fixture = createFinalMuzzleOptimizationFixture();
  const result = calculateBestBuild(fixture.weapon, 'meta', 70, 50, fixture.modMap, {
    ...defaultOptions,
    maxPrice: 5000,
  });

  assertNotInstalled(result, fixture.suppressor.id);
  assert.ok(result.stats.price <= 5000);
});


test('final meta muzzle optimization preserves a required root muzzle slot', () => {
  const requiredBrake = createTestMod({
    id: 'required-negative-muzzle-brake',
    categories: createCategories(['Muzzle device']),
    ergonomicsModifier: -1,
    weight: 0.1,
  });
  const testWeapon = createTestWeapon({
    ergonomics: 60,
    slots: [createSlot('Muzzle', [requiredBrake.id], 'mod_muzzle', true)],
  });
  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(requiredBrake),
    defaultOptions,
  );

  assertInstalled(result, requiredBrake.id);
  assert.equal(result.error, undefined);
});


test('final meta muzzle optimization keeps ergonomics at the meta floor', () => {
  const fixture = createFinalMuzzleOptimizationFixture({
    id: 'low-ergo-final-suppressor',
    recoilModifier: -4,
    ergonomicsModifier: -15,
    weight: 0.1,
  });
  const result = calculateBestBuild(fixture.weapon, 'meta', 70, 50, fixture.modMap, defaultOptions);

  assertNotInstalled(result, fixture.suppressor.id);
  assert.ok(result.stats.ergonomics >= 50);
});


test('final meta muzzle optimization does not add a second suppressor', () => {
  const otherSuppressor = createTestMod({
    id: 'other-branch-suppressor',
    categories: createCategories(['Silencer']),
    recoilModifier: -1,
  });
  const muzzleSuppressor = createTestMod({
    id: 'second-muzzle-suppressor',
    categories: createCategories(['Silencer', 'Muzzle device']),
    recoilModifier: -10,
  });
  const unsuppressedBrake = createTestMod({
    id: 'best-unsuppressed-brake',
    categories: createCategories(['Muzzle device']),
    recoilModifier: -5,
  });
  const testWeapon = createTestWeapon({
    ergonomics: 60,
    slots: [
      createSlot('Handguard', [otherSuppressor.id], 'mod_handguard'),
      createSlot('Muzzle', [muzzleSuppressor.id, unsuppressedBrake.id], 'mod_muzzle'),
    ],
  });
  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(otherSuppressor, muzzleSuppressor, unsuppressedBrake),
    Object.freeze({ ...defaultOptions, requireSuppressor: true }),
  );

  assertInstalled(result, otherSuppressor.id);
  assertInstalled(result, unsuppressedBrake.id);
  assertNotInstalled(result, muzzleSuppressor.id);
  assert.equal(result.build.filter(part => hasCategory(part.item, 'Silencer')).length, 1);
});


test('forced muzzle path caches do not make selection depend on candidate order', () => {
  const expensiveSuppressor = createTestMod({
    id: 'forced-expensive-heavy-suppressor',
    categories: createCategories(['Silencer', 'Muzzle device']),
    recoilModifier: -8,
    ergonomicsModifier: -2,
    weight: 1,
    basePrice: 10000,
    avg24hPrice: 10000,
  });
  const affordableSuppressor = createTestMod({
    id: 'forced-affordable-light-suppressor',
    categories: createCategories(['Silencer', 'Muzzle device']),
    recoilModifier: -5,
    ergonomicsModifier: -2,
    weight: 0.1,
    basePrice: 1000,
    avg24hPrice: 1000,
  });
  const requiredHandguard = createTestMod({
    id: 'forced-required-handguard',
    categories: createCategories(['Handguard']),
    weight: 0.05,
    basePrice: 500,
    avg24hPrice: 500,
  });

  function calculateWithOrder(suppressorIds) {
    const adapter = createTestMod({
      id: `forced-cache-adapter-${suppressorIds[0]}`,
      categories: createCategories(['Muzzle device']),
      recoilModifier: -1,
      weight: 0.05,
      slots: [
        createSlot('Handguard', [requiredHandguard.id], 'mod_handguard', true),
        createSlot('Muzzle', suppressorIds, 'mod_muzzle_001'),
      ],
    });
    const testWeapon = createTestWeapon({
      ergonomics: 60,
      slots: [createSlot('Muzzle', [adapter.id], 'mod_muzzle')],
    });
    return calculateBestBuild(
      testWeapon,
      'meta',
      70,
      50,
      createModMap(adapter, requiredHandguard, expensiveSuppressor, affordableSuppressor),
      { ...defaultOptions, maxPrice: 5000, maxWeight: 1.5 },
    );
  }

  const expensiveFirst = calculateWithOrder([expensiveSuppressor.id, affordableSuppressor.id]);
  const affordableFirst = calculateWithOrder([affordableSuppressor.id, expensiveSuppressor.id]);

  assertInstalled(expensiveFirst, affordableSuppressor.id);
  assertInstalled(affordableFirst, affordableSuppressor.id);
  assertNotInstalled(expensiveFirst, expensiveSuppressor.id);
  assertNotInstalled(affordableFirst, expensiveSuppressor.id);
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

