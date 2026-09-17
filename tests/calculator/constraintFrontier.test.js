import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild, createConstraintSearchRoutes } from '../../src/domain/calculator/orchestration.js';
import { _calculateWeighted } from '../../src/domain/calculator/candidateSearch.js';
import { getNestedSlotRouteKey, getRootSlotRouteKey } from '../../src/domain/calculator/constraints.js';

const targets = { ergonomics: 50, verticalRecoil: 100, horizontalRecoil: 100, weight: 0 };
const slot = (name, ids, required = false) => ({
  name, nameId: name, required, filters: { allowedItems: ids.map(id => ({ id })) },
});
const part = (id, overrides = {}) => ({
  id, name: id, avg24hPrice: 100, weight: 0, categories: [],
  properties: { slots: [] }, ...overrides,
});
const weapon = slots => ({
  id: 'frontier-test-weapon', avg24hPrice: 100, weight: 1,
  properties: { ergonomics: 50, recoilVertical: 100, recoilHorizontal: 100, slots },
});
const mapParts = parts => Object.fromEntries(parts.map(item => [item.id, item]));
const calculate = (base, parts, options = {}) => calculateBestBuild(
  base, 'custom', targets.ergonomics, targets.verticalRecoil, mapParts(parts), options, targets,
);
const installed = result => result.build.map(entry => entry.item.id);
const silencer = id => part(id, { categories: [{ name: 'Silencer' }] });

test('budget-only frontier stays within 24 routes for five roots with eight independent choices', () => {
  const parts = [];
  const slots = Array.from({ length: 5 }, (_, root) => {
    const choices = Array.from({ length: 8 }, (_, index) => part(`root-${root}-${index}`, {
      ergonomicsModifier: index, avg24hPrice: 100 + index,
    }));
    parts.push(...choices);
    return slot(`root-${root}`, choices.map(item => item.id), true);
  });
  const routes = createConstraintSearchRoutes(weapon(slots), mapParts(parts), targets, {}, { maxPrice: 100_000 });
  assert.equal(routes.length, 24);
  assert.equal(Math.min(...routes.map(route => route.price)), 500);
  assert.ok(routes.every(route => Object.keys(route.choices).length === 5));
});

