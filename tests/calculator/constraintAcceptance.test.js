import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBestBuild } from '../../src/domain/calculator.js';

const part = (id, overrides = {}) => ({
  id, name: id, weight: 0, avg24hPrice: 100, categories: [],
  ergonomicsModifier: 0, recoilModifier: 0, properties: { slots: [] }, ...overrides,
});
function calculate(parts, limits, options = {}) {
  const weapon = {
    id: 'constraint-acceptance', weight: 1, avg24hPrice: 100,
    properties: { ergonomics: 50, recoilVertical: 100, recoilHorizontal: 300,
      slots: [{ name: 'stock', nameId: 'stock', required: true,
        filters: { allowedItems: parts.map(({ id }) => ({ id })) } }],
    },
  };
  return calculateBestBuild(weapon, 'custom', limits.ergonomics, limits.verticalRecoil,
    Object.fromEntries(parts.map(item => [item.id, item])), options, limits);
}
const selected = (result, id) => {
  assert.equal(result.error, undefined);
  assert.deepEqual(result.build.map(entry => entry.item.id), [id]);
  assert.equal(result.constraintEvaluation.satisfied, true);
};
const limits = { weight: 4, verticalRecoil: 50, horizontalRecoil: 150, ergonomics: 50 };
test('weight maximum 4 rejects 4.01 and accepts 3.70', () => {
  selected(calculate([part('heavy', { weight: 3.01 }), part('light', { weight: 2.7 })], { weight: 4 }), 'light');
});
test('valid builds are ranked by better characteristics, not boundary proximity', () => {
  selected(calculate([
    part('boundary', { recoilModifier: -50, ergonomicsModifier: 1 }),
    part('better', { recoilModifier: -65, ergonomicsModifier: 20 }),
  ], limits), 'better');
});
test('all four limits and budget must hold simultaneously', () => {
  selected(calculate([
    part('heavy', { weight: 3.01, recoilModifier: -90 }),
    part('horizontal-overflow', { recoilModifier: -49, ergonomicsModifier: 50 }),
    part('expensive', { recoilModifier: -80, avg24hPrice: 1000 }),
    part('valid', { recoilModifier: -60, weight: 2.7 }),
  ], limits, { maxPrice: 300 }), 'valid');
});
test('impossible characteristic limits return an error and empty build', () => {
  const result = calculate([part('invalid')], limits);
  assert.equal(result.errorCode, 'CUSTOM_CONSTRAINTS_UNMET');
  assert.deepEqual(result.build, []);
});
test('zero weight disables its limit', () => {
  selected(calculate([part('heavy', { weight: 20 })], { weight: 0 }), 'heavy');
});
test('technical maximum weight remains the stricter raw limit', () => {
  selected(calculate([part('heavy', { weight: 2.6 }), part('light', { weight: 2.4 })],
    { weight: 4 }, { maxWeight: 3.5 }), 'light');
  const result = calculate([part('rounding-overflow', { weight: 2.5001 })], { weight: 4 }, { maxWeight: 3.5 });
  assert.ok(result.error);
  assert.deepEqual(result.build, []);
});
for (const [category, options] of [
  ['Silencer', { requireSuppressor: true }],
  ['Sights', { requireSight: true }],
  ['Comb. tact. device', { includeLaser: true }],
]) {
  test(`required ${category} and characteristic limits must both hold`, () => {
    const device = part('device', { recoilModifier: -50, categories: [{ name: category }] });
    selected(calculate([device], limits, options), 'device');
    const result = calculate([{ ...device, weight: 4 }], limits, options);
    assert.ok(result.error);
    assert.deepEqual(result.build, []);
  });
}
