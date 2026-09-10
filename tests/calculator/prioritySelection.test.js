import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCustomPrioritySelectionDiagnostics,
  selectCustomPriorityCandidate,
} from '../../src/domain/calculator/prioritySelection.js';
import { CUSTOM_PRIORITY_FLOAT_EPSILON } from '../../src/domain/customPriorityAttributes.js';

function candidate(id, {
  ergonomics = 50,
  verticalRecoil = 100,
  horizontalRecoil = 100,
  weight = 4,
  price = 1000,
} = {}) {
  return {
    result: {
      build: [{ item: { id } }],
      stats: { ergonomics, recoilVertical: verticalRecoil, recoilHorizontal: horizontalRecoil, weight, price },
    },
  };
}

function selectedId(candidates, attributes) {
  return selectCustomPriorityCandidate(candidates, attributes)?.result.build[0].item.id;
}

test('global shortlist applies each lower rank to all candidates close to the best higher rank', () => {
  const candidates = [
    candidate('A', { verticalRecoil: 47, ergonomics: 50 }),
    candidate('B', { verticalRecoil: 49, ergonomics: 90 }),
    candidate('boundary', { verticalRecoil: 67, ergonomics: 0 }),
  ];

  assert.equal(selectedId(candidates, ['verticalRecoil']), 'A');
  assert.equal(selectedId(candidates, ['verticalRecoil', 'ergonomics']), 'B');
  assert.deepEqual(getCustomPrioritySelectionDiagnostics(candidates, ['verticalRecoil', 'ergonomics']), [
    {
      rank: 1,
      attribute: 'verticalRecoil',
      beforeCount: 3,
      bestNormalizedContribution: 1,
      tolerance: 0.1,
      afterCount: 2,
    },
    {
      rank: 2,
      attribute: 'ergonomics',
      beforeCount: 2,
      bestNormalizedContribution: 1,
      tolerance: 0.1,
      afterCount: 1,
    },
  ]);
});

test('user priority configurations keep A and B in the Rank 1 band, then use the configured next rank', () => {
  const candidates = [
    candidate('A', {
      verticalRecoil: 47,
      ergonomics: 33,
      weight: 3.62,
      horizontalRecoil: 136,
      price: 200,
    }),
    candidate('B', {
      verticalRecoil: 49,
      ergonomics: 60,
      weight: 3.70,
      horizontalRecoil: 138,
      price: 300,
    }),
    candidate('C', {
      verticalRecoil: 60,
      ergonomics: 100,
      weight: 3.00,
      horizontalRecoil: 170,
      price: 400,
    }),
    candidate('normalization-bound', {
      verticalRecoil: 80,
      ergonomics: 0,
      weight: 3.00,
      horizontalRecoil: 170,
      price: 500,
    }),
  ];

  assert.equal(
    getCustomPrioritySelectionDiagnostics(candidates, ['verticalRecoil'])[0].afterCount,
    2,
    'C is excluded at Rank 1 while A and B remain within the 0.10 band',
  );
  assert.equal(selectedId(candidates, ['verticalRecoil', 'weight', 'horizontalRecoil']), 'A');
  assert.equal(selectedId(candidates, [
    'verticalRecoil',
    'ergonomics',
    'weight',
    'horizontalRecoil',
  ]), 'B');
});

test('a lower rank cannot recover a material Rank 1 loss', () => {
  const candidates = [
    candidate('rank-one-winner', { verticalRecoil: 40, ergonomics: 0 }),
    candidate('lower-rank-winner', { verticalRecoil: 60, ergonomics: 100 }),
    candidate('normalization-bound', { verticalRecoil: 140, ergonomics: 50 }),
  ];

  assert.equal(selectedId(candidates, ['verticalRecoil', 'ergonomics']), 'rank-one-winner');
});

test('rank tolerance includes boundary values with floating epsilon and excludes larger losses', () => {
  const candidates = [
    candidate('best', { ergonomics: 100, verticalRecoil: 100 }),
    candidate('within-epsilon', { ergonomics: 90 - (CUSTOM_PRIORITY_FLOAT_EPSILON * 50), verticalRecoil: 0 }),
    candidate('outside-epsilon', { ergonomics: 90 - (CUSTOM_PRIORITY_FLOAT_EPSILON * 200), verticalRecoil: 0 }),
    candidate('minimum', { ergonomics: 0, verticalRecoil: 0 }),
  ];

  assert.equal(selectedId(candidates, ['ergonomics', 'verticalRecoil']), 'within-epsilon');
});

