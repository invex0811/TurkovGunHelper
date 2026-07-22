import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWeaponAssemblyTree,
  rebindBuildPartsToCatalog,
} from '../../src/domain/weaponAssembly.js';

function createItem(id, slots = []) {
  return { id, properties: { slots } };
}

function createSlot(name, nameId, itemIds) {
  return {
    name,
    nameId,
    filters: { allowedItems: itemIds.map(id => ({ id })) },
  };
}

test('rebindBuildPartsToCatalog retains nested attachments across localized slot names', () => {
  const oldOptic = createItem('optic');
  const oldMount = createItem('mount', [createSlot('Optic', 'mod_scope', ['optic'])]);
  const oldWeapon = createItem('weapon', [createSlot('Mount', 'mod_mount', ['mount'])]);
  const build = [
    { slotName: 'Mount', item: oldMount },
    { slotName: 'Optic', item: oldOptic },
  ];

  const localizedOptic = createItem('optic');
  const localizedMount = createItem('mount', [createSlot('Прицел', 'mod_scope', ['optic'])]);
  const localizedWeapon = createItem('weapon', [createSlot('Крепление', 'mod_mount', ['mount'])]);
  const rebound = rebindBuildPartsToCatalog(
    oldWeapon,
    build,
    localizedWeapon,
    { mount: localizedMount, optic: localizedOptic },
  );
  const reboundTree = buildWeaponAssemblyTree(localizedWeapon, rebound);

  assert.deepEqual(rebound.map(part => part.slotName), ['Крепление', 'Прицел']);
  assert.equal(rebound[1].parentItemId, 'mount');
  assert.equal(reboundTree.unattachedParts.length, 0);
  assert.equal(reboundTree.children[0].children[0].item.id, 'optic');
});
