import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBestBuild } from '../../src/domain/calculator.js';

const part = (id, overrides = {}) => ({
  id, name: id, weight: 0, avg24hPrice: 100, categories: [],
  ergonomicsModifier: 0, recoilModifier: 0, properties: { slots: [] }, ...overrides,
});
function calculate(parts, limits, options = {}, weaponOverrides = {}) {
  const weapon = {
    id: 'constraint-acceptance', weight: 1, avg24hPrice: 100,
    properties: { ergonomics: 50, recoilVertical: 100, recoilHorizontal: 300,
      slots: [{ name: 'stock', nameId: 'stock', required: true,
        filters: { allowedItems: parts.map(({ id }) => ({ id })) } }],
      ...weaponOverrides,
    },
  };
  return calculateBestBuild(weapon, 'custom', limits.ergonomics, limits.verticalRecoil,
    Object.fromEntries(parts.map(item => [item.id, item])), options, limits);
}
const selected = (result, id) => {
  assert.equal(result.error, undefined);
  assert.deepEqual(result.build.map(entry => entry.item.id), [id]);
};
const closest = (result, id) => {
  selected(result, id);
  assert.equal(result.constraintEvaluation.satisfied, false);
  assert.ok(result.constraintEvaluation.totalViolation > 0);
  assert.ok(result.warnings.some(warning => warning.code === 'REQUIREMENTS_UNMET_CLOSEST_BUILD'));
};
const satisfied = (result, id) => {
  selected(result, id);
  assert.equal(result.constraintEvaluation.satisfied, true);
  assert.equal(result.constraintEvaluation.totalViolation, 0);
};

// Base weapon weighs 1 kg; stock weights below produce totals of 2.8/3.0/3.1/3.5 kg.
const stocksByTotalWeight = {
  2.8: part('total-2.8', { weight: 1.8 }),
  3.0: part('total-3.0', { weight: 2 }),
  3.1: part('total-3.1', { weight: 2.1 }),
  3.5: part('total-3.5', { weight: 2.5 }),
};

test('weight above the desired maximum never beats a build within it', () => {
  const result = calculate(Object.values(stocksByTotalWeight), { weight: 3 });
  assert.ok(Number(result.stats.weight) <= 3);
  assert.equal(result.constraintEvaluation.satisfied, true);
});

test('lightest reachable weight above the desired maximum is returned, not an error', () => {
  const result = calculate([stocksByTotalWeight[3.5], stocksByTotalWeight[3.1]], { weight: 3 });
  closest(result, 'total-3.1');
  assert.ok(Math.abs(result.constraintEvaluation.axes.weight.violation - 0.1) < 1e-9);
});

test('unreachable vertical recoil returns the smallest violation', () => {
  const result = calculate([
    part('vertical-70', { recoilModifier: -30 }),
    part('vertical-55', { recoilModifier: -45 }),
  ], { verticalRecoil: 50 });
  closest(result, 'vertical-55');
  assert.equal(result.constraintEvaluation.axes.verticalRecoil.violation, 5);
});

test('unreachable horizontal recoil returns the best reachable build', () => {
  const result = calculate([
    part('horizontal-150', { recoilModifier: -50 }),
    part('horizontal-120', { recoilModifier: -60 }),
  ], { horizontalRecoil: 50 });
  closest(result, 'horizontal-120');
  assert.equal(result.stats.recoilHorizontal, 120);
});

test('unreachable ergonomics minimum returns the highest reachable ergonomics', () => {
  const result = calculate([
    part('ergonomics-40', { ergonomicsModifier: 10 }),
    part('ergonomics-48', { ergonomicsModifier: 18 }),
  ], { ergonomics: 50 }, {}, { ergonomics: 30 });
  closest(result, 'ergonomics-48');
  assert.equal(result.constraintEvaluation.axes.ergonomics.violation, 2);
});

const combinedLimits = { weight: 4, verticalRecoil: 50, horizontalRecoil: 150, ergonomics: 50 };

test('a build satisfying all limits beats any violating build', () => {
  satisfied(calculate([
    part('overweight-performer', { recoilModifier: -70, ergonomicsModifier: 20, weight: 3.5 }),
    part('within-limits', { recoilModifier: -50, weight: 0.5 }),
  ], combinedLimits), 'within-limits');
});

test('impossible combined limits return the nearest hard-valid build', () => {
  const result = calculate([
    part('near', { recoilModifier: -60, weight: 2 }),
    part('far', { recoilModifier: -20, weight: 2 }),
  ], { ...combinedLimits, horizontalRecoil: 50 });
  closest(result, 'near');
  assert.deepEqual(result.constraintEvaluation.failures.map(axis => axis.key), ['horizontalRecoil']);
});