test('rank tolerance retains contributions below and at 0.10, but excludes larger losses', () => {
  const candidates = [
    candidate('best', { ergonomics: 100 }),
    candidate('below', { ergonomics: 91 }),
    candidate('at-boundary', { ergonomics: 90 }),
    candidate('above', { ergonomics: 89 }),
    candidate('minimum', { ergonomics: 0 }),
  ];

  assert.equal(
    getCustomPrioritySelectionDiagnostics(candidates, ['ergonomics'])[0].afterCount,
    3,
  );
});

test('later rank normalization remains fixed to the original full candidate pool', () => {
  const candidates = [
    candidate('A', { verticalRecoil: 40, ergonomics: 50, price: 100 }),
    candidate('B', { verticalRecoil: 42, ergonomics: 60, price: 500 }),
    candidate('rank-one-bound', { verticalRecoil: 60, ergonomics: 1000, price: 1000 }),
  ];

  assert.equal(selectedId(candidates, ['verticalRecoil', 'ergonomics']), 'A');
  assert.equal(getCustomPrioritySelectionDiagnostics(candidates, ['verticalRecoil', 'ergonomics'])[1].afterCount, 2);
});

test('one through four ranks narrow the same full-pool-normalized shortlist', () => {
  const candidates = [
    candidate('one', { verticalRecoil: 40, ergonomics: 50, horizontalRecoil: 100, weight: 4, price: 100 }),
    candidate('two', { verticalRecoil: 42, ergonomics: 90, horizontalRecoil: 100, weight: 4, price: 500 }),
    candidate('three', { verticalRecoil: 42, ergonomics: 90, horizontalRecoil: 80, weight: 4, price: 600 }),
    candidate('four', { verticalRecoil: 42, ergonomics: 90, horizontalRecoil: 80, weight: 2 }),
    candidate('normalization-bound', { verticalRecoil: 60, ergonomics: 0, horizontalRecoil: 200, weight: 10 }),
  ];
  const ordered = ['verticalRecoil', 'ergonomics', 'horizontalRecoil', 'weight'];

  assert.equal(selectedId(candidates, ordered.slice(0, 1)), 'one');
  assert.equal(selectedId(candidates, ordered.slice(0, 2)), 'two');
  assert.equal(selectedId(candidates, ordered.slice(0, 3)), 'three');
  assert.equal(selectedId(candidates, ordered), 'four');
});

test('selection is independent of candidate order and empty priorities use price then build key', () => {
  const candidates = [
    candidate('z-key', { ergonomics: 60, price: 100 }),
    candidate('a-key', { ergonomics: 60, price: 100 }),
    candidate('best-stats', { ergonomics: 100, price: 500 }),
  ];
  const permutations = [
    candidates,
    [...candidates].reverse(),
    [candidates[1], candidates[2], candidates[0]],
  ];

  assert.deepEqual(permutations.map(pool => selectedId(pool, ['ergonomics'])), [
    'best-stats', 'best-stats', 'best-stats',
  ]);
  assert.deepEqual(permutations.map(pool => selectedId(pool, [])), [
    'a-key', 'a-key', 'a-key',
  ]);
});

test('one priority ignores other stats, then uses price and build key among candidates in tolerance', () => {
  const higherErgo = candidate('z-higher-ergo', {
    ergonomics: 100,
    verticalRecoil: 1,
    horizontalRecoil: 1,
    weight: 1,
    price: 200,
  });
  const closeErgo = candidate('a-close-ergo', {
    ergonomics: 91,
    verticalRecoil: 999,
    horizontalRecoil: 999,
    weight: 99,
    price: 100,
  });
  const outsideBand = candidate('outside-band', { ergonomics: 0, price: 1 });
  const candidates = [higherErgo, closeErgo, outsideBand];

  assert.equal(getCustomPrioritySelectionDiagnostics(candidates, ['ergonomics'])[0].afterCount, 2);
  assert.equal(selectedId(candidates, ['ergonomics']), 'a-close-ergo');
  closeErgo.result.stats.price = 200;
  assert.equal(selectedId(candidates, ['ergonomics']), 'a-close-ergo');
});

test('equal ranges and invalid values remain finite and use deterministic ties', () => {
  const candidates = [
    candidate('b', { ergonomics: Number.NaN, verticalRecoil: Number.NaN, price: Number.POSITIVE_INFINITY }),
    candidate('a', { ergonomics: Number.NaN, verticalRecoil: Number.NaN, price: null }),
  ];

  assert.equal(selectedId(candidates, ['ergonomics', 'verticalRecoil']), 'a');
  const diagnostics = getCustomPrioritySelectionDiagnostics(candidates, ['ergonomics', 'verticalRecoil']);
  assert.equal(diagnostics.every(diagnostic => Number.isFinite(diagnostic.bestNormalizedContribution)), true);
});
