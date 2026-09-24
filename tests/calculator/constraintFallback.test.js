import test from 'node:test';
import assert from 'node:assert/strict';

import { _calculateWeighted } from '../../src/domain/calculator/candidateSearch.js';
import { calculateBestBuild, createConstraintSearchRoutes } from '../../src/domain/calculator/orchestration.js';

const targets = { ergonomics: 44, verticalRecoil: 50, horizontalRecoil: 150, weight: 4 };
const slot = (name, ids, required = false) => ({
  name, nameId: name, required, filters: { allowedItems: ids.map(id => ({ id })) },
});
const part = (id, overrides = {}) => ({
  id, name: id, avg24hPrice: 100, weight: 0.1, categories: [],
  properties: { slots: [] }, ...overrides,
});

function createFixture(invalidMagazineCount = 8) {
  const sight = part('reflex-sight', {
    categories: [{ name: 'Sights' }, { name: 'Reflex sight' }],
    ergonomicsModifier: -1,
  });
  const mount = part('scope-mount', { properties: { slots: [slot('scope', [sight.id])] } });
  const barrel = part('barrel', { weight: 0.6, recoilModifier: -50 });
  const receiver = part('receiver', {
    weight: 0.4,
    properties: { slots: [slot('barrel', [barrel.id], true), slot('mount', [mount.id])] },
  });
  const magazine = (id, capacity, ergonomicsModifier) => part(id, {
    weight: 0.4, ergonomicsModifier, categories: [{ name: 'Magazine' }],
    properties: { capacity, slots: [] },
  });
  // Route estimates prefer these magazines, but the recursive builder must
  // reject them because a magazine with the requested capacity is available.
  const wrongMagazines = Array.from({ length: invalidMagazineCount }, (_, index) => (
    magazine(`magazine-60-${index}`, 60, -5)
  ));
  const validMagazine = magazine('magazine-30', 30, -10);
  const parts = [receiver, barrel, mount, sight, ...wrongMagazines, validMagazine];
  return {
    weapon: {
      id: 'm4-style-fallback-fixture', avg24hPrice: 1000, weight: 2,
      properties: {
        ergonomics: 55, recoilVertical: 100, recoilHorizontal: 300,
        slots: [
          slot('receiver', [receiver.id], true),
          slot('mod_magazine', [...wrongMagazines.map(item => item.id), validMagazine.id], true),
        ],
      },
    },
    modMap: Object.fromEntries(parts.map(item => [item.id, item])),
    options: { magazineCapacity: 30, sightMode: 'reflex' },
  };
}

function calculateUnforced(fixture, searchCapabilities = {}) {
  return _calculateWeighted(
    fixture.weapon, 1, 1, 0, fixture.modMap, fixture.options,
    100, 'custom', 0, 0, 100, undefined,
    { characteristicConstraints: targets, ...searchCapabilities },
  );
}

function calculateForcedCandidates(fixture) {
  const routes = createConstraintSearchRoutes(fixture.weapon, fixture.modMap, targets, fixture.options);
  assert.ok(routes.length > 0, 'the regression requires a nonempty route frontier');
  assert.ok(routes.some(route => Object.keys(route.nestedChoices).length > 0));
  return routes.flatMap(route => [
    calculateUnforced(fixture, { forcedRootChoices: route.choices }),
    calculateUnforced(fixture, {
      forcedRootChoices: route.choices, forcedNestedChoices: route.nestedChoices,
    }),
  ]);
}

const calculate = (fixture) => calculateBestBuild(
  fixture.weapon, 'custom', targets.ergonomics, targets.verticalRecoil,
  fixture.modMap, fixture.options, targets,
);
const installed = result => result.build.map(entry => entry.item.id);

test('Constraints preserves an unforced valid build when every forced root and nested route fails', () => {
  const fixture = createFixture();
  const forced = calculateForcedCandidates(fixture);
  assert.ok(forced.every(result => result.error), 'all generated route executions must fail');
  const baseline = calculateUnforced(fixture);
  assert.equal(baseline.error, undefined);
  assert.ok(installed(baseline).includes('magazine-30'));

  const result = calculate(fixture);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.build, baseline.build);
  assert.deepEqual(result.stats, baseline.stats);
  assert.equal(new Set(installed(result)).size, result.build.length);
});

