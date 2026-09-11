import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOM_PRIORITY_ATTRIBUTE_KEYS,
  CUSTOM_PRIORITY_FLOAT_EPSILON,
  CUSTOM_PRIORITY_RANK_TOLERANCE,
  DEFAULT_PRIORITY_WEIGHTS,
  getCustomPriorityBounds,
  getCustomPriorityVector,
  getCustomPriorityVectorFromBounds,
  movePriorityAttribute,
  normalizeCustomCharacteristicMode,
  normalizePriorityAttributes,
  normalizePrioritySelectionMode,
  normalizePriorityWeights,
  PRIORITY_SELECTION_MODES,
  togglePriorityAttribute,
} from '../../src/domain/customPriorityAttributes.js';

function result({ ergonomics, recoilModifier, verticalRecoil = 100, horizontalRecoil = 100, weight }) {
  return {
    stats: { ergonomics, recoilModifier, recoilVertical: verticalRecoil, recoilHorizontal: horizontalRecoil, weight },
  };
}

test('priority attributes use exactly the three canonical keys and migrate legacy recoil axes', () => {
  assert.deepEqual(CUSTOM_PRIORITY_ATTRIBUTE_KEYS, ['recoil', 'ergonomics', 'weight']);
  assert.deepEqual(normalizePriorityAttributes(), []);
  assert.deepEqual(normalizePriorityAttributes([
    'verticalRecoil', 'ergonomics', 'horizontalRecoil', 'weight', 'price', 'recoil',
  ]), ['recoil', 'ergonomics', 'weight']);
  assert.deepEqual(normalizePriorityAttributes([
    'ergonomics', 'horizontalRecoil', 'weight', 'verticalRecoil',
  ]), ['ergonomics', 'recoil', 'weight']);
  assert.deepEqual(normalizePriorityAttributes(['verticalRecoil', 'horizontalRecoil', 'ergonomics']), [
    'recoil', 'ergonomics',
  ]);
});

test('priority toggles and moves normalize duplicate legacy recoil configuration without mutation', () => {
  const attributes = ['ergonomics', 'verticalRecoil', 'horizontalRecoil', 'weight'];
  assert.deepEqual(togglePriorityAttribute(['verticalRecoil'], 'ergonomics'), ['recoil', 'ergonomics']);
  assert.deepEqual(togglePriorityAttribute(['verticalRecoil', 'horizontalRecoil'], 'recoil'), []);
  assert.deepEqual(movePriorityAttribute(attributes, 1, 0), ['recoil', 'ergonomics', 'weight']);
  assert.deepEqual(attributes, ['ergonomics', 'verticalRecoil', 'horizontalRecoil', 'weight']);
  assert.deepEqual(movePriorityAttribute(attributes, 3, 0), ['ergonomics', 'recoil', 'weight']);
});

test('priority controls cap selections and safely ignore invalid move indexes', () => {
  const attributes = ['recoil', 'ergonomics', 'weight'];

  assert.deepEqual(togglePriorityAttribute(attributes, 'invalid'), attributes);
  assert.deepEqual(togglePriorityAttribute(attributes, 'recoil'), ['ergonomics', 'weight']);
  assert.notEqual(movePriorityAttribute(attributes, 1, 1), attributes);
  assert.deepEqual(movePriorityAttribute(attributes, 1.5, 0), attributes);
  assert.deepEqual(movePriorityAttribute(attributes, -1, 0), attributes);
  assert.deepEqual(movePriorityAttribute(attributes, 3, 0), attributes);
});

test('characteristic mode safely normalizes legacy values', () => {
  assert.equal(normalizeCustomCharacteristicMode(), 'constraints');
  assert.equal(normalizeCustomCharacteristicMode('invalid'), 'constraints');
  assert.equal(normalizeCustomCharacteristicMode('priorities'), 'priorities');
});

