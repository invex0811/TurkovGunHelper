import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyReplacement,
  formatPartName,
  getAlternativeDisplayName,
  getReplaceTarget,
} from '../../src/features/configurator/services/replacementService.js';

function item(id, slots = [], categories = []) {
  return {
    id,
    categories,
    properties: { slots },
  };
}

function node(value, { parent = null, slotName = '', sourceSlot = null, children = [] } = {}) {
  const result = {
    item: value,
    parent,
    slotName,
    sourceSlot,
    children,
  };
  children.forEach(child => {
    child.parent = result;
  });
  return result;
}

test('formatPartName keeps handguard dimensions in inches while converting other parts to millimeters', () => {
  const handguard = item('handguard', [], ['Handguard']);
  const barrel = item('barrel', [], ['Barrel']);

  assert.equal(formatPartName('SMR MK16 9.5"', handguard), 'SMR MK16 9.5"');
  assert.equal(formatPartName('M590A1 20 inch', barrel), 'M590A1 508 mm');
});

test('getAlternativeDisplayName keeps handguard dimensions in inches', () => {
  const handguard = {
    ...item('handguard', [], ['Handguard']),
    shortName: 'SMR MK16 13.5"',
  };

  assert.equal(getAlternativeDisplayName(handguard), 'SMR MK16 13.5"');
});

test('applyReplacement preserves compatible descendants and removes incompatible subtrees', () => {
  const compatible = item('compatible-child');
  const incompatible = item('incompatible-child');
  const nested = item('nested-child');
  const oldParent = item('old-parent');
  const replacement = item('replacement', [{
    name: 'compatible-slot',
    filters: { allowedItems: [{ id: compatible.id }] },
  }]);

  const targetNode = node(oldParent, {
    children: [
      node(compatible, { slotName: 'compatible-slot' }),
      node(incompatible, {
        slotName: 'removed-slot',
        children: [node(nested, { slotName: 'nested-slot' })],
      }),
    ],
  });
  const build = [
    { slotName: 'parent-slot', item: oldParent },
    { slotName: 'compatible-slot', item: compatible },
    { slotName: 'removed-slot', item: incompatible },
    { slotName: 'nested-slot', item: nested },
  ];

  const result = applyReplacement(build, targetNode, replacement);

  assert.deepEqual(result.map(part => part.item.id), [
    replacement.id,
    compatible.id,
  ]);
  assert.equal(result[0].slotName, 'parent-slot');
});

test('applyReplacement replaces a sight assembly and appends packaged parts in order', () => {
  const weapon = node(item('weapon'));
  const mount = node(item('old-mount', [], ['Mount']), { parent: weapon });
  const sight = node(item('old-sight', [], ['Sights']), { parent: mount });
  weapon.children = [mount];
  mount.children = [sight];

  const newMount = item('new-mount');
  const adapter = item('adapter');
  const newSight = item('new-sight');
  newMount.attachedParts = [
    { slotName: 'adapter-slot', item: adapter },
    { slotName: 'sight-slot', item: newSight },
  ];

  const result = applyReplacement([
    { slotName: 'mount-slot', item: mount.item },
    { slotName: 'sight-slot', item: sight.item },
  ], sight, newMount, 'SIGHT_ASSEMBLY');

  assert.equal(getReplaceTarget(sight, 'SIGHT_ASSEMBLY'), mount);
  assert.deepEqual(result.map(part => [part.slotName, part.item.id]), [
    ['mount-slot', 'new-mount'],
    ['adapter-slot', 'adapter'],
    ['sight-slot', 'new-sight'],
  ]);
});
