import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCustomConstraints } from '../../src/domain/customConstraints.js';

const violationOf = (axis, stat, actual, limit) => (
  evaluateCustomConstraints({ [stat]: actual }, { [axis]: limit }).axes[axis]
);
const assertClose = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

for (const [axis, stat, limit, direction, cases] of [
  ['weight', 'weight', 3, 'maximum', [[2.5, 0], [2.8, 0], [3, 0], [3.1, 0.1], [3.2, 0.2], [3.5, 0.5]]],
  ['verticalRecoil', 'recoilVertical', 50, 'maximum', [[40, 0], [49, 0], [50, 0], [51, 1], [55, 5], [70, 20]]],
  ['horizontalRecoil', 'recoilHorizontal', 50, 'maximum', [[30, 0], [50, 0], [120, 70]]],
  ['ergonomics', 'ergonomics', 50, 'minimum', [[80, 0], [65, 0], [50, 0], [48, 2], [40, 10]]],
]) {
  test(`${axis} is a soft directional ${direction}`, () => {
    for (const [actual, expected] of cases) {
      const result = violationOf(axis, stat, actual, limit);
      assert.equal(result.direction, direction);
      assert.equal(result.limit, limit);
      assertClose(result.violation, expected);
      assertClose(result.normalizedViolation, expected / limit);
      assert.equal(result.satisfied, expected === 0);
    }
  });
}

test('values better than the limit score the same as the limit itself', () => {
  const limits = { verticalRecoil: 50 };
  assert.equal(evaluateCustomConstraints({ recoilVertical: 35 }, limits).totalViolation, 0);
  assert.equal(evaluateCustomConstraints({ recoilVertical: 49 }, limits).totalViolation, 0);
});

test('normalized violations make kilograms, recoil and ergonomics comparable', () => {
  const limits = { ergonomics: 50, verticalRecoil: 50, horizontalRecoil: 150, weight: 4 };
  const result = evaluateCustomConstraints(
    { ergonomics: 45, recoilVertical: 60, recoilHorizontal: 150, weight: 4.2 },
    limits,
  );
  assertClose(result.axes.ergonomics.normalizedViolation, 0.1);
  assertClose(result.axes.verticalRecoil.normalizedViolation, 0.2);
  assertClose(result.axes.weight.normalizedViolation, 0.05);
  assertClose(result.totalViolation, 0.35);
  assert.deepEqual(result.failures.map(axis => axis.key), ['ergonomics', 'verticalRecoil', 'weight']);
  assert.equal(result.satisfied, false);
});

test('summed part weights do not create a floating-point violation', () => {
  const result = evaluateCustomConstraints({ weight: 2.8 + 0.2 }, { weight: 3 });
  assert.equal(result.satisfied, true);
  assert.equal(result.totalViolation, 0);
});

test('zero weight and missing limits are inactive; active missing actual values fail', () => {
  const result = evaluateCustomConstraints({ weight: 100 }, { weight: 0 });
  assert.equal(result.satisfied, true);
  assert.ok(Object.values(result.axes).every(axis => !axis.active));
  assert.equal(evaluateCustomConstraints({}, { ergonomics: 50 }).satisfied, false);
  assert.equal(evaluateCustomConstraints({ recoilVertical: 1 }, { verticalRecoil: 0 }).satisfied, false);
});
