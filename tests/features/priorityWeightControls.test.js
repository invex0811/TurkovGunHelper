import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PRIORITY_WEIGHTS } from '../../src/domain/customPriorityAttributes.js';
import {
  getPriorityWeightMax,
  rebalancePriorityWeights,
} from '../../src/features/configurator/priorityWeightControls.js';

function assertWeights(currentWeights, attribute, value, expected) {
  const actual = rebalancePriorityWeights(currentWeights, attribute, value);
  assert.deepEqual(actual, expected);
  assert.equal(actual.recoil + actual.ergonomics + actual.weight, 100);
  assert.ok(Object.values(actual).every(Number.isInteger));
}

test('changing recoil consumes ergonomics before weight', () => {
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 70, { recoil: 70, ergonomics: 10, weight: 20 });
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 90, { recoil: 90, ergonomics: 0, weight: 10 });
});

test('decreasing recoil assigns the released share to ergonomics', () => {
  assertWeights({ recoil: 70, ergonomics: 10, weight: 20 }, 'recoil', 40, {
    recoil: 40,
    ergonomics: 40,
    weight: 20,
  });
  assertWeights({ recoil: 100, ergonomics: 0, weight: 0 }, 'recoil', 80, {
    recoil: 80,
    ergonomics: 20,
    weight: 0,
  });
});

test('changing ergonomics preserves recoil and assigns the remainder to weight', () => {
  const currentWeights = { recoil: 70, ergonomics: 10, weight: 20 };
  assertWeights(currentWeights, 'ergonomics', 25, { recoil: 70, ergonomics: 25, weight: 5 });
  assertWeights(currentWeights, 'ergonomics', 50, { recoil: 70, ergonomics: 30, weight: 0 });
  assertWeights({ recoil: 80, ergonomics: 10, weight: 10 }, 'ergonomics', 100, {
    recoil: 80,
    ergonomics: 20,
    weight: 0,
  });
});

test('changing weight preserves recoil and assigns the remainder to ergonomics', () => {
  assertWeights({ recoil: 70, ergonomics: 25, weight: 5 }, 'weight', 20, {
    recoil: 70,
    ergonomics: 10,
    weight: 20,
  });
  assertWeights({ recoil: 80, ergonomics: 10, weight: 10 }, 'weight', 100, {
    recoil: 80,
    ergonomics: 0,
    weight: 20,
  });
});

test('clamps values and always returns integer weights totaling 100', () => {
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 100, { recoil: 100, ergonomics: 0, weight: 0 });
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 120, { recoil: 100, ergonomics: 0, weight: 0 });
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', -20, { recoil: 0, ergonomics: 80, weight: 20 });
  assertWeights({ recoil: 70, ergonomics: 10, weight: 20 }, 'ergonomics', 12.7, {
    recoil: 70,
    ergonomics: 13,
    weight: 17,
  });
});

test('uses recoil to calculate dynamic limits for both secondary weights', () => {
  assert.equal(getPriorityWeightMax(DEFAULT_PRIORITY_WEIGHTS, 'recoil'), 100);
  assert.equal(getPriorityWeightMax(DEFAULT_PRIORITY_WEIGHTS, 'ergonomics'), 50);
  assert.equal(getPriorityWeightMax({ recoil: 80, ergonomics: 10, weight: 10 }, 'weight'), 20);
});

test('returns a new object without mutating the current weights', () => {
  const currentWeights = { recoil: 70, ergonomics: 10, weight: 20 };
  const snapshot = { ...currentWeights };
  const nextWeights = rebalancePriorityWeights(currentWeights, 'ergonomics', 25);

  assert.deepEqual(currentWeights, snapshot);
  assert.notStrictEqual(nextWeights, currentWeights);
});
