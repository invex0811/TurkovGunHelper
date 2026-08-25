import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareCustomPriorityScores,
  getCustomPriorityScore,
  normalizeCustomCharacteristicMode,
  normalizePriorityAttributes,
  normalizePriorityMaxPrice,
  togglePriorityAttribute,
} from '../../src/domain/customPriorityAttributes.js';

function result({ ergonomics, verticalRecoil, horizontalRecoil, weight }) {
  return {
    stats: { ergonomics, recoilVertical: verticalRecoil, recoilHorizontal: horizontalRecoil, weight },
  };
}

test('priority attributes are sanitized, deduplicated, capped, and removable', () => {
  assert.deepEqual(normalizePriorityAttributes(), []);
  assert.deepEqual(normalizePriorityAttributes([
    'verticalRecoil',
    'verticalRecoil',
    'price',
    'ergonomics',
    'weight',
    'horizontalRecoil',
  ]), ['verticalRecoil', 'ergonomics', 'weight']);
  assert.deepEqual(togglePriorityAttribute(['verticalRecoil'], 'ergonomics'), [
    'verticalRecoil',
    'ergonomics',
  ]);
  assert.deepEqual(togglePriorityAttribute([
    'verticalRecoil',
    'ergonomics',
    'weight',
  ], 'horizontalRecoil'), ['verticalRecoil', 'ergonomics', 'weight']);
  assert.deepEqual(togglePriorityAttribute(['verticalRecoil', 'weight'], 'weight'), ['verticalRecoil']);
});

test('characteristic mode and priority budget safely normalize legacy values', () => {
  assert.equal(normalizeCustomCharacteristicMode(), 'constraints');
  assert.equal(normalizeCustomCharacteristicMode('invalid'), 'constraints');
  assert.equal(normalizeCustomCharacteristicMode('priorities'), 'priorities');
  assert.equal(normalizePriorityMaxPrice(), 0);
  assert.equal(normalizePriorityMaxPrice(''), 0);
  assert.equal(normalizePriorityMaxPrice(-100), 0);
  assert.equal(normalizePriorityMaxPrice(Number.POSITIVE_INFINITY), 0);
  assert.equal(normalizePriorityMaxPrice('250000'), 250000);
});

test('priority scoring normalizes minimize and maximize attributes independently', () => {
  const lightLowRecoil = result({ ergonomics: 40, verticalRecoil: 60, horizontalRecoil: 120, weight: 3 });
  const ergonomicHeavy = result({ ergonomics: 80, verticalRecoil: 100, horizontalRecoil: 200, weight: 5 });
  const candidates = [lightLowRecoil, ergonomicHeavy];

  assert.equal(getCustomPriorityScore(lightLowRecoil, candidates, ['verticalRecoil']), 1);
  assert.equal(getCustomPriorityScore(ergonomicHeavy, candidates, ['verticalRecoil']), 0);
  assert.equal(getCustomPriorityScore(ergonomicHeavy, candidates, ['ergonomics']), 1);
  assert.equal(getCustomPriorityScore(lightLowRecoil, candidates, ['weight']), 1);
});

test('priority scoring is equal-weighted, selection-order independent, and ignores unselected attributes', () => {
  const recoilBuild = result({ ergonomics: 40, verticalRecoil: 60, horizontalRecoil: 120, weight: 6 });
  const ergonomicBuild = result({ ergonomics: 80, verticalRecoil: 100, horizontalRecoil: 200, weight: 3 });
  const candidates = [recoilBuild, ergonomicBuild];

  const forward = getCustomPriorityScore(recoilBuild, candidates, ['verticalRecoil', 'ergonomics']);
  const reversed = getCustomPriorityScore(recoilBuild, candidates, ['ergonomics', 'verticalRecoil']);
  assert.equal(forward, 0.5);
  assert.equal(reversed, 0.5);
  assert.equal(getCustomPriorityScore(recoilBuild, candidates, [
    'verticalRecoil',
    'ergonomics',
    'weight',
  ]), 1 / 3);
  assert.equal(getCustomPriorityScore(recoilBuild, candidates, ['verticalRecoil']), 1);

  const sameSelectedStatsLight = result({
    ergonomics: 70,
    verticalRecoil: 80,
    horizontalRecoil: 110,
    weight: 3,
  });
  const sameSelectedStatsHeavy = result({
    ergonomics: 70,
    verticalRecoil: 80,
    horizontalRecoil: 260,
    weight: 8,
  });
  const sameSelectedStatsCandidates = [sameSelectedStatsLight, sameSelectedStatsHeavy];
  assert.equal(
    getCustomPriorityScore(
      sameSelectedStatsLight,
      sameSelectedStatsCandidates,
      ['verticalRecoil', 'ergonomics'],
    ),
    getCustomPriorityScore(
      sameSelectedStatsHeavy,
      sameSelectedStatsCandidates,
      ['verticalRecoil', 'ergonomics'],
    ),
  );
});

test('priority scoring stays finite for equal ranges and a one-candidate pool', () => {
  const candidate = result({ ergonomics: 60, verticalRecoil: 80, horizontalRecoil: 150, weight: 4 });
  const equalValueCandidate = result({ ergonomics: 60, verticalRecoil: 80, horizontalRecoil: 150, weight: 4 });

  const equalRangeScore = getCustomPriorityScore(candidate, [candidate, equalValueCandidate], [
    'verticalRecoil',
    'horizontalRecoil',
    'ergonomics',
  ]);
  assert.equal(equalRangeScore, 1);
  assert.equal(getCustomPriorityScore(candidate, [candidate], ['weight']), 1);
  assert.equal(Number.isFinite(equalRangeScore), true);
});

test('priority score comparison treats epsilon-sized floating differences as ties', () => {
  assert.equal(compareCustomPriorityScores(0.5, 0.5 + 1e-10), 0);
  assert.equal(compareCustomPriorityScores(0.5 + 1e-6, 0.5), 1);
});
