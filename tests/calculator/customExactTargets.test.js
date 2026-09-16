import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CUSTOM_EXACT_TARGETS,
  evaluateCustomExactTargets,
  normalizeCustomExactTargets,
} from '../../src/domain/customExactTargets.js';

test('normalizes missing and legacy Exact settings to all disabled', () => {
  assert.deepEqual(normalizeCustomExactTargets(), DEFAULT_CUSTOM_EXACT_TARGETS);
  assert.deepEqual(normalizeCustomExactTargets({ ergonomics: true, price: 1 }), {
    ...DEFAULT_CUSTOM_EXACT_TARGETS,
    ergonomics: true,
  });
  assert.equal(normalizeCustomExactTargets({ price: true }).price, false);
});

test('multiple Exact targets require the normalized displayed values to match', () => {
  const evaluation = evaluateCustomExactTargets(
    { ergonomics: 61, verticalRecoil: 54, horizontalRecoil: 152, weight: 4, price: 186_850 },
    { ergonomics: 60, verticalRecoil: 55, horizontalRecoil: 150, weight: 4, price: 185_000 },
    { ergonomics: true, verticalRecoil: true, horizontalRecoil: true, price: true },
  );

  assert.equal(evaluation.matches, false);
  assert.deepEqual(evaluation.failures.map(failure => failure.key), [
    'ergonomics',
    'verticalRecoil',
    'horizontalRecoil',
  ]);
});

test('reports enabled exact axes while ignoring disabled and legacy price axes', () => {
  const evaluation = evaluateCustomExactTargets(
    { ergonomics: 70, verticalRecoil: 55, horizontalRecoil: 160, weight: 5, price: 70_000 },
    { ergonomics: 60, verticalRecoil: 55, horizontalRecoil: 150, weight: 4, price: 70_000 },
    { ergonomics: false, verticalRecoil: true, horizontalRecoil: true },
  );

  assert.equal(evaluation.matches, false);
  assert.ok(evaluation.totalError > 0);
  assert.deepEqual(evaluation.failures.map(failure => failure.key), ['horizontalRecoil']);
});
