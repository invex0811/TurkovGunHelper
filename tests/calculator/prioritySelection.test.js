import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCustomPrioritySelectionDiagnostics,
  selectCustomPriorityCandidate,
  getWeightedCustomPrioritySelectionDiagnostics,
  selectWeightedCustomPriorityCandidate,
} from '../../src/domain/calculator/prioritySelection.js';
import {
  CUSTOM_PRIORITY_FLOAT_EPSILON,
  getCustomPriorityBounds,
  getCustomPriorityVectorFromBounds,
} from '../../src/domain/customPriorityAttributes.js';

function candidate(id, {
  ergonomics = 50,
  recoilModifier = 0,
  verticalRecoil = 100,
  horizontalRecoil = 100,
  weight = 4,
  price = 1000,
} = {}) {
  return {
    result: {
      build: [{ item: { id } }],
      stats: { ergonomics, recoilModifier, recoilVertical: verticalRecoil, recoilHorizontal: horizontalRecoil, weight, price },
    },
  };
}

function selectedId(candidates, attributes) {
  return selectCustomPriorityCandidate(candidates, attributes)?.result.build[0].item.id;
}

function selectedWeightedId(candidates, weights) {
  return selectWeightedCustomPriorityCandidate(candidates, weights)?.result.build[0].item.id;
}

test('recoil priority minimizes exact recoilModifier even when rounded recoil displays match', () => {
  const candidates = [
    candidate('minus-20.4', { recoilModifier: -20.4, verticalRecoil: 80, horizontalRecoil: 160, price: 200 }),
    candidate('minus-20.0', { recoilModifier: -20, verticalRecoil: 80, horizontalRecoil: 160, price: 100 }),
  ];

  assert.equal(selectedId(candidates, ['recoil']), 'minus-20.4');
});

test('global shortlist uses rank tolerance before lower ranks, then price and build key', () => {
  const candidates = [
    candidate('A', { recoilModifier: -20, ergonomics: 50, price: 500 }),
    candidate('B', { recoilModifier: -18.5, ergonomics: 90, price: 300 }),
    candidate('boundary', { recoilModifier: -2, ergonomics: 0, price: 100 }),
  ];

  assert.equal(selectedId(candidates, ['recoil']), 'B');
  assert.equal(selectedId(candidates, ['recoil', 'ergonomics']), 'B');
  assert.deepEqual(getCustomPrioritySelectionDiagnostics(candidates, ['recoil', 'ergonomics']), [
    { rank: 1, attribute: 'recoil', beforeCount: 3, bestNormalizedContribution: 1, tolerance: 0.1, afterCount: 2 },
    { rank: 2, attribute: 'ergonomics', beforeCount: 2, bestNormalizedContribution: 1, tolerance: 0.1, afterCount: 1 },
  ]);
});

test('rank tolerance includes its floating-epsilon boundary and excludes a larger loss', () => {
  const candidates = [
    candidate('best', { ergonomics: 100, recoilModifier: 0 }),
    candidate('within-epsilon', {
      ergonomics: 90 - (CUSTOM_PRIORITY_FLOAT_EPSILON * 50), recoilModifier: -10,
    }),
    candidate('outside-epsilon', {
      ergonomics: 90 - (CUSTOM_PRIORITY_FLOAT_EPSILON * 200), recoilModifier: -20,
    }),
    candidate('minimum', { ergonomics: 0, recoilModifier: -30 }),
  ];

  assert.equal(selectedId(candidates, ['ergonomics', 'recoil']), 'within-epsilon');
});

test('later ranks remain normalized against the original full candidate pool', () => {
  const candidates = [
    candidate('A', { recoilModifier: -20, ergonomics: 50, price: 100 }),
    candidate('B', { recoilModifier: -18, ergonomics: 60, price: 500 }),
    candidate('rank-one-bound', { recoilModifier: 0, ergonomics: 1000, price: 1000 }),
  ];

  assert.equal(selectedId(candidates, ['recoil', 'ergonomics']), 'A');
  assert.equal(getCustomPrioritySelectionDiagnostics(candidates, ['recoil', 'ergonomics'])[1].afterCount, 2);
});

test('candidate order cannot affect selection and empty priorities use price then build key', () => {
  const candidates = [
    candidate('z-key', { ergonomics: 60, recoilModifier: -5, price: 100 }),
    candidate('a-key', { ergonomics: 60, recoilModifier: -5, price: 100 }),
    candidate('best-stats', { ergonomics: 100, recoilModifier: 0, price: 500 }),
  ];
  const permutations = [candidates, [...candidates].reverse(), [candidates[1], candidates[2], candidates[0]]];

  assert.deepEqual(permutations.map(pool => selectedId(pool, ['ergonomics'])), [
    'best-stats', 'best-stats', 'best-stats',
  ]);
  assert.deepEqual(permutations.map(pool => selectedId(pool, [])), ['a-key', 'a-key', 'a-key']);
});