test('priority selection mode and weights safely normalize raw and legacy values', () => {
  assert.equal(normalizePrioritySelectionMode(), PRIORITY_SELECTION_MODES.ORDERED);
  assert.equal(normalizePrioritySelectionMode('unknown'), PRIORITY_SELECTION_MODES.ORDERED);
  assert.equal(normalizePrioritySelectionMode('weighted'), PRIORITY_SELECTION_MODES.WEIGHTED);
  assert.deepEqual(normalizePriorityWeights(), DEFAULT_PRIORITY_WEIGHTS);
  assert.deepEqual(normalizePriorityWeights({
    recoil: '80', ergonomics: Number.POSITIVE_INFINITY, weight: -10,
  }), { recoil: 80, ergonomics: 30, weight: 0 });
  assert.deepEqual(normalizePriorityWeights({ recoil: 200, ergonomics: '40.5', weight: Number.NaN }), {
    recoil: 100, ergonomics: 40.5, weight: 20,
  });
});

test('recoil priority uses exact aggregate recoilModifier rather than rounded vertical or horizontal recoil', () => {
  const minus20 = result({ ergonomics: 40, recoilModifier: -20, verticalRecoil: 80, horizontalRecoil: 160, weight: 4 });
  const minus30 = result({ ergonomics: 80, recoilModifier: -30, verticalRecoil: 80, horizontalRecoil: 160, weight: 5 });
  const minus10 = result({ ergonomics: 60, recoilModifier: -10, verticalRecoil: 80, horizontalRecoil: 160, weight: 3 });
  const candidates = [minus30, minus20, minus10];

  assert.deepEqual(getCustomPriorityVector(minus30, candidates, ['recoil']), [1]);
  assert.deepEqual(getCustomPriorityVector(minus20, candidates, ['recoil']), [0.5]);
  assert.deepEqual(getCustomPriorityVector(minus10, candidates, ['recoil']), [0]);
  assert.deepEqual(getCustomPriorityVector(minus20, candidates, ['verticalRecoil']), [0.5]);
});

test('priority vectors retain canonical selected rank order and finite values', () => {
  const recoilLeader = result({ ergonomics: 40, recoilModifier: -20, weight: 5 });
  const ergonomicLight = result({ ergonomics: 80, recoilModifier: -10, weight: 3 });
  const candidates = [recoilLeader, ergonomicLight];
  const bounds = getCustomPriorityBounds(candidates, ['recoil', 'ergonomics', 'weight']);

  assert.deepEqual(getCustomPriorityVector(recoilLeader, candidates, ['recoil', 'ergonomics', 'weight']), [1, 0, 0]);
  assert.deepEqual(getCustomPriorityVector(ergonomicLight, candidates, ['recoil', 'ergonomics', 'weight']), [0, 1, 1]);
  assert.deepEqual(getCustomPriorityVectorFromBounds(recoilLeader, bounds), [1, 0, 0]);
  const invalid = result({ ergonomics: Number.NaN, recoilModifier: Number.POSITIVE_INFINITY, weight: null });
  assert.deepEqual(getCustomPriorityVector(invalid, [recoilLeader, invalid], ['recoil', 'ergonomics', 'weight']), [0, 0, 0]);
  assert.equal(CUSTOM_PRIORITY_FLOAT_EPSILON, 1e-9);
  assert.equal(CUSTOM_PRIORITY_RANK_TOLERANCE, 0.10);
});

test('priority vectors handle empty and equal ranges without producing non-finite values', () => {
  const equal = result({ ergonomics: 60, recoilModifier: -12.5, weight: 4 });
  const equalCopy = result({ ergonomics: 60, recoilModifier: -12.5, weight: 4 });
  const attributes = ['recoil', 'ergonomics', 'weight'];

  assert.deepEqual(getCustomPriorityVector(equal, [equal, equalCopy], attributes), [1, 1, 1]);
  assert.deepEqual(getCustomPriorityVector(equal, [equal], []), []);
  assert.equal(getCustomPriorityVector(equal, [equal, equalCopy], attributes)
    .every(value => Number.isFinite(value) && value >= 0 && value <= 1), true);
});
