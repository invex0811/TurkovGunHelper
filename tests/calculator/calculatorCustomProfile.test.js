import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild } from '../../src/domain/calculator.js';
import {
  weapon,
  modMap,
  assertNoDuplicateParts,
  assertNoInstalledConflicts,
  createSlot,
  createTestWeapon,
  createTestMod,
  createModMap,
  assertInstalled,
  assertNotInstalled,
  defaultOptions,
} from './calculatorTestHelpers.js';

test('legacy Custom keeps its fixture result and returns a closest build for unreachable limits', () => {
  const result = calculateBestBuild(weapon, 'custom', 50, 50, modMap, {
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
    recoilModifier: -59.2,
    recoilVertical: 49,
    recoilHorizontal: 140,
    weight: '4.24',
    price: null,
  });

  const unreachable = calculateBestBuild(weapon, 'custom', 70, 50, modMap, defaultOptions);
  assert.equal(unreachable.error, undefined);
  assert.ok(unreachable.build.length > 0);
  assert.equal(unreachable.constraintEvaluation.satisfied, false);
  assert.ok(unreachable.warnings.some(warning => warning.code === 'REQUIREMENTS_UNMET_CLOSEST_BUILD'));
  assertNoDuplicateParts(unreachable);
  assertNoInstalledConflicts(unreachable);
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


test('Custom profile returns the closest build below an unreachable ergonomics minimum', () => {
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

  assert.equal(result.error, undefined);
  assertInstalled(result, ergonomicPart.id);
  assert.equal(result.stats.ergonomics, 60);
  assert.equal(result.constraintEvaluation.axes.ergonomics.violation, 30);
});


test('Constraints leaves an optional branch empty when the base build already matches its targets', () => {
  const worseningPart = createTestMod({
    id: 'optional-target-worsening',
    recoilModifier: -10,
    weight: 0.1,
  });
  const testWeapon = createTestWeapon({
    weight: 1,
    slots: [createSlot('Optional stock', [worseningPart.id])],
  });
  const profile = {
    ergonomics: 50,
    verticalRecoil: 100,
    horizontalRecoil: 100,
    weight: 1,
    price: 0,
  };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(worseningPart),
    defaultOptions,
    profile,
  );

  assert.equal(result.error, undefined);
  assert.equal(result.constraintEvaluation.satisfied, true);
  assertNotInstalled(result, worseningPart.id);
});


test('Constraints use capped displayed ergonomics before selecting an optional part', () => {
  const loweringPart = createTestMod({
    id: 'capped-exact-ergonomics-part',
    ergonomicsModifier: -10,
    avg24hPrice: 1_000,
  });
  const testWeapon = createTestWeapon({
    ergonomics: 110,
    avg24hPrice: 1_000,
    slots: [createSlot('Optional stock', [loweringPart.id])],
  });
  const profile = {
    ergonomics: 100,
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
    createModMap(loweringPart),
    defaultOptions,
    profile,
  );

  assert.equal(result.error, undefined);
  assert.equal(result.constraintEvaluation.satisfied, true);
  assert.equal(result.stats.ergonomics, 100);
  assert.equal(result.stats.price, 1_000);
  assertNotInstalled(result, loweringPart.id);
});


test('Constraints skips an unrelated worsening root branch when another root provides a required item', () => {
  const requiredPart = createTestMod({
    id: 'separate-required-part',
    weight: 0,
  });
  const worseningPart = createTestMod({
    id: 'separate-optional-worsening',
    recoilModifier: -10,
    weight: 0.1,
  });
  const testWeapon = createTestWeapon({
    weight: 1,
    slots: [
      createSlot('Optional stock', [worseningPart.id]),
      createSlot('Required receiver', [requiredPart.id]),
    ],
  });
  const profile = {
    ergonomics: 50,
    verticalRecoil: 100,
    horizontalRecoil: 100,
    weight: 1,
    price: 0,
  };

  const result = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(requiredPart, worseningPart),
    { ...defaultOptions, requiredItemIds: [requiredPart.id] },
    profile,
  );

  assert.equal(result.error, undefined);
  assert.equal(result.constraintEvaluation.satisfied, true);
  assertInstalled(result, requiredPart.id);
  assertNotInstalled(result, worseningPart.id);
});


test('Constraints scores an optional child from its required parent state', () => {
  const optionalChild = createTestMod({
    id: 'parent-state-optional-child',
    ergonomicsModifier: 5,
  });
  const requiredParent = createTestMod({
    id: 'parent-state-required-parent',
    ergonomicsModifier: 10,
    slots: [createSlot('Optional child', [optionalChild.id])],
  });
  const testWeapon = createTestWeapon({
    ergonomics: 50,
    slots: [createSlot('Parent', [requiredParent.id])],
  });
  const profile = {
    ergonomics: 65,
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
    createModMap(requiredParent, optionalChild),
    { ...defaultOptions, requiredItemIds: [requiredParent.id] },
    profile,
  );

  assert.equal(result.error, undefined);
  assert.equal(result.stats.ergonomics, 65);
  assertInstalled(result, requiredParent.id);
  assertInstalled(result, optionalChild.id);
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
    { ...defaultOptions, maxPrice: 3_000, priceMode: 'pvp', includeTraderPrices: true },
    { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: 1.2, price: 3_000 },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, validPart.id);
  assert.equal(Number(result.stats.weight) <= 1.2, true);
  assert.equal(result.stats.price <= 3_000, true);
});


