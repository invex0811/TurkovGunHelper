import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild } from '../../src/domain/calculator.js';
import { PRICE_AWARE_TARGET } from '../../src/domain/calculator/constants.js';
import { getBuildTieKey } from '../../src/domain/calculator/scoring.js';
import { generatePriorityCandidates } from '../../src/domain/calculator/priorityCandidates.js';
import { selectCustomPriorityCandidate } from '../../src/domain/calculator/prioritySelection.js';

function createItem({ id, price, ergonomicsModifier = 0, recoilModifier = 0, category }) {
  return {
    id,
    name: id,
    shortName: id,
    basePrice: price,
    avg24hPrice: price,
    weight: 0.1,
    ergonomicsModifier,
    recoilModifier,
    categories: [{ name: category }],
    conflictingItems: [],
    properties: { slots: [] },
  };
}

function createBudgetSearchFixture() {
  const optionalErgo = createItem({
    id: 'optional-ergo', price: 15_000, ergonomicsModifier: 1, category: 'Foregrip',
  });
  const recoilMuzzle = createItem({
    id: 'budget-recoil-muzzle', price: 18_000, recoilModifier: -10, category: 'Muzzle',
  });
  const weapon = {
    id: 'budget-search-weapon',
    name: 'Budget search weapon',
    shortName: 'BSW',
    basePrice: 100,
    avg24hPrice: 100,
    weight: 1,
    categories: [{ name: 'Weapon' }],
    conflictingItems: [],
    properties: {
      ergonomics: 50,
      recoilVertical: 100,
      recoilHorizontal: 100,
      slots: [
        {
          name: 'Foregrip', nameId: 'mod_foregrip', required: false,
          filters: { allowedItems: [{ id: optionalErgo.id }] },
        },
        {
          name: 'Muzzle', nameId: 'mod_muzzle', required: false,
          filters: { allowedItems: [{ id: recoilMuzzle.id }] },
        },
      ],
    },
  };
  return {
    weapon,
    modMap: { [optionalErgo.id]: optionalErgo, [recoilMuzzle.id]: recoilMuzzle },
    options: { maxPrice: 20_000, maxWeight: 0, priceMode: 'pvp', includeTraderPrices: true },
  };
}

test('budget-aware Priority pool includes the Meta price-aware recoil build under the same budget', () => {
  const fixture = createBudgetSearchFixture();
  const metaResult = calculateBestBuild(
    fixture.weapon,
    PRICE_AWARE_TARGET,
    0,
    Number.POSITIVE_INFINITY,
    fixture.modMap,
    fixture.options,
  );
  const priorityPool = generatePriorityCandidates(fixture);
  const metaKey = getBuildTieKey(metaResult);
  const normalBuildKeys = priorityPool.routeResults
    .filter(routeResult => routeResult.source === 'normal' && !routeResult.result.error)
    .map(routeResult => getBuildTieKey(routeResult.result));
  const budgetAwareBuildKeys = priorityPool.routeResults
    .filter(routeResult => routeResult.source === 'budgetAware' && !routeResult.result.error)
    .map(routeResult => getBuildTieKey(routeResult.result));
  const metaCoverageBuildKeys = priorityPool.routeResults
    .filter(routeResult => routeResult.source === 'budgetAwareMetaCoverage' && !routeResult.result.error)
    .map(routeResult => getBuildTieKey(routeResult.result));

  assert.equal(metaKey, 'budget-recoil-muzzle');
  assert.equal(metaResult.stats.recoilVertical, 90);
  assert.equal(normalBuildKeys.includes(metaKey), false);
  assert.equal(budgetAwareBuildKeys.includes(metaKey), true);
  assert.equal(metaCoverageBuildKeys.includes(metaKey), true);
  assert.equal(
    priorityPool.candidateBuildKeys.includes(metaKey),
    true,
    'the budget-aware Meta recoil build must be discoverable by Priority generation',
  );
});

