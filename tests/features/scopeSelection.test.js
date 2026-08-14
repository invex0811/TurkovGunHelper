import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getScopeSightMode,
  normalizeScopeSelection,
  SCOPE_MODES,
} from '../../src/features/configurator/scopeSelection.js';

test('scope selection migrates legacy no-sight, automatic, and manual settings', () => {
  const isKnownScope = itemId => itemId === 'scope-id';

  assert.deepEqual(normalizeScopeSelection({ sightMode: 'none' }, isKnownScope), {
    mode: SCOPE_MODES.NONE,
    itemId: null,
    zoom: null,
  });
  assert.deepEqual(normalizeScopeSelection({ requireSight: true }, isKnownScope), {
    mode: SCOPE_MODES.AUTO,
    itemId: null,
    zoom: null,
  });
  assert.deepEqual(normalizeScopeSelection({ scopeItemId: 'scope-id', sightMode: 'any' }, isKnownScope), {
    mode: SCOPE_MODES.MANUAL,
    itemId: 'scope-id',
    zoom: null,
  });
});

test('only automatic scope selection turns a zoom chip into an optimizer constraint', () => {
  assert.equal(getScopeSightMode(SCOPE_MODES.NONE, 4), 'none');
  assert.equal(getScopeSightMode(SCOPE_MODES.AUTO, null), 'any');
  assert.equal(getScopeSightMode(SCOPE_MODES.AUTO, 4), 4);
  assert.equal(getScopeSightMode(SCOPE_MODES.MANUAL, 4), 'any');
});
