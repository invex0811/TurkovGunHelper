import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCustomPrioritySelectionDiagnostics,
  selectCustomPriorityCandidate,
} from '../../src/domain/calculator/prioritySelection.js';
import { CUSTOM_PRIORITY_FLOAT_EPSILON } from '../../src/domain/customPriorityAttributes.js';

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