test('budget-aware Priority counterparts apply leaf recoil upgrades that normal routes do not', () => {
  const cheapMuzzle = createItem({
    id: 'cheap-leaf-muzzle', price: 1_000, recoilModifier: -1, category: 'Muzzle device',
  });
  const strongMuzzle = createItem({
    id: 'strong-leaf-muzzle', price: 100_000, recoilModifier: -10, category: 'Muzzle device',
  });
  const weapon = {
    id: 'leaf-upgrade-weapon',
    name: 'Leaf upgrade weapon',
    shortName: 'LUW',
    basePrice: 100,
    avg24hPrice: 100,
    weight: 1,
    categories: [{ name: 'Weapon' }],
    conflictingItems: [],
    properties: {
      ergonomics: 50,
      recoilVertical: 100,
      recoilHorizontal: 100,
      slots: [{
        name: 'Muzzle', nameId: 'mod_muzzle', required: false,
        filters: { allowedItems: [{ id: cheapMuzzle.id }, { id: strongMuzzle.id }] },
      }],
    },
  };
  const diagnostics = generatePriorityCandidates({
    weapon,
    modMap: { [cheapMuzzle.id]: cheapMuzzle, [strongMuzzle.id]: strongMuzzle },
    options: { maxPrice: 150_000, maxWeight: 0, priceMode: 'pvp', includeTraderPrices: true },
  });
  const normalCounterpart = diagnostics.routeResults.find(routeResult => (
    routeResult.source === 'normal'
      && routeResult.route.ergoWeight === 1
      && routeResult.route.recoilWeight === 0
      && routeResult.route.weightWeight === 0.001
  ));
  const budgetAwareCounterpart = diagnostics.routeResults.find(routeResult => (
    routeResult.source === 'budgetAware'
      && routeResult.route.ergoWeight === 1
      && routeResult.route.recoilWeight === 0
      && routeResult.route.weightWeight === 0.001
  ));

  assert.equal(getBuildTieKey(normalCounterpart.result), cheapMuzzle.id);
  assert.equal(getBuildTieKey(budgetAwareCounterpart.result), strongMuzzle.id);
  assert.equal(normalCounterpart.result.stats.recoilVertical, 99);
  assert.equal(budgetAwareCounterpart.result.stats.recoilVertical, 90);
});

test('budget-aware routes are bounded, capability-explicit, and preserve hard price boundaries', () => {
  const calls = [];
  const diagnostics = generatePriorityCandidates({
    weapon: { id: 'bounded-routes-weapon' },
    options: { maxPrice: 100 },
    calculateWeighted(...args) {
      calls.push(args);
      const price = [99, 100, 101, null][(calls.length - 1) % 4];
      return {
        build: [{ item: { id: `price-${price}` } }],
        stats: { price },
      };
    },
  });

  assert.equal(diagnostics.normalRouteCount, 24);
  assert.equal(diagnostics.budgetAwareRouteCount, 26);
  assert.equal(diagnostics.totalRouteCalls, 50);
  assert.equal(calls.length, 50);
  assert.equal(calls.slice(0, 24).every(args => args[3] === 0 && args[12] === undefined), true);
  assert.equal(calls.slice(24).every(args => args[3] > 0 && args[12]?.budgetAwareSearch === true), true);
  const metaCoverageRoutes = diagnostics.routeResults.filter(routeResult => routeResult.source === 'budgetAwareMetaCoverage');
  assert.deepEqual(metaCoverageRoutes.map(routeResult => ({
    ergoWeight: routeResult.route.ergoWeight,
    recoilWeight: routeResult.route.recoilWeight,
    weightWeight: routeResult.route.weightWeight,
    priceWeight: routeResult.route.priceWeight,
  })), [
    { ergoWeight: 1, recoilWeight: 3, weightWeight: 0.001, priceWeight: 0.0001 },
    { ergoWeight: 1, recoilWeight: 3, weightWeight: 0.001, priceWeight: 0.002 },
  ]);
  assert.deepEqual(diagnostics.candidateBuildKeys, ['price-100', 'price-99']);
  assert.equal(diagnostics.candidates.every(candidate => candidate.sources.includes('normal') && candidate.sources.includes('budgetAware')), true);
  assert.equal(diagnostics.candidateResults.every(result => result.stats.price != null && result.stats.price <= 100), true);
});

test('required modules and their reserved future price remain mandatory in budget-aware search', () => {
  const fixture = createBudgetSearchFixture();
  fixture.weapon.properties.slots[1].required = true;
  const diagnostics = generatePriorityCandidates(fixture);

  assert.equal(diagnostics.candidateBuildKeys.includes('budget-recoil-muzzle'), true);
  assert.equal(
    diagnostics.candidateResults.every(result => result.build.some(part => part.item.id === 'budget-recoil-muzzle')),
    true,
  );
  assert.equal(diagnostics.candidateResults.every(result => result.stats.price <= fixture.options.maxPrice), true);
});

test('Priority final ranking does not compensate a meaningful Rank 1 recoil loss with lower price', () => {
  const expensiveBetterRecoil = {
    result: {
      build: [{ item: { id: 'expensive-better-recoil' } }],
      stats: { ergonomics: 50, recoilVertical: 40, recoilHorizontal: 40, weight: 4, price: 19_000 },
    },
  };
  const cheaperWorseRecoil = {
    result: {
      build: [{ item: { id: 'cheap-worse-recoil' } }],
      stats: { ergonomics: 50, recoilVertical: 70, recoilHorizontal: 70, weight: 4, price: 100 },
    },
  };

  assert.equal(
    getBuildTieKey(selectCustomPriorityCandidate(
      [expensiveBetterRecoil, cheaperWorseRecoil],
      ['verticalRecoil', 'horizontalRecoil'],
    ).result),
    'expensive-better-recoil',
  );
});
