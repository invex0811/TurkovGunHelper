import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPrimaryManualModuleType,
  getUniqueItemIds,
  PRIMARY_MANUAL_MODULE_TYPES,
  replacePrimaryManualModuleId,
} from '../../src/features/configurator/primaryManualModules.js';

test('replaces only the previously synchronized module and preserves other manual requirements', () => {
  assert.deepEqual(
    replacePrimaryManualModuleId(
      ['primary-scope', 'secondary-scope', 'flashlight', 'mount'],
      'primary-scope',
      'next-primary-scope',
    ),
    ['secondary-scope', 'flashlight', 'mount', 'next-primary-scope'],
  );
});

test('removing a primary manual selection does not remove unrelated requirements', () => {
  assert.deepEqual(
    replacePrimaryManualModuleId(['manual-tbl', 'manual-flashlight'], 'manual-tbl', null),
    ['manual-flashlight'],
  );
});

test('deduplicates item requirements while preserving insertion order', () => {
  assert.deepEqual(getUniqueItemIds(['scope', 'scope', null, 'tbl', 'scope']), ['scope', 'tbl']);
});

test('uses structured categories to identify primary modules', () => {
  assert.equal(
    getPrimaryManualModuleType({ id: 'scope', categories: [{ name: 'Sights' }] }),
    PRIMARY_MANUAL_MODULE_TYPES.SCOPE,
  );
  assert.equal(
    getPrimaryManualModuleType({ id: 'tbl', categories: [{ name: 'Comb. tact. device' }] }),
    PRIMARY_MANUAL_MODULE_TYPES.TBL,
  );
  assert.equal(
    getPrimaryManualModuleType({ id: 'flashlight', categories: [{ name: 'Flashlight' }] }),
    PRIMARY_MANUAL_MODULE_TYPES.FLASHLIGHT,
  );
  assert.equal(
    getPrimaryManualModuleType({ id: 'mount', categories: [{ name: 'Mount' }] }),
    null,
  );
});
