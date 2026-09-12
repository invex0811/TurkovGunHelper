import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PRIORITY_WEIGHTS } from '../../src/domain/customPriorityAttributes.js';
import { rebalancePriorityWeights } from '../../src/features/configurator/priorityWeightControls.js';

function assertWeights(currentWeights, attribute, value, expected) {
  const actual = rebalancePriorityWeights(currentWeights, attribute, value);
  assert.deepEqual(actual, expected);
  assert.equal(actual.recoil + actual.ergonomics + actual.weight, 100);
}

test('keeps the default linked priority weights at 100', () => {
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 50, { recoil: 50, ergonomics: 30, weight: 20 });
});

test('redistributes remaining weights proportionally when the first weight increases', () => {
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 70, { recoil: 70, ergonomics: 18, weight: 12 });
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 80, { recoil: 80, ergonomics: 12, weight: 8 });
});

test('redistributes remaining weights proportionally when the first weight decreases', () => {
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 40, { recoil: 40, ergonomics: 36, weight: 24 });
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 0, { recoil: 0, ergonomics: 60, weight: 40 });
});

test('supports extreme values and clamps input to the allowed range', () => {
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 100, { recoil: 100, ergonomics: 0, weight: 0 });
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 150, { recoil: 100, ergonomics: 0, weight: 0 });
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', -20, { recoil: 0, ergonomics: 60, weight: 40 });
});

test('splits the remainder deterministically when the other weights have no ratio', () => {
  const weights = { recoil: 100, ergonomics: 0, weight: 0 };
  assertWeights(weights, 'recoil', 80, { recoil: 80, ergonomics: 10, weight: 10 });
  assertWeights(weights, 'recoil', 79, { recoil: 79, ergonomics: 11, weight: 10 });
});

test('assigns rounding residue to the second remaining weight so the sum is exactly 100', () => {
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'recoil', 67, { recoil: 67, ergonomics: 20, weight: 13 });
  assertWeights(DEFAULT_PRIORITY_WEIGHTS, 'ergonomics', 41, { ergonomics: 41, recoil: 42, weight: 17 });
  assertWeights({ recoil: 1, ergonomics: 1, weight: 1 }, 'weight', 33, {
    weight: 33,
    recoil: 34,
    ergonomics: 33,
  });
});

test('returns a new object without mutating the current weights', () => {
  const currentWeights = { recoil: 50, ergonomics: 30, weight: 20 };
  const snapshot = { ...currentWeights };
  const nextWeights = rebalancePriorityWeights(currentWeights, 'recoil', 70);

  assert.deepEqual(currentWeights, snapshot);
  assert.notStrictEqual(nextWeights, currentWeights);
});
