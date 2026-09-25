import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSlotGroupKind,
  groupBuildModuleDisplayItems,
} from '../../src/features/configurator/partGroups.js';
import { buildWeaponAssemblyTree } from '../../src/domain/weaponAssembly.js';

function createSlot(name, nameId, allowedIds, required = false) {
  return { name, nameId, required, filters: { allowedItems: allowedIds.map(id => ({ id })) } };
}

function createItem(id, slots = [], category = 'Weapon mod') {
  return {
    id,
    name: id,
    shortName: id,
    categories: [{ name: category }],
    conflictingItems: [],
    properties: { slots },
  };
}

const t = key => key;

// Localized (Russian) slot names: grouping must rely on the stable nameId.
const muzzle = createItem('muzzle');
const gasBlock = createItem('gas-block');
const barrel = createItem('barrel', [
  createSlot('Дульное устройство', 'mod_muzzle', ['muzzle']),
  createSlot('Газовый блок', 'mod_gas_block', ['gas-block']),
]);
const scope = createItem('scope', [], 'Sights');
const scopeMount = createItem('scope-mount', [createSlot('Прицел', 'mod_scope', ['scope'])], 'Mount');
const foregrip = createItem('foregrip');
const lowerHandguard = createItem('lower-handguard');
const handguard = createItem('handguard', [
  createSlot('Передняя рукоятка', 'mod_foregrip', ['foregrip']),
  createSlot('Крепление', 'mod_mount_000', ['scope-mount']),
  createSlot('Цевьё', 'mod_handguard', ['lower-handguard']),
]);
const receiver = createItem('receiver', [
  createSlot('Ствол', 'mod_barrel', ['barrel'], true),
  createSlot('Цевьё', 'mod_handguard', ['handguard'], true),
]);
const stock = createItem('stock');
const bufferTube = createItem('buffer-tube', [createSlot('Приклад', 'mod_stock_000', ['stock'], true)], 'Mount');
const weaponSlots = [
  createSlot('Ствольная коробка', 'mod_reciever', ['receiver'], true),
  createSlot('Приклад', 'mod_stock', ['buffer-tube'], true),
  createSlot('Рукоятка взведения', 'mod_charge', ['charge'], true),
];
const weapon = createItem('weapon', weaponSlots, 'Weapon');
const buildParts = [
  { slotName: 'Ствольная коробка', item: receiver },
  { slotName: 'Ствол', item: barrel },
  { slotName: 'Дульное устройство', item: muzzle },
  { slotName: 'Газовый блок', item: gasBlock },
  { slotName: 'Цевьё', item: handguard },
  { slotName: 'Передняя рукоятка', item: foregrip },
  { slotName: 'Крепление', item: scopeMount },
  { slotName: 'Прицел', item: scope },
  { slotName: 'Цевьё', item: lowerHandguard },
  { slotName: 'Приклад', item: bufferTube },
  { slotName: 'Приклад', item: stock },
];

function getDisplayItems(tree) {
  const items = [];
  (function visit(node) {
    node.children.forEach(child => {
      items.push({
        item: child.item,
        slotName: child.slotName,
        slot: child.sourceSlot,
        assemblyNode: child,
        isCritical: child.sourceSlot.required === true,
        isEmpty: false,
      });
      visit(child);
    });
  })(tree);
  items.push({
    item: null,
    slotName: 'Рукоятка взведения',
    slot: weaponSlots[2],
    parentNode: tree,
    isCritical: true,
    isEmpty: true,
  });
  return items;
}

test('slot kinds come from the stable API id and ignore numbering', () => {
  assert.equal(getSlotGroupKind('Дульное устройство', 'mod_muzzle_000').kind, 'muzzle');
  assert.equal(getSlotGroupKind('Tactical', 'mod_tactical002').kind, 'tacticalDevice');
  assert.equal(getSlotGroupKind('Stock', 'mod_stock_axis').kind, 'stock');
  assert.equal(getSlotGroupKind('Ch. Handle', '').kind, 'chargingHandle');
  assert.deepEqual(getSlotGroupKind('Кожух', 'mod_nvg'), { kind: 'slot:кожух', fallbackName: 'Кожух' });
});

test('modules are grouped by the weapon assembly they belong to', () => {
  const tree = buildWeaponAssemblyTree(weapon, buildParts);
  const groups = groupBuildModuleDisplayItems(getDisplayItems(tree), tree, t);
  const summary = groups.map(group => [
    group.rootSlotName,
    group.parts.map(part => `${part.item?.id ?? 'empty'}${part.slotLabel ? `(${part.slotLabel})` : ''}`),
  ]);

  assert.deepEqual(summary, [
    ['config.slotGroup.chargingHandle', ['empty']],
    ['config.slotGroup.receiver', ['receiver']],
    ['config.slotGroup.barrel', ['barrel', 'muzzle(config.slotGroup.muzzle)', 'gas-block(config.slotGroup.gasBlock)']],
    ['config.slotGroup.handguard', ['handguard', 'foregrip(config.slotGroup.foregrip)', 'lower-handguard']],
    ['config.slotGroup.scope', ['scope-mount(config.slotGroup.mount)', 'scope']],
    ['config.slotGroup.stock', ['buffer-tube(config.slotGroup.mount)', 'stock']],
  ]);
});
