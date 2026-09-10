import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOM_PRIORITY_FLOAT_EPSILON,
  CUSTOM_PRIORITY_RANK_TOLERANCE,
  getCustomPriorityBounds,
  getCustomPriorityVector,
  getCustomPriorityVectorFromBounds,
  movePriorityAttribute,
  normalizeCustomCharacteristicMode,
  normalizePriorityAttributes,
  togglePriorityAttribute,
} from '../../src/domain/customPriorityAttributes.js';

function result({ ergonomics, verticalRecoil, horizontalRecoil, weight }) {
  return {
    stats: { ergonomics, recoilVertical: verticalRecoil, recoilHorizontal: horizontalRecoil, weight },
  };
}

test('priority attributes are ordered, sanitized, deduplicated, capped, and removable', () => {
  assert.deepEqual(normalizePriorityAttributes(), []);
  assert.deepEqual(normalizePriorityAttributes([
    'verticalRecoil',
    'verticalRecoil',
    'price',
    'ergonomics',
    'weight',
    'horizontalRecoil',
  ]), ['verticalRecoil', 'ergonomics', 'weight', 'horizontalRecoil']);
  assert.deepEqual(togglePriorityAttribute(['verticalRecoil'], 'ergonomics'), [
    'verticalRecoil',
    'ergonomics',
  ]);
  assert.deepEqual(togglePriorityAttribute([
    'verticalRecoil',
    'ergonomics',
    'weight',
    'horizontalRecoil',
  ], 'invalid'), ['verticalRecoil', 'ergonomics', 'weight', 'horizontalRecoil']);
  assert.deepEqual(togglePriorityAttribute(['verticalRecoil', 'weight'], 'weight'), ['verticalRecoil']);
});

test('priority attributes reorder without mutation and safely ignore invalid indexes', () => {
  const attributes = ['ergonomics', 'verticalRecoil', 'weight', 'horizontalRecoil'];
  assert.deepEqual(movePriorityAttribute(attributes, 1, 0), [
    'verticalRecoil',
    'ergonomics',
    'weight',
    'horizontalRecoil',
  ]);
  assert.deepEqual(attributes, ['ergonomics', 'verticalRecoil', 'weight', 'horizontalRecoil']);
  assert.notEqual(movePriorityAttribute(attributes, 1, 1), attributes);
  assert.deepEqual(movePriorityAttribute(attributes, 1.5, 0), attributes);
  assert.deepEqual(movePriorityAttribute(attributes, 4, 0), attributes);
});

test('characteristic mode safely normalizes legacy values', () => {
  assert.equal(normalizeCustomCharacteristicMode(), 'constraints');
  assert.equal(normalizeCustomCharacteristicMode('invalid'), 'constraints');
  assert.equal(normalizeCustomCharacteristicMode('priorities'), 'priorities');
});

test('priority vectors normalize minimize and maximize attributes in their selected order', () => {
  const lightLowRecoil = result({ ergonomics: 40, verticalRecoil: 60, horizontalRecoil: 120, weight: 3 });
  const ergonomicHeavy = result({ ergonomics: 80, verticalRecoil: 100, horizontalRecoil: 200, weight: 5 });
  const candidates = [lightLowRecoil, ergonomicHeavy];

  assert.deepEqual(getCustomPriorityVector(lightLowRecoil, candidates, [
    'verticalRecoil',
    'ergonomics',
    'weight',
  ]), [1, 0, 1]);
  assert.deepEqual(getCustomPriorityVector(ergonomicHeavy, candidates, [
    'verticalRecoil',
    'ergonomics',
    'weight',
  ]), [0, 1, 0]);
  assert.deepEqual(getCustomPriorityVector(ergonomicHeavy, candidates, ['ergonomics']), [1]);
});