test('Constraints selects a valid candidate alongside invalid forced routes', () => {
  const fixture = createFixture(7);
  const forced = calculateForcedCandidates(fixture);
  assert.ok(forced.some(result => result.error));
  assert.ok(forced.some(result => !result.error));
  const result = calculate(fixture);
  assert.equal(result.error, undefined);
  assert.ok(installed(result).includes('magazine-30'));
  assert.ok(!installed(result).some(id => id.startsWith('magazine-60')));
});

test('Constraints retains a compatible nested route when the unforced baseline fails', () => {
  const bad = part('close-suppressor', {
    weight: 0, categories: [{ name: 'Silencer' }], conflictingItems: [{ id: 'later-root' }],
  });
  const good = part('compatible-suppressor', {
    weight: 0, categories: [{ name: 'Silencer' }], ergonomicsModifier: -1,
  });
  const first = part('first-root', {
    weight: 0, properties: { slots: [slot('muzzle', [bad.id, good.id])] },
  });
  const later = part('later-root', { weight: 0 });
  const fixture = createFixture();
  fixture.weapon.weight = 4;
  fixture.weapon.properties = {
    ergonomics: 50, recoilVertical: 50, recoilHorizontal: 150,
    slots: [slot('first', [first.id], true), slot('later', [later.id], true)],
  };
  fixture.modMap = Object.fromEntries([first, later, bad, good].map(item => [item.id, item]));
  fixture.options = { requireSuppressor: true };
  assert.ok(calculateUnforced(fixture).error);
  assert.ok(calculateForcedCandidates(fixture).some(result => !result.error));
  const result = calculate(fixture);
  assert.equal(result.error, undefined);
  assert.deepEqual(new Set(installed(result)), new Set([first.id, later.id, good.id]));
});

test('Constraints prefers the better valid baseline over a boundary frontier candidate', () => {
  const greedy = part('greedy-root', { weight: 0, ergonomicsModifier: -10 });
  const optimal = part('optimal-root', { weight: 0, ergonomicsModifier: -20 });
  const later = part('later-root', { weight: 0, ergonomicsModifier: 20 });
  const fixture = createFixture();
  fixture.weapon.weight = 4;
  fixture.weapon.properties = {
    ergonomics: 50, recoilVertical: 50, recoilHorizontal: 150,
    slots: [slot('first', [greedy.id, optimal.id], true), slot('later', [later.id], true)],
  };
  fixture.modMap = Object.fromEntries([greedy, optimal, later].map(item => [item.id, item]));
  fixture.options = {};
  const baseline = calculateUnforced(fixture);
  assert.equal(baseline.error, undefined);
  assert.equal(baseline.stats.ergonomics, 60);
  const result = calculate(fixture);
  assert.equal(result.error, undefined);
  assert.equal(result.stats.ergonomics, 60);
  assert.equal(result.constraintEvaluation.totalViolation, 0);
  assert.ok(installed(result).includes(greedy.id));
});

test('Constraints fallback keeps an impossible hard maximum weight as an error', () => {
  const fixture = createFixture();
  fixture.options.maxWeight = 1;
  assert.ok(calculateForcedCandidates(fixture).every(result => result.error));
  assert.ok(calculateUnforced(fixture).error);
  const result = calculate(fixture);
  assert.ok(result.error);
  assert.deepEqual(result.build, []);
});

test('Constraints returns a hard-valid unforced fallback that misses the ergonomics minimum', () => {
  const fixture = createFixture();
  // The sight is optional and the magazine-30 is mandatory, so every build
  // stays at or below 43 ergonomics against the 44 minimum.
  fixture.weapon.properties.ergonomics = 53;
  assert.ok(calculateForcedCandidates(fixture).every(result => result.error));
  const baseline = calculateUnforced(fixture);
  assert.equal(baseline.error, undefined);
  assert.equal(baseline.constraintEvaluation.satisfied, false);
  const result = calculate(fixture);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.build, baseline.build);
  assert.equal(result.stats.ergonomics, 43);
  assert.equal(result.constraintEvaluation.satisfied, false);
  assert.equal(result.constraintEvaluation.axes.ergonomics.violation, 1);
});
