import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTacticalDeviceType,
  getTacticalDeviceOptions,
  isTacticalDeviceReachable,
  TACTICAL_DEVICE_TYPES,
} from '../../src/features/configurator/tacticalDeviceOptions.js';

const allMods = {
  combined: { id: 'combined', name: 'Zeta TBL', categories: [{ name: 'Comb. tact. device' }] },
  flashlight: { id: 'flashlight', name: 'Alpha flashlight', categories: [{ name: 'Flashlight' }] },
  unrelated: { id: 'unrelated', name: 'Mount', categories: [{ name: 'Mount' }] },
};

test('returns category-specific tactical device options', () => {
  assert.deepEqual(
    getTacticalDeviceOptions(allMods, TACTICAL_DEVICE_TYPES.FLASHLIGHT).map(item => item.id),
    ['flashlight'],
  );
  assert.deepEqual(
    getTacticalDeviceOptions(allMods, TACTICAL_DEVICE_TYPES.TBL).map(item => item.id),
    ['combined'],
  );
});

test('recognizes tactical devices behind compatible mount chains', () => {
  const flashlight = { id: 'flashlight', properties: { slots: [] } };
  const mount = {
    id: 'mount',
    properties: { slots: [{ filters: { allowedItems: [{ id: 'flashlight' }] } }] },
  };
  const weapon = {
    id: 'weapon',
    properties: { slots: [{ filters: { allowedItems: [{ id: 'mount' }] } }] },
  };

  assert.equal(isTacticalDeviceReachable(weapon, { mount, flashlight }, 'flashlight'), true);
  assert.equal(isTacticalDeviceReachable(weapon, { mount, flashlight }, 'missing'), false);
});

test('returns no options for unavailable catalogs or unsupported device types', () => {
  assert.deepEqual(getTacticalDeviceOptions(null, TACTICAL_DEVICE_TYPES.FLASHLIGHT), []);
  assert.deepEqual(getTacticalDeviceOptions(allMods, 'unknown'), []);
});

test('classifies a combined tactical device as TBL before the generic flashlight category', () => {
  const combinedFlashlight = {
    id: 'combined-flashlight',
    categories: [{ name: 'Comb. tact. device' }, { name: 'Flashlight' }],
  };

  assert.equal(getTacticalDeviceType(combinedFlashlight), TACTICAL_DEVICE_TYPES.TBL);
  assert.equal(getTacticalDeviceType(allMods.flashlight), TACTICAL_DEVICE_TYPES.FLASHLIGHT);
  assert.equal(getTacticalDeviceType(allMods.unrelated), null);
});
