import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCustomTargetMatching,
  getNormalizedCustomTargetError,
} from '../../src/domain/customTargetMatching.js';

test('target matching normalizes calculator display values before comparing axes', () => {
  const matching = evaluateCustomTargetMatching(
    { ergonomics: 60.6, recoilVertical: 44.4, recoilHorizontal: 35.5, weight: '4.006' },
    { ergonomics: 61, verticalRecoil: 44, horizontalRecoil: 36, weight: 4.01 },
  );

  assert.equal(matching.totalDistance, 0);
  assert.equal(matching.axes.weight.actual, 4.01);
  assert.equal(matching.axes.verticalRecoil.actual, 44);
});

test('target matching caps ergonomics to the displayed range before Exact comparison', () => {
  const matching = evaluateCustomTargetMatching(
    { ergonomics: 110, recoilVertical: 100, recoilHorizontal: 100, weight: 1 },
    { ergonomics: 120, verticalRecoil: 100, horizontalRecoil: 100, weight: 1 },
    { ergonomics: true },
  );

  assert.equal(matching.axes.ergonomics.actual, 100);
  assert.equal(matching.axes.ergonomics.target, 100);
  assert.equal(matching.axes.ergonomics.exactMatch, true);
});

test('target matching uses normalized axis errors and disables a zero weight target', () => {
  const matching = evaluateCustomTargetMatching(
    { ergonomics: 75, recoilVertical: 35, recoilHorizontal: 42, weight: 5.5 },
    { ergonomics: 61, verticalRecoil: 44, horizontalRecoil: 35, weight: 0 },
  );

  assert.equal(matching.axes.weight.active, false);
  assert.equal(matching.totalDistance,
    getNormalizedCustomTargetError(75, 61)
      + getNormalizedCustomTargetError(35, 44)
      + getNormalizedCustomTargetError(42, 35));
});

test('Exact is strict after normalization and contributes zero only on a match', () => {
  const matching = evaluateCustomTargetMatching(
    { ergonomics: 61.4, recoilVertical: 44.4, recoilHorizontal: 35.4, weight: 4.006 },
    { ergonomics: 61, verticalRecoil: 44, horizontalRecoil: 35, weight: 4.01 },
    { ergonomics: true, verticalRecoil: true, horizontalRecoil: true, weight: true },
  );

  assert.equal(matching.exactMatches, true);
  assert.equal(matching.totalDistance, 0);
  assert.deepEqual(matching.exactFailures, []);
});

test('Exact failures retain structured actual, target, delta, and normalized error diagnostics', () => {
  const matching = evaluateCustomTargetMatching(
    { ergonomics: 75, recoilVertical: 35, recoilHorizontal: 42, weight: 4.01 },
    { ergonomics: 61, verticalRecoil: 44, horizontalRecoil: 35, weight: 4.01 },
    { ergonomics: true, verticalRecoil: true },
  );

  assert.equal(matching.exactMatches, false);
  assert.deepEqual(matching.exactFailures.map(axis => axis.key), ['ergonomics', 'verticalRecoil']);
  assert.deepEqual(matching.exactFailures[0], {
    key: 'ergonomics',
    active: true,
    exact: true,
    exactMatch: false,
    actual: 75,
    target: 61,
    delta: 14,
    normalizedError: 14 / 61,
    distance: 14 / 61,
  });
});

test('missing or invalid targets are inactive and cannot enable Exact', () => {
  const matching = evaluateCustomTargetMatching(
    { ergonomics: 61, recoilVertical: 44, recoilHorizontal: 35, weight: 4.01 },
    { ergonomics: '', verticalRecoil: Number.NaN, horizontalRecoil: undefined, weight: -1 },
    { ergonomics: true, verticalRecoil: true, horizontalRecoil: true, weight: true },
  );

  assert.equal(matching.totalDistance, 0);
  assert.equal(matching.exactMatches, true);
  assert.deepEqual(matching.exactFailures, []);
  assert.equal(Object.values(matching.axes).every(axis => axis.active === false && axis.exact === false), true);
});
