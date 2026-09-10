import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild } from '../../src/domain/calculator.js';
import {
  getCustomPriorityVector,
} from '../../src/domain/customPriorityAttributes.js';
import { getBuildTieKey } from '../../src/domain/calculator/scoring.js';
import {
  generatePriorityCandidates,
  getPrioritySearchRoutes,
} from '../../src/domain/calculator/priorityCandidates.js';

function createPriorityWeapon() {
  return {
    id: 'priority-fixture-weapon',
    name: 'Priority fixture weapon',
    shortName: 'PFW',
    weight: 1,
    basePrice: 100,
    avg24hPrice: 100,
    categories: [{ name: 'Weapon' }],
    conflictingItems: [],
    properties: {
      ergonomics: 50,
      recoilVertical: 100,
      recoilHorizontal: 100,
      slots: [{
        name: 'Stock',
        nameId: 'mod_stock',
        required: true,
        filters: {
          allowedItems: [
            { id: 'priority-heavy-build' },
            { id: 'priority-light-build' },
          ],
        },
      }],
    },
  };
}

function createPriorityMod({ id, weight, price, ergonomicsModifier, recoilModifier }) {
  return {
    id,
    name: id,
    shortName: id,
    weight,
    basePrice: price,
    avg24hPrice: price,
    categories: [],
    conflictingItems: [],
    ergonomicsModifier,
    recoilModifier,
    properties: { slots: [] },
  };
}

function createPriorityFixture() {
  const weapon = createPriorityWeapon();
  const heavy = createPriorityMod({
    id: 'priority-heavy-build',
    weight: 1,
    price: 5_000,
    ergonomicsModifier: 40,
    recoilModifier: -50,
  });
  const light = createPriorityMod({
    id: 'priority-light-build',
    weight: 0.1,
    price: 100,
    ergonomicsModifier: 0,
    recoilModifier: 0,
  });
  return {
    weapon,
    modMap: { [heavy.id]: heavy, [light.id]: light },
    options: {
      maxPrice: 0,
      maxWeight: 0,
      priceMode: 'pvp',
      includeTraderPrices: true,
    },
  };
}

const THREE_PRIORITIES = ['verticalRecoil', 'ergonomics', 'horizontalRecoil'];
const FOUR_PRIORITIES = [...THREE_PRIORITIES, 'weight'];

test('Priority candidate search routes are independent from selected priority attributes', () => {
  assert.equal(getPrioritySearchRoutes.length, 0);
  assert.equal(generatePriorityCandidates.length, 1);

  for (const selectedAttributeCount of [1, 2, 3, 4]) {
    const routes = getPrioritySearchRoutes();
    assert.equal(routes.length, 24, `route count for ${selectedAttributeCount} priorities`);
    assert.deepEqual(routes.slice(0, 21), Array.from({ length: 21 }, (_, index) => ({
      ergoWeight: index / 20,
      recoilWeight: 1 - (index / 20),
      weightWeight: 0.001,
    })));
    assert.deepEqual(routes.slice(21), [
      { ergoWeight: 0, recoilWeight: 0, weightWeight: 15 },
      { ergoWeight: 1, recoilWeight: 0, weightWeight: 15 },
      { ergoWeight: 0, recoilWeight: 1, weightWeight: 15 },
    ]);
  }
});

test('Priority candidate generation returns one common pool and reuses its calculation cache', () => {
  const cache = {};
  const calls = [];
  const diagnostics = generatePriorityCandidates({
    weapon: { id: 'stub-weapon' },
    modMap: {},
    options: { maxPrice: 0 },
    calculationCache: cache,
    calculateWeighted(...args) {
      calls.push(args);
      return { build: [], stats: { price: 0 } };
    },
  });

  assert.equal(diagnostics.routeCount, 24);
  assert.equal(diagnostics.normalRouteCount, 24);
  assert.equal(diagnostics.budgetAwareRouteCount, 0);
  assert.equal(diagnostics.totalRouteCalls, 24);
  assert.equal(diagnostics.routeResults.some(routeResult => routeResult.source === 'budgetAwareMetaCoverage'), false);
  assert.equal(calls.length, 24);
  assert.equal(calls.every(args => args[11] === cache), true);
  assert.equal(calls.every(args => args[3] === 0 && args[12] === undefined), true);
  assert.deepEqual(calls.map(args => ({
    ergoWeight: args[1],
    recoilWeight: args[2],
    weightWeight: args[8],
  })), getPrioritySearchRoutes());
  assert.deepEqual(diagnostics.candidateBuildKeys, ['']);
  assert.equal(diagnostics.candidateResults.length, 1);
});