test('nested optional suppressor combinations are pruned during capability expansion', () => {
  const parts = [];
  const slots = Array.from({ length: 5 }, (_, index) => {
    const choices = Array.from({ length: 8 }, (_, choice) => silencer(`silencer-${index}-${choice}`));
    parts.push(...choices);
    return slot(`nested-${index}`, choices.map(item => item.id));
  });
  const root = part('nested-root', { properties: { slots } });
  parts.push(root);
  const base = weapon([slot('root', [root.id], true)]);
  for (const requireSuppressor of [false, true]) {
    const routes = createConstraintSearchRoutes(base, mapParts(parts), targets, {}, { maxPrice: 100_000, requireSuppressor });
    assert.ok(routes.length <= 24, `expected bounded routes, got ${routes.length}`);
    if (requireSuppressor) assert.ok(routes.some(route => route.suppressorKind > 0));
  }
  const result = calculate(base, parts, { requireSuppressor: true, maxPrice: 100_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.build.filter(entry => entry.item.categories.some(category => category.name === 'Silencer')).length, 1);
});

test('protected nested plan survives a greedy suppressor that conflicts with a later required root', () => {
  const second = part('second-root');
  const bad = { ...silencer('a-close-but-conflicting'), conflictingItems: [{ id: second.id }] };
  const good = { ...silencer('b-compatible'), ergonomicsModifier: -1 };
  const first = part('first-root', { properties: { slots: [slot('muzzle', [bad.id, good.id])] } });
  const base = weapon([slot('first', [first.id], true), slot('second', [second.id], true)]);
  const result = calculate(base, [first, second, bad, good], { requireSuppressor: true });
  assert.equal(result.error, undefined);
  assert.deepEqual(new Set(installed(result)), new Set([first.id, second.id, good.id]));
});

test('nested equivalence retains ancestor-sibling conflicts and incoming future conflicts', () => {
  const bad = { ...silencer('a-ancestor-bad') };
  const good = { ...silencer('b-ancestor-good'), ergonomicsModifier: -1 };
  const later = part('required-ancestor-sibling', { conflictingItems: [{ id: bad.id }] });
  const child = part('child-parent', { properties: { slots: [slot('nested-muzzle', [bad.id, good.id])] } });
  const root = part('ancestor-root', { properties: { slots: [
    slot('child', [child.id], true), slot('later', [later.id], true),
  ] } });
  const base = weapon([slot('root', [root.id], true)]);
  const result = calculate(base, [root, child, bad, good, later], { requireSuppressor: true });
  assert.equal(result.error, undefined);
  assert.ok(installed(result).includes(good.id));
  assert.ok(installed(result).includes(later.id));
  assert.ok(!installed(result).includes(bad.id));
});

test('explicit skip in a protected plan leaves room for a later optional required-device root', () => {
  const later = silencer('later-optional-suppressor');
  const bad = { ...silencer('earlier-bad-suppressor'), conflictingItems: [{ id: later.id }] };
  const root = part('skip-root', { properties: { slots: [slot('earlier-muzzle', [bad.id])] } });
  const base = weapon([slot('required-root', [root.id], true), slot('later-root', [later.id])]);
  const result = calculate(base, [root, bad, later], { requiredItemIds: [later.id], requireSuppressor: true });
  assert.equal(result.error, undefined);
  assert.ok(installed(result).includes(later.id));
  assert.ok(!installed(result).includes(bad.id));
});

test('missing prices preserve required roots and nested slots without a maximum price', () => {
  const unknown = part('unknown-price', { avg24hPrice: null });
  const sibling = part('unknown-required-sibling', { avg24hPrice: null });
  const root = part('unknown-root', { avg24hPrice: null, properties: { slots: [
    slot('first', [unknown.id], true), slot('second', [sibling.id], true),
  ] } });
  const base = weapon([slot('root', [root.id], true)]);
  const result = calculate(base, [root, unknown, sibling]);
  assert.equal(result.error, undefined);
  assert.deepEqual(new Set(installed(result)), new Set([root.id, unknown.id, sibling.id]));
  assert.equal(result.stats.price, null);
  assert.ok(result.warnings.some(warning => warning.code === 'PRICE_ITEMS_UNAVAILABLE'));
  const capped = calculate(base, [root, unknown, sibling], { maxPrice: 1000 });
  assert.ok(capped.error);
  assert.deepEqual(capped.build, []);
});

test('unknown-price alternatives use deterministic item ties', () => {
  const a = part('a-unknown', { avg24hPrice: null });
  const z = part('z-unknown', { avg24hPrice: null });
  const result = calculate(weapon([slot('root', [z.id, a.id], true)]), [z, a]);
  assert.equal(result.error, undefined);
  assert.deepEqual(installed(result), [a.id]);
});

test('an empty frontier returns a structured required-slot failure', () => {
  const base = weapon([slot('unavailable-root', ['absent-item'], true)]);
  const result = calculate(base, [], { maxPrice: 1000 });
  assert.ok(result.error.includes('Required weapon slots'));
  assert.deepEqual(result.build, []);
  assert.equal(result.stats.price, 100);
});

test('forced optional nested choices must exist and pass active filters', () => {
  const reflex = part('reflex', { categories: [{ name: 'Sights' }, { name: 'Reflex sight' }] });
  const magazine = part('magazine', { categories: [{ name: 'Magazine' }], properties: { capacity: 60 } });
  const correctMagazine = part('correct-magazine', { categories: [{ name: 'Magazine' }], properties: { capacity: 30 } });
  const laser = part('laser', { categories: [{ name: 'Comb. tact. device' }] });
  const suppressor = silencer('forbidden-suppressor');
  const cases = [
    { name: 'missing', choices: ['absent'], choice: 'absent', options: {} },
    { name: 'scope', choices: [reflex.id], choice: reflex.id, options: { sightMode: 'scope' } },
    { name: 'mod_tactical', choices: [laser.id], choice: laser.id, options: { includeLaser: false } },
    { name: 'mod_magazine', choices: [magazine.id, correctMagazine.id], choice: magazine.id, options: { magazineCapacity: 30 } },
    { name: 'muzzle', choices: [suppressor.id], choice: suppressor.id, options: { forbidSuppressor: true } },
  ];
  for (const fixture of cases) {
    const nested = slot(fixture.name, fixture.choices);
    const root = part('forced-root', { properties: { slots: [nested] } });
    const rootSlot = slot('root', [root.id], true);
    const base = weapon([rootSlot]);
    const rootPath = getRootSlotRouteKey(rootSlot, base.properties.slots);
    const path = getNestedSlotRouteKey(rootPath, root, nested, root.properties.slots);
    const result = _calculateWeighted(base, 1, 1, 0, mapParts([root, reflex, magazine, correctMagazine, laser, suppressor]),
      fixture.options, 100, 'custom', 0, 0, 100, undefined, {
        targetMatching: { targets, exactTargets: {} },
        forcedRootChoices: { [rootPath]: root.id }, forcedNestedChoices: { [path]: fixture.choice },
      });
    assert.ok(result.error, `${fixture.name} should invalidate the forced branch`);
    assert.deepEqual(result.build, []);
  }
});

test('an explicit null nested choice skips an otherwise improving optional branch', () => {
  const improvement = part('improving-child', { ergonomicsModifier: 10 });
  const nested = slot('optional-child', [improvement.id]);
  const root = part('skip-parent', { properties: { slots: [nested] } });
  const rootSlot = slot('root', [root.id], true);
  const base = weapon([rootSlot]);
  const rootPath = getRootSlotRouteKey(rootSlot, base.properties.slots);
  const path = getNestedSlotRouteKey(rootPath, root, nested, root.properties.slots);
  const result = _calculateWeighted(base, 1, 1, 0, mapParts([root, improvement]),
    {}, 100, 'custom', 0, 0, 100, undefined, {
      targetMatching: { targets: { ...targets, ergonomics: 60 }, exactTargets: {} },
      forcedRootChoices: { [rootPath]: root.id }, forcedNestedChoices: { [path]: null },
    });
  assert.equal(result.error, undefined);
  assert.deepEqual(installed(result), [root.id]);
  assert.equal(result.stats.ergonomics, 50);
});

test('required sight is retained when exact nested plans could otherwise skip it', () => {
  const sight = part('required-reflex', { ergonomicsModifier: -5, categories: [{ name: 'Sights' }, { name: 'Reflex sight' }] });
  const root = part('sight-parent', { properties: { slots: [slot('scope', [sight.id])] } });
  const result = calculate(weapon([slot('root', [root.id], true)]), [root, sight], { requireSight: true, sightMode: 'reflex' });
  assert.equal(result.error, undefined);
  assert.ok(installed(result).includes(sight.id));
});

for (const category of ['Comb. tact. device', 'Flashlight']) {
  for (const nested of [false, true]) {
    test(`Constraints installs requested ${category} despite worsening targets (${nested ? 'nested' : 'root'})`, () => {
      const device = part('requested-device', { ergonomicsModifier: -1, categories: [{ name: category }] });
      const tactical = slot('mod_tactical', [device.id]);
      const root = part('device-parent', { properties: { slots: [tactical] } });
      const base = weapon(nested ? [slot('root', [root.id], true)] : [tactical]);
      const options = category === 'Flashlight' ? { includeFlashlight: true } : { includeLaser: true };
      const result = calculate(base, [root, device], options);
      assert.equal(result.error, undefined);
      assert.ok(installed(result).includes(device.id));
      assert.equal(result.stats.ergonomics, 49);
    });
  }
}

test('unavailable requested tactical devices return structured errors in Constraints mode', () => {
  for (const options of [{ includeLaser: true }, { includeFlashlight: true }]) {
    const result = calculate(weapon([]), [], options);
    assert.ok(result.error);
    assert.deepEqual(result.build, []);
    assert.deepEqual(structuredClone(result), result);
  }
});

test('Exact zero ergonomics agrees with the displayed and recalculated lower clamp', () => {
  const negative = part('negative-ergonomics', { ergonomicsModifier: -60 });
  const profile = { ...targets, ergonomics: 0 };
  const result = calculateBestBuild(weapon([slot('root', [negative.id], true)]),
    'custom', 0, 100, mapParts([negative]), {}, profile, { ergonomics: true });
  assert.equal(result.error, undefined);
  assert.equal(result.stats.ergonomics, 0);
  assert.equal(result.targetMatching.axes.ergonomics.actual, result.stats.ergonomics);
  assert.equal(result.targetMatching.exactMatches, true);
});