test('a lower rank cannot recover a material Rank 1 recoil loss', () => {
  const candidates = [
    candidate('rank-one-winner', { recoilModifier: -30, ergonomics: 0 }),
    candidate('lower-rank-winner', { recoilModifier: -10, ergonomics: 100 }),
    candidate('normalization-bound', { recoilModifier: 0, ergonomics: 50 }),
  ];

  assert.equal(selectedId(candidates, ['recoil', 'ergonomics']), 'rank-one-winner');
});

test('one selected priority ignores other stats before price and build-key ties', () => {
  const higherErgo = candidate('z-higher-ergo', {
    ergonomics: 100, recoilModifier: 0, weight: 1, price: 200,
  });
  const closeErgo = candidate('a-close-ergo', {
    ergonomics: 91, recoilModifier: -999, weight: 99, price: 100,
  });
  const outsideBand = candidate('outside-band', { ergonomics: 0, price: 1 });
  const candidates = [higherErgo, closeErgo, outsideBand];

  assert.equal(getCustomPrioritySelectionDiagnostics(candidates, ['ergonomics'])[0].afterCount, 2);
  assert.equal(selectedId(candidates, ['ergonomics']), 'a-close-ergo');
  closeErgo.result.stats.price = 200;
  assert.equal(selectedId(candidates, ['ergonomics']), 'a-close-ergo');
});

test('swapping Recoil and Ergonomics rank selects different candidates', () => {
  const candidates = [
    candidate('recoil-leader', { recoilModifier: -30, ergonomics: 40, weight: 5 }),
    candidate('ergo-leader', { recoilModifier: -10, ergonomics: 90, weight: 3 }),
    candidate('normalization-bound', { recoilModifier: 0, ergonomics: 0, weight: 10 }),
  ];

  assert.equal(selectedId(candidates, ['recoil', 'ergonomics']), 'recoil-leader');
  assert.equal(selectedId(candidates, ['ergonomics', 'recoil']), 'ergo-leader');
});

test('legacy duplicate recoil axes normalize to one canonical rank', () => {
  const candidates = [
    candidate('recoil', { recoilModifier: -20, ergonomics: 20 }),
    candidate('ergo', { recoilModifier: 0, ergonomics: 80 }),
  ];
  const diagnostics = getCustomPrioritySelectionDiagnostics(candidates, [
    'verticalRecoil', 'horizontalRecoil', 'ergonomics',
  ]);

  assert.deepEqual(diagnostics.map(entry => entry.attribute), ['recoil', 'ergonomics']);
  assert.equal(selectedId(candidates, ['verticalRecoil', 'horizontalRecoil']), 'recoil');
});

test('empty priorities and invalid values remain deterministic', () => {
  const candidates = [
    candidate('z-key', { recoilModifier: Number.NaN, ergonomics: Number.NaN, price: 100 }),
    candidate('a-key', { recoilModifier: Number.NaN, ergonomics: Number.NaN, price: 100 }),
  ];

  assert.equal(selectedId(candidates, []), 'a-key');
  assert.equal(selectedId(candidates, ['recoil', 'ergonomics']), 'a-key');
  assert.equal(
    getCustomPrioritySelectionDiagnostics(candidates, ['recoil', 'ergonomics'])
      .every(entry => Number.isFinite(entry.bestNormalizedContribution)),
    true,
  );
  assert.equal(CUSTOM_PRIORITY_FLOAT_EPSILON, 1e-9);
});

test('weighted selection uses full-pool normalization and changes winner for 80/10/10 versus 40/30/30', () => {
  const candidates = [
    candidate('recoil-leader', { recoilModifier: -30, ergonomics: 20, weight: 5 }),
    candidate('balanced-leader', { recoilModifier: -10, ergonomics: 100, weight: 1 }),
  ];

  assert.equal(selectedWeightedId(candidates, { recoil: 80, ergonomics: 10, weight: 10 }), 'recoil-leader');
  assert.equal(selectedWeightedId(candidates, { recoil: 40, ergonomics: 30, weight: 30 }), 'balanced-leader');
  assert.deepEqual(
    getWeightedCustomPrioritySelectionDiagnostics(candidates, { recoil: 80, ergonomics: 10, weight: 10 }),
    {
      mode: 'weighted',
      weights: { recoil: 80, ergonomics: 10, weight: 10 },
      vector: { recoil: 1, ergonomics: 0, weight: 0 },
      weightedScore: 0.8,
    },
  );
});