test('priority vectors retain all one through four ordered ranks without weighting', () => {
  const bestVerticalOnly = result({ ergonomics: 0, verticalRecoil: 0, horizontalRecoil: 100, weight: 100 });
  const opposite = result({ ergonomics: 100, verticalRecoil: 100, horizontalRecoil: 0, weight: 0 });
  const candidates = [bestVerticalOnly, opposite];

  assert.deepEqual(getCustomPriorityVector(bestVerticalOnly, candidates, ['verticalRecoil']), [1]);
  assert.deepEqual(getCustomPriorityVector(bestVerticalOnly, candidates, ['verticalRecoil', 'ergonomics']), [1, 0]);
  assert.deepEqual(getCustomPriorityVector(bestVerticalOnly, candidates, [
    'verticalRecoil',
    'ergonomics',
    'weight',
  ]), [1, 0, 0]);
  assert.deepEqual(getCustomPriorityVector(bestVerticalOnly, candidates, [
    'verticalRecoil',
    'ergonomics',
    'weight',
    'horizontalRecoil',
  ]), [1, 0, 0, 0]);
});

test('priority bounds and vectors preserve selected rank order', () => {
  const verticalLeader = result({ ergonomics: 80, verticalRecoil: 20, horizontalRecoil: 50, weight: 40 });
  const ergonomicsLeader = result({ ergonomics: 100, verticalRecoil: 60, horizontalRecoil: 50, weight: 40 });
  const candidates = [verticalLeader, ergonomicsLeader];

  const verticalFirstA = getCustomPriorityVector(verticalLeader, candidates, ['verticalRecoil', 'ergonomics']);
  const verticalFirstB = getCustomPriorityVector(ergonomicsLeader, candidates, ['verticalRecoil', 'ergonomics']);
  const ergonomicsFirstA = getCustomPriorityVector(verticalLeader, candidates, ['ergonomics', 'verticalRecoil']);
  const ergonomicsFirstB = getCustomPriorityVector(ergonomicsLeader, candidates, ['ergonomics', 'verticalRecoil']);

  assert.deepEqual(verticalFirstA, [1, 0]);
  assert.deepEqual(verticalFirstB, [0, 1]);
  assert.deepEqual(ergonomicsFirstA, [0, 1]);
  assert.deepEqual(ergonomicsFirstB, [1, 0]);
  assert.equal(CUSTOM_PRIORITY_FLOAT_EPSILON, 1e-9);
  assert.equal(CUSTOM_PRIORITY_RANK_TOLERANCE, 0.10);
  const bounds = getCustomPriorityBounds(candidates, ['verticalRecoil', 'ergonomics']);
  assert.deepEqual(getCustomPriorityVectorFromBounds(verticalLeader, bounds), verticalFirstA);
  assert.deepEqual(getCustomPriorityVectorFromBounds(ergonomicsLeader, bounds), verticalFirstB);
});

test('priority vectors and comparison are finite for empty, equal, and invalid values', () => {
  const candidate = result({ ergonomics: 60, verticalRecoil: 80, horizontalRecoil: 150, weight: 4 });
  const equalCandidate = result({ ergonomics: 60, verticalRecoil: 80, horizontalRecoil: 150, weight: 4 });
  const invalidCandidate = result({
    ergonomics: Number.NaN,
    verticalRecoil: Number.POSITIVE_INFINITY,
    horizontalRecoil: null,
    weight: Number.NEGATIVE_INFINITY,
  });
  const attributes = ['verticalRecoil', 'horizontalRecoil', 'ergonomics', 'weight'];

  assert.deepEqual(getCustomPriorityVector(candidate, [candidate, equalCandidate], attributes), [1, 1, 1, 1]);
  assert.deepEqual(getCustomPriorityVector(candidate, [candidate], ['weight']), [1]);
  assert.deepEqual(getCustomPriorityVector(candidate, [candidate], []), []);
  assert.deepEqual(getCustomPriorityVector(invalidCandidate, [candidate, invalidCandidate], attributes), [0, 0, 0, 0]);
  assert.equal(getCustomPriorityVector(candidate, [candidate, equalCandidate], attributes)
    .every(value => Number.isFinite(value) && value >= 0 && value <= 1), true);
});