test('Meta, Custom constraints, and priorities use the shared maxPrice option', () => {
  const affordablePart = createTestMod({
    id: 'priority-affordable',
    weight: 0.1,
    basePrice: 1_000,
    avg24hPrice: 1_000,
    ergonomicsModifier: 10,
    recoilModifier: -10,
  });
  const highPerformancePart = createTestMod({
    id: 'priority-high-performance',
    weight: 1,
    basePrice: 10_000,
    avg24hPrice: 10_000,
    ergonomicsModifier: 30,
    recoilModifier: -50,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [affordablePart.id, highPerformancePart.id], 'mod_stock', true)],
  });
  const profile = {
    ergonomics: 90,
    verticalRecoil: 40,
    horizontalRecoil: 40,
    weight: 1.2,
    price: 2_000,
  };
  const unlimitedOptions = { ...defaultOptions, maxWeight: profile.weight, maxPrice: 0, priceMode: 'pvp', includeTraderPrices: true };
  const cappedOptions = { ...unlimitedOptions, maxPrice: 2_500 };
  const unconstrainedPriorityResult = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(affordablePart, highPerformancePart),
    unlimitedOptions,
    profile,
    ['ergonomics'],
    'priorities',
  );
  const cappedPriorityResult = calculateBestBuild(
    testWeapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(affordablePart, highPerformancePart),
    cappedOptions,
    profile,
    ['ergonomics'],
    'priorities',
    100_000,
  );
  const constraintProfile = { ...profile, ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: 0, price: 100_000 };
  const constraintsResult = calculateBestBuild(
    testWeapon,
    'custom',
    constraintProfile.ergonomics,
    constraintProfile.verticalRecoil,
    createModMap(affordablePart, highPerformancePart),
    cappedOptions,
    constraintProfile,
    ['ergonomics'],
    'constraints',
  );
  const metaResult = calculateBestBuild(
    testWeapon,
    'meta',
    profile.ergonomics,
    profile.verticalRecoil,
    createModMap(affordablePart, highPerformancePart),
    cappedOptions,
  );

  assertInstalled(unconstrainedPriorityResult, highPerformancePart.id);
  assert.equal(unconstrainedPriorityResult.stats.ergonomics < profile.ergonomics, true);
  assert.equal(unconstrainedPriorityResult.stats.recoilVertical > profile.verticalRecoil, true);
  assert.equal(unconstrainedPriorityResult.stats.recoilHorizontal > profile.horizontalRecoil, true);
  assert.equal(Number(unconstrainedPriorityResult.stats.weight) > profile.weight, true);
  assert.equal(unconstrainedPriorityResult.stats.price > profile.price, true);
  assertInstalled(cappedPriorityResult, affordablePart.id);
  assert.equal(cappedPriorityResult.stats.price <= 2_500, true);
  assertInstalled(constraintsResult, affordablePart.id);
  assert.equal(constraintsResult.stats.price <= 2_500, true);
  assertInstalled(metaResult, affordablePart.id);
  assert.equal(metaResult.stats.price <= 2_500, true);
});


test('Priorities order selects different required-slot modules and ignores constraint targets', () => {
  const ergonomicPart = createTestMod({
    id: 'priority-ergo-module',
    ergonomicsModifier: 20,
    recoilModifier: 0,
    basePrice: 1_000,
    avg24hPrice: 1_000,
  });
  const recoilPart = createTestMod({
    id: 'priority-recoil-module',
    ergonomicsModifier: 0,
    recoilModifier: -50,
    basePrice: 1_000,
    avg24hPrice: 1_000,
  });
  const testWeapon = createTestWeapon({
    basePrice: 1_000,
    avg24hPrice: 1_000,
    slots: [createSlot(
      'Required stock',
      [ergonomicPart.id, recoilPart.id],
      'mod_stock',
      true,
    )],
  });
  const impossibleConstraintProfile = {
    ergonomics: 99,
    verticalRecoil: 1,
    horizontalRecoil: 1,
    weight: 0.01,
    price: 1,
  };
  const hardBudget = 2_500;
  const options = {
    ...defaultOptions,
    maxPrice: hardBudget,
    priceMode: 'pvp',
    includeTraderPrices: true,
  };
  const prioritiesByErgonomics = calculateBestBuild(
    testWeapon,
    'custom',
    impossibleConstraintProfile.ergonomics,
    impossibleConstraintProfile.verticalRecoil,
    createModMap(ergonomicPart, recoilPart),
    options,
    impossibleConstraintProfile,
    ['ergonomics', 'verticalRecoil'],
    'priorities',
  );
  const prioritiesByVerticalRecoil = calculateBestBuild(
    testWeapon,
    'custom',
    impossibleConstraintProfile.ergonomics,
    impossibleConstraintProfile.verticalRecoil,
    createModMap(ergonomicPart, recoilPart),
    options,
    impossibleConstraintProfile,
    ['verticalRecoil', 'ergonomics'],
    'priorities',
  );

  assert.equal(prioritiesByErgonomics.error, undefined);
  assert.equal(prioritiesByVerticalRecoil.error, undefined);
  assertInstalled(prioritiesByErgonomics, ergonomicPart.id);
  assertNotInstalled(prioritiesByErgonomics, recoilPart.id);
  assertInstalled(prioritiesByVerticalRecoil, recoilPart.id);
  assertNotInstalled(prioritiesByVerticalRecoil, ergonomicPart.id);
  assert.equal(prioritiesByErgonomics.stats.price <= hardBudget, true);
  assert.equal(prioritiesByVerticalRecoil.stats.price <= hardBudget, true);
});

