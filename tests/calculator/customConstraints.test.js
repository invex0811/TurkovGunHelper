import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCustomConstraints } from '../../src/domain/customConstraints.js';

const limits = { ergonomics: 50, verticalRecoil: 50, horizontalRecoil: 150, weight: 4 };
const good = { ergonomics: 50, recoilVertical: 50, recoilHorizontal: 150, weight: 4 };
for (const [axis, stat, invalid, valid, better, direction] of [
  ['weight', 'weight', 4.01, 4, 3.7, 'maximum'],
  ['verticalRecoil', 'recoilVertical', 51, 50, 40, 'maximum'],
  ['horizontalRecoil', 'recoilHorizontal', 151, 150, 120, 'maximum'],
  ['ergonomics', 'ergonomics', 49, 50, 65, 'minimum'],
]) {
  test(`${axis} is a directional hard ${direction}`, () => {
    for (const actual of [invalid, valid, better]) {
      const result = evaluateCustomConstraints({ ...good, [stat]: actual }, limits);
      assert.equal(result.satisfied, actual !== invalid);
      assert.equal(result.axes[axis].direction, direction);
      assert.equal(result.axes[axis].limit, limits[axis]);
      assert.equal(result.axes[axis].violation > 0, actual === invalid);
      assert.equal(result.totalViolation > 0, actual === invalid);
    }
  });
}
test('all limits apply simultaneously; improvements cannot compensate violations', () => {
  assert.equal(evaluateCustomConstraints({ ...good, recoilVertical: 10, weight: 4.01 }, limits).satisfied, false);
  assert.equal(evaluateCustomConstraints({ ...good, ergonomics: 100, recoilHorizontal: 151 }, limits).satisfied, false);
  assert.equal(evaluateCustomConstraints({ ergonomics: 70, recoilVertical: 35, recoilHorizontal: 100, weight: 2.7 }, limits).totalViolation, 0);
});
test('zero weight and missing limits are inactive; active missing actual values fail', () => {
  const result = evaluateCustomConstraints({ weight: 100 }, { weight: 0 });
  assert.equal(result.satisfied, true);
  assert.ok(Object.values(result.axes).every(axis => !axis.active));
  assert.equal(evaluateCustomConstraints({}, limits).satisfied, false);
  assert.equal(evaluateCustomConstraints({ recoilVertical: 1 }, { verticalRecoil: 0 }).satisfied, false);
});
test('hard limits compare raw numeric values', () => {
  assert.equal(evaluateCustomConstraints({ ...good, weight: 4.001 }, limits).satisfied, false);
});