test('Priority candidate generation retains the latest result for duplicate build keys', () => {
  let callCount = 0;
  const diagnostics = generatePriorityCandidates({
    weapon: { id: 'duplicate-weapon' },
    modMap: {},
    options: { maxPrice: 0 },
    calculationCache: {},
    calculateWeighted() {
      callCount += 1;
      return {
        build: [{ item: { id: 'duplicate-build' } }],
        stats: { price: callCount },
      };
    },
  });

  assert.equal(callCount, 24);
  assert.deepEqual(diagnostics.candidateBuildKeys, ['duplicate-build']);
  assert.equal(diagnostics.candidateResults[0].stats.price, 24);
});

test('Rank 1 vertical recoil advantage beats lower priority weight across three and four ranks', () => {
  const fixture = createPriorityFixture();
  const withoutWeight = generatePriorityCandidates(fixture);
  const withWeight = generatePriorityCandidates(fixture);

  assert.deepEqual(withoutWeight.candidateBuildKeys, withWeight.candidateBuildKeys);
  assert.equal(withoutWeight.candidateBuildKeys.includes('priority-light-build'), true);
  assert.equal(
    withoutWeight.routeResults[21].result.build.some(part => part.item.id === 'priority-light-build'),
    true,
  );

  const priorityResults = withoutWeight.candidateResults;
  const resultByKey = Object.fromEntries(
    priorityResults.map(result => [getBuildTieKey(result), result]),
  );
  for (const result of priorityResults) {
    assert.deepEqual(
      getCustomPriorityVector(result, withoutWeight.candidateResults, FOUR_PRIORITIES),
      getCustomPriorityVector(result, withWeight.candidateResults, FOUR_PRIORITIES),
    );
    assert.equal(
      getCustomPriorityVector(result, priorityResults, FOUR_PRIORITIES)
        .every(value => Number.isFinite(value) && value >= 0 && value <= 1),
      true,
    );
  }

  assert.deepEqual(
    getCustomPriorityVector(resultByKey['priority-light-build'], priorityResults, THREE_PRIORITIES),
    [0, 0, 0],
  );
  assert.deepEqual(
    getCustomPriorityVector(resultByKey['priority-light-build'], priorityResults, FOUR_PRIORITIES),
    [0, 0, 0, 1],
  );

  const threePriorityResult = calculateBestBuild(
    fixture.weapon,
    'custom',
    999,
    -1,
    fixture.modMap,
    fixture.options,
    { ergonomics: 999, verticalRecoil: -1, horizontalRecoil: -1, weight: 0.01, price: 0 },
    null,
    THREE_PRIORITIES,
    'priorities',
  );
  const fourPriorityResult = calculateBestBuild(
    fixture.weapon,
    'custom',
    999,
    -1,
    fixture.modMap,
    fixture.options,
    { ergonomics: 999, verticalRecoil: -1, horizontalRecoil: -1, weight: 0.01, price: 0 },
    null,
    FOUR_PRIORITIES,
    'priorities',
  );

  assert.equal(
    getBuildTieKey(threePriorityResult),
    'priority-heavy-build',
    'the heavy build wins its meaningful Rank 1 vertical recoil advantage',
  );
  assert.equal(
    getBuildTieKey(fourPriorityResult),
    'priority-heavy-build',
    'the light build’s Rank 4 weight advantage cannot override Rank 1',
  );

  const emptyPriorityResult = calculateBestBuild(
    fixture.weapon,
    'custom',
    999,
    -1,
    fixture.modMap,
    fixture.options,
    { ergonomics: 999, verticalRecoil: -1, horizontalRecoil: -1, weight: 0.01, price: 0 },
    null,
    [],
    'priorities',
  );
  assert.equal(getBuildTieKey(emptyPriorityResult), 'priority-light-build');
});

test('Priority candidate generation keeps hard maxPrice eligibility independent of priority attributes', () => {
  const fixture = createPriorityFixture();
  const capped = generatePriorityCandidates({
    ...fixture,
    options: { ...fixture.options, maxPrice: 3_000 },
  });

  assert.deepEqual(capped.candidateBuildKeys, ['priority-light-build']);
  assert.equal(capped.candidateResults.every(result => result.stats.price <= 3_000), true);
  assert.notDeepEqual(capped.candidateBuildKeys, generatePriorityCandidates(fixture).candidateBuildKeys);
});