test('weighted zeroes ignore an attribute and weighted ties use price then build key independent of order', () => {
  const candidates = [
    candidate('z-expensive', { recoilModifier: -30, ergonomics: 20, weight: 10, price: 200 }),
    candidate('a-cheap', { recoilModifier: -30, ergonomics: 20, weight: 1, price: 100 }),
    candidate('a-key', { recoilModifier: -30, ergonomics: 20, weight: 5, price: 100 }),
  ];
  const weights = { recoil: 100, ergonomics: 0, weight: 0 };
  const permutations = [candidates, [...candidates].reverse(), [candidates[1], candidates[2], candidates[0]]];

  assert.deepEqual(permutations.map(pool => selectedWeightedId(pool, weights)), [
    'a-cheap', 'a-cheap', 'a-cheap',
  ]);
  assert.equal(
    getWeightedCustomPrioritySelectionDiagnostics(candidates, weights).weightedScore,
    1,
  );
  const equalPriceCandidates = [
    candidate('z-key', { recoilModifier: -30, ergonomics: 20, weight: 10, price: 100 }),
    candidate('a-key', { recoilModifier: -30, ergonomics: 20, weight: 1, price: 100 }),
  ];
  assert.equal(selectedWeightedId(equalPriceCandidates, weights), 'a-key');
});

test('80/20/0 ignores changed weight values without changing weighted score or selection', () => {
  const heavyWinner = candidate('winner', {
    recoilModifier: -30, ergonomics: 100, weight: 100, price: 200,
  });
  const lightLoser = candidate('loser', {
    recoilModifier: -10, ergonomics: 0, weight: 1, price: 100,
  });
  const weights = { recoil: 80, ergonomics: 20, weight: 0 };
  const before = getWeightedCustomPrioritySelectionDiagnostics([heavyWinner, lightLoser], weights);

  heavyWinner.result.stats.weight = 1;
  lightLoser.result.stats.weight = 100;
  const after = getWeightedCustomPrioritySelectionDiagnostics([heavyWinner, lightLoser], weights);

  assert.equal(selectedWeightedId([heavyWinner, lightLoser], weights), 'winner');
  assert.equal(before.weightedScore, 1);
  assert.equal(after.weightedScore, 1);
});

test('100/0/0 is pure normalized recoil optimization across the complete three-candidate pool', () => {
  const candidates = [
    candidate('best-recoil', { recoilModifier: -30, ergonomics: 0, weight: 10, price: 500 }),
    candidate('middle-recoil', { recoilModifier: -20, ergonomics: 100, weight: 1, price: 100 }),
    candidate('worst-recoil', { recoilModifier: -10, ergonomics: 50, weight: 5, price: 1 }),
  ];
  const bounds = getCustomPriorityBounds(candidates.map(entry => entry.result), ['recoil']);

  assert.deepEqual(candidates.map(entry => getCustomPriorityVectorFromBounds(entry.result, bounds)), [
    [1], [0.5], [0],
  ]);
  assert.equal(selectedWeightedId(candidates, { recoil: 100, ergonomics: 0, weight: 0 }), 'best-recoil');
  assert.equal(
    getWeightedCustomPrioritySelectionDiagnostics(candidates, { recoil: 100, ergonomics: 0, weight: 0 }).weightedScore,
    1,
  );
});

test('weighted score differences within FLOAT_EPSILON use the existing lower-price tie-break', () => {
  const candidates = [
    candidate('slightly-better', { recoilModifier: -30, price: 200 }),
    candidate('within-epsilon-cheaper', {
      recoilModifier: -30 + (20 * (CUSTOM_PRIORITY_FLOAT_EPSILON / 2)), price: 100,
    }),
    candidate('normalization-bound', { recoilModifier: -10, price: 1 }),
  ];

  assert.equal(
    selectedWeightedId(candidates, { recoil: 100, ergonomics: 0, weight: 0 }),
    'within-epsilon-cheaper',
  );
});

test('weighted global-max epsilon shortlist is stable across chained near-ties and permutations', () => {
  const anchors = [
    candidate('recoil-anchor', { recoilModifier: -30, ergonomics: 0, price: 100 }),
    candidate('ergo-anchor', { recoilModifier: -10, ergonomics: 100, price: 100 }),
  ];
  const chainedCandidates = [
    candidate('A', { recoilModifier: -20, ergonomics: 50, price: 1 }),
    candidate('B', { recoilModifier: -20, ergonomics: 50.00000015, price: 2 }),
    candidate('C', { recoilModifier: -20, ergonomics: 50.0000003, price: 3 }),
  ];
  const weights = { recoil: 50, ergonomics: 50, weight: 0 };
  const permutations = [
    [...anchors, ...chainedCandidates],
    [...anchors, ...chainedCandidates].reverse(),
    [anchors[1], chainedCandidates[0], anchors[0], chainedCandidates[2], chainedCandidates[1]],
  ];

  assert.deepEqual(permutations.map(pool => selectedWeightedId(pool, weights)), ['B', 'B', 'B']);
});
