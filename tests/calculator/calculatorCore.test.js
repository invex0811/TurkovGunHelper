import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild, recalculateBuildStats } from '../../src/domain/calculator.js';
import {
  weapon,
  modMap,
  hasCategory,
  assertNoDuplicateParts,
  assertNoInstalledConflicts,
  assertStatsMatchParts,
  getWeightedPartScore,
  createCategories,
  createSlot,
  createTestWeapon,
  createTestMod,
  createModMap,
  getInstalledItemIds,
  assertInstalled,
  assertNotInstalled,
  defaultOptions,
} from './calculatorTestHelpers.js';

for (const targetType of ['meta', 'custom']) {
  test(`${targetType} build has valid unique parts and consistent stats`, () => {
    const result = calculateBestBuild(weapon, targetType, 50, 50, modMap, {
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
  assert.equal(result.stats.recoilModifier, -8);
  assert.equal(result.stats.recoilVertical, 92);
  assert.equal(result.stats.recoilHorizontal, 92);
  assert.equal(result.stats.weight, '2.50');
  assert.equal(result.stats.price, 75000);
});

