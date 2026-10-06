import test from 'node:test';
import assert from 'node:assert/strict';
import { getReachableModuleIds } from '../../src/features/configurator/moduleReachability.js';

const slotFor = (...ids) => ({ filters: { allowedItems: ids.map(id => ({ id })) } });

test('reachable modules include direct slots and modules behind mounts', () => {
  const allMods = {
    mount: { id: 'mount', properties: { slots: [slotFor('scope', 'missing')] } },
    scope: { id: 'scope', properties: { slots: [] } },
    muzzle: { id: 'muzzle' },
    foreign: { id: 'foreign' },
  };
  const weapon = { id: 'weapon', properties: { slots: [slotFor('mount', 'muzzle')] } };

  assert.deepEqual([...getReachableModuleIds(weapon, allMods)].sort(), ['mount', 'muzzle', 'scope']);
});

test('reachable modules survive slot cycles and missing catalogs', () => {
  const allMods = {
    left: { id: 'left', properties: { slots: [slotFor('right')] } },
    right: { id: 'right', properties: { slots: [slotFor('left')] } },
  };
  const weapon = { id: 'weapon', properties: { slots: [slotFor('left')] } };

  assert.deepEqual([...getReachableModuleIds(weapon, allMods)].sort(), ['left', 'right']);
  assert.equal(getReachableModuleIds(weapon, null).size, 0);
  assert.equal(getReachableModuleIds(null, allMods).size, 0);
});