test('multiple smaller normalized violations can beat one large violation', () => {
  const limits = { weight: 4, verticalRecoil: 60, horizontalRecoil: 100, ergonomics: 50 };
  // A: horizontal 180 -> 80 / 100 = 0.8 in total.
  const singleLarge = part('single-large', { recoilModifier: -40 });
  // B: horizontal 0.2 + ergonomics 3 / 50 + weight 0.2 / 4 = 0.31 in total.
  const severalSmall = part('several-small', { recoilModifier: -60, ergonomicsModifier: -3, weight: 3.2 });
  const result = calculate([singleLarge, severalSmall], limits);
  closest(result, 'several-small');
  assert.ok(Math.abs(result.constraintEvaluation.totalViolation - 0.31) < 1e-9);
  // Larger small violations (ergonomics 20 / 50, weight 1 / 4, horizontal 0.2 = 0.85) lose to A.
  const severalLarger = part('several-larger', { recoilModifier: -60, ergonomicsModifier: -20, weight: 4 });
  closest(calculate([singleLarge, severalLarger], limits), 'single-large');
});

test('values better than the limit are not punished for being far from it', () => {
  satisfied(calculate([
    part('vertical-49', { recoilModifier: -51 }),
    part('vertical-35', { recoilModifier: -65 }),
  ], { verticalRecoil: 50 }), 'vertical-35');
});

test('the profile weight stays soft when only a heavier build exists', () => {
  const result = calculate([part('only-heavy', { weight: 2.2 })], { weight: 3 });
  closest(result, 'only-heavy');
  assert.equal(result.stats.weight, '3.20');
});

test('the maxWeight option stays hard next to a softer profile weight', () => {
  const heavier = part('hard-invalid-3.2', { weight: 2.2, recoilModifier: -50 });
  const lighter = part('hard-valid-3.05', { weight: 2.05 });
  const result = calculate([heavier, lighter], { weight: 3 }, { maxWeight: 3.1 });
  closest(result, 'hard-valid-3.05');
  assert.ok(Math.abs(result.constraintEvaluation.axes.weight.violation - 0.05) < 1e-9);
  const impossible = calculate([heavier], { weight: 3 }, { maxWeight: 3.1 });
  assert.ok(impossible.error);
  assert.deepEqual(impossible.build, []);
});

test('the maxWeight option compares raw weight', () => {
  selected(calculate([part('heavy', { weight: 2.6 }), part('light', { weight: 2.4 })],
    { weight: 4 }, { maxWeight: 3.5 }), 'light');
  const result = calculate([part('rounding-overflow', { weight: 2.5001 })], { weight: 4 }, { maxWeight: 3.5 });
  assert.ok(result.error);
  assert.deepEqual(result.build, []);
});

test('budget stays hard while characteristic limits only rank affordable builds', () => {
  const perfect = part('perfect-expensive', { recoilModifier: -80, avg24hPrice: 1000 });
  const affordable = part('affordable', { recoilModifier: -40 });
  closest(calculate([perfect, affordable], combinedLimits, { maxPrice: 300 }), 'affordable');
  // Over-budget parts are pruned, so the required slot is what fails.
  const overBudget = calculate([perfect], combinedLimits, { maxPrice: 300 });
  assert.match(overBudget.error, /Required weapon slots/);
  assert.deepEqual(overBudget.build, []);
  const overBudgetWeapon = calculate([affordable], combinedLimits, { maxPrice: 50 });
  assert.equal(overBudgetWeapon.errorCode, 'MAX_PRICE_EXCEEDED');
  assert.deepEqual(overBudgetWeapon.build, []);
});

test('zero weight disables its limit', () => {
  satisfied(calculate([part('heavy', { weight: 20 })], { weight: 0 }), 'heavy');
});

for (const [category, options] of [
  ['Silencer', { requireSuppressor: true }],
  ['Sights', { requireSight: true }],
  ['Comb. tact. device', { includeLaser: true }],
]) {
  test(`required ${category} stays hard while characteristic limits stay soft`, () => {
    const device = part('device', { recoilModifier: -50, categories: [{ name: category }] });
    const betterWithoutDevice = part('better-without-device', { recoilModifier: -70 });
    satisfied(calculate([device, betterWithoutDevice], combinedLimits, options), 'device');
    closest(calculate([{ ...device, weight: 4 }, betterWithoutDevice], combinedLimits, options), 'device');
    const missing = calculate([betterWithoutDevice], combinedLimits, options);
    assert.ok(missing.error);
    assert.deepEqual(missing.build, []);
  });
}
