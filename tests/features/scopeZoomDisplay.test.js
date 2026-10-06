import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatScopeZoomBadge,
  getAdditionalScopeZoomLevels,
  getCompactScopeZoomLevels,
  getPrimaryScopeZoomLevels,
} from '../../src/features/configurator/scopeZoomDisplay.js';

test('scope zoom display keeps only primary chips in its compact state', () => {
  const zooms = [1, 1.5, 2.5, 4, 6, 8, 24];

  assert.deepEqual(getPrimaryScopeZoomLevels(zooms), [1, 4, 6, 8]);
  assert.deepEqual(getAdditionalScopeZoomLevels(zooms), [1.5, 2.5, 24]);
  assert.deepEqual(getCompactScopeZoomLevels(zooms, null, false), [1, 4, 6, 8]);
});

test('a selected additional zoom remains visible after the chip list is collapsed', () => {
  const zooms = [1, 1.5, 2.5, 4, 6, 8, 24];

  assert.deepEqual(getCompactScopeZoomLevels(zooms, 2.5, false), [1, 4, 6, 8, 2.5]);
  assert.deepEqual(getCompactScopeZoomLevels(zooms, 2.5, true), [1, 4, 6, 8]);
});

test('scope zoom badge lists the discrete levels the zoom filter matches', () => {
  const sight = (categories, zoomLevels) => ({
    categories: categories.map(name => ({ name })),
    properties: { zoomLevels },
  });

  assert.equal(formatScopeZoomBadge(sight(['Sights', 'Scope'], [[4, 4]])), '4x');
  assert.equal(formatScopeZoomBadge(sight(['Sights', 'Assault scope'], [[6, 1]])), '1/6x');
  assert.equal(formatScopeZoomBadge(sight(['Sights', 'Reflex sight'], undefined)), '1x');
  assert.equal(formatScopeZoomBadge(sight(['Sights', 'Scope'], [])), null);
});
