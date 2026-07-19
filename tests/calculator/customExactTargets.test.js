import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CUSTOM_EXACT_TARGETS,
  evaluateCustomExactTargets,
  getCustomExactTolerance,
  getNormalizedCustomExactDeviation,
  normalizeCustomExactTargets,
} from '../../src/domain/customExactTargets.js';

test('normalizes missing and legacy Exact settings to all disabled', () => {
  assert.deepEqual(normalizeCustomExactTargets(), DEFAULT_CUSTOM_EXACT_TARGETS);
  assert.deepEqual(normalizeCustomExactTargets({ ergonomics: true, price: 1 }), {
    ...DEFAULT_CUSTOM_EXACT_TARGETS,
    ergonomics: true,
  });
});

test('uses fixed stat tolerances and a scaled price tolerance', () => {
  assert.equal(getCustomExactTolerance('ergonomics', 60), 1);
  assert.equal(getCustomExactTolerance('verticalRecoil', 55), 1);
  assert.equal(getCustomExactTolerance('horizontalRecoil', 150), 2);
  assert.equal(getCustomExactTolerance('weight', 4), 0.05);
  assert.equal(getCustomExactTolerance('price', 70_000), 1_000);
  assert.equal(getCustomExactTolerance('price', 185_000), 1_850);
});

test('normalized deviation rejects invalid values and scales by tolerance', () => {
  assert.equal(getNormalizedCustomExactDeviation(61, 60, 1), 1);
  assert.equal(getNormalizedCustomExactDeviation(154, 150, 2), 2);
  assert.equal(getNormalizedCustomExactDeviation(null, 60, 1), Infinity);
  assert.equal(getNormalizedCustomExactDeviation(Number.NaN, 60, 1), Infinity);
  assert.equal(getNormalizedCustomExactDeviation(60, 60, 0), Infinity);
});

test('multiple Exact targets sum normalized absolute errors', () => {
  const evaluation = evaluateCustomExactTargets(
    { ergonomics: 61, verticalRecoil: 54, horizontalRecoil: 152, weight: 4, price: 186_850 },
    { ergonomics: 60, verticalRecoil: 55, horizontalRecoil: 150, weight: 4, price: 185_000 },
    { ergonomics: true, verticalRecoil: true, horizontalRecoil: true, price: true },
  );

  assert.equal(evaluation.totalError, 4);
  assert.equal(evaluation.matches, true);
  assert.deepEqual(evaluation.failures, []);
});

test('reports enabled axes outside tolerance while ignoring disabled axes', () => {
  const evaluation = evaluateCustomExactTargets(
    { ergonomics: 70, verticalRecoil: 55, horizontalRecoil: 160, weight: 5, price: 70_000 },
    { ergonomics: 60, verticalRecoil: 55, horizontalRecoil: 150, weight: 4, price: 70_000 },
    { ergonomics: false, verticalRecoil: true, horizontalRecoil: true },
  );

  assert.equal(evaluation.matches, false);
  assert.equal(evaluation.totalError, 5);
  assert.deepEqual(evaluation.failures.map(failure => failure.key), ['horizontalRecoil']);
});
