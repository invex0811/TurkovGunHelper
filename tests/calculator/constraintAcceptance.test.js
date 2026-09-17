import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild } from '../../src/domain/calculator.js';

function createPart(id, overrides = {}) {
  return {
    id,
    name: id,
    shortName: id,
    weight: 0.1,
    basePrice: 1000,
    avg24hPrice: 1000,
    categories: [],
    conflictingItems: [],
    ergonomicsModifier: 0,
    recoilModifier: 0,
    accuracyModifier: 0,
    properties: { slots: [] },
    ...overrides,
  };
}

function calculate(parts, targets, exactTargets = {}) {
  const weapon = {
    id: 'acceptance-weapon',
    name: 'Acceptance weapon',
    shortName: 'AW',
    weight: 1,
    basePrice: 1000,
    avg24hPrice: 1000,
    categories: [{ name: 'Weapon' }],
    conflictingItems: [],
    properties: {
      ergonomics: 50,
      recoilVertical: 100,
      recoilHorizontal: 100,
      slots: [{
        name: 'Stock',
        nameId: 'mod_stock',
        required: true,
        filters: { allowedItems: parts.map(({ id }) => ({ id })) },
      }],
    },
  };
  const profile = {
    ergonomics: undefined,
    verticalRecoil: undefined,
    horizontalRecoil: undefined,
    weight: undefined,
    ...targets,
  };

  return calculateBestBuild(
    weapon,
    'custom',
    profile.ergonomics,
    profile.verticalRecoil,
    Object.fromEntries(parts.map(part => [part.id, part])),
    { forbidSuppressor: false, requireSuppressor: false, maxWeight: 0 },
    profile,
    exactTargets,
  );
}

function assertSelected(result, id) {
  assert.equal(result.error, undefined);
  assert.deepEqual(result.build.map(part => part.item.id), [id]);
}

test('Constraints ergonomics target 60 prefers 61 over 75', () => {
  const result = calculate([
    createPart('ergonomics-61', { ergonomicsModifier: 11 }),
    createPart('ergonomics-75', { ergonomicsModifier: 25 }),
  ], { ergonomics: 60 });

  assertSelected(result, 'ergonomics-61');
  assert.equal(result.stats.ergonomics, 61);
});

for (const [axis, stat] of [
  ['verticalRecoil', 'recoilVertical'],
  ['horizontalRecoil', 'recoilHorizontal'],
]) {
  test(`Constraints ${axis} target 45 prefers 44 over 35 with other axes inactive`, () => {
    const result = calculate([
      createPart('recoil-44', { recoilModifier: -56 }),
      createPart('recoil-35', { recoilModifier: -65 }),
    ], { [axis]: 45 });

    assertSelected(result, 'recoil-44');
    assert.equal(result.stats[stat], 44);
  });
}

test('Constraints weight target 4 prefers 4.01 over 3.70 without imposing a weight ceiling', () => {
  const result = calculate([
    createPart('weight-4.01', { weight: 3.01 }),
    createPart('weight-3.70', { weight: 2.7 }),
  ], { weight: 4 });

  assertSelected(result, 'weight-4.01');
  assert.equal(result.stats.weight, '4.01');
  assert.ok(Number(result.stats.weight) > 4);
});

for (const ergonomics of [59, 61]) {
  test(`Exact ergonomics target 60 rejects the only available value ${ergonomics}`, () => {
    const result = calculate([
      createPart(`ergonomics-${ergonomics}`, { ergonomicsModifier: ergonomics - 50 }),
    ], { ergonomics: 60 }, { ergonomics: true });

    assert.equal(result.errorCode, 'CUSTOM_EXACT_TARGETS_UNMET');
    assert.deepEqual(result.build, []);
    assert.deepEqual(result.exactTargetFailures.map(({ key, actual }) => ({ key, actual })), [
      { key: 'ergonomics', actual: ergonomics },
    ]);
  });
}

for (const weight of [3.99, 4.01]) {
  test(`Exact weight target 4 rejects the only available value ${weight}`, () => {
    const result = calculate([
      createPart(`weight-${weight}`, { weight: weight - 1 }),
    ], { weight: 4 }, { weight: true });

    assert.equal(result.errorCode, 'CUSTOM_EXACT_TARGETS_UNMET');
    assert.deepEqual(result.build, []);
    assert.deepEqual(result.exactTargetFailures.map(({ key, actual }) => ({ key, actual })), [
      { key: 'weight', actual: weight },
    ]);
  });
}

test('Exact weight target 4 accepts 4.00', () => {
  const result = calculate([
    createPart('weight-4.00', { weight: 3 }),
  ], { weight: 4 }, { weight: true });

  assertSelected(result, 'weight-4.00');
  assert.equal(result.stats.weight, '4.00');
  assert.equal(result.targetMatching.exactMatches, true);
});

test('Exact ergonomics is mandatory before comparing nonexact recoil proximity', () => {
  const result = calculate([
    createPart('matching-far', { ergonomicsModifier: 10, recoilModifier: -20 }),
    createPart('matching-close', { ergonomicsModifier: 10, recoilModifier: -50 }),
    createPart('nonmatching-closest', { ergonomicsModifier: 11, recoilModifier: -55 }),
  ], { ergonomics: 60, verticalRecoil: 45 }, { ergonomics: true });

  assertSelected(result, 'matching-close');
  assert.equal(result.stats.ergonomics, 60);
  assert.equal(result.stats.recoilVertical, 50);
  assert.equal(result.targetMatching.exactMatches, true);
});

test('Weight target zero ignores Exact and does not affect active ergonomics ranking', () => {
  const parts = [
    createPart('closer-heavy', { ergonomicsModifier: 11, weight: 3 }),
    createPart('farther-light', { ergonomicsModifier: 25, weight: 0.1 }),
  ];
  const normal = calculate(parts, { ergonomics: 60, weight: 0 });
  const exactZero = calculate(parts, { ergonomics: 60, weight: 0 }, { weight: true });

  assertSelected(exactZero, 'closer-heavy');
  assert.equal(exactZero.stats.weight, '4.00');
  assert.deepEqual(exactZero, normal);
});
