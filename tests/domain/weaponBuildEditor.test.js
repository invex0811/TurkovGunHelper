import test from 'node:test';
import assert from 'node:assert/strict';

import { recalculateBuildStats } from '../../src/domain/calculator.js';
import {
  findBuildSlotContext,
  getCompatibleItemsForSlot,
  planBuildSlotChange,
} from '../../src/domain/weaponBuildEditor.js';
import { buildWeaponAssemblyTree, getBuildSlotId } from '../../src/domain/weaponAssembly.js';
import { buildWeaponDiagramGraph } from '../../src/ui/weaponBuildDiagram.js';

function createSlot(name, nameId, allowedIds, required = false) {
  return {
    name,
    nameId,
    required,
    filters: { allowedItems: allowedIds.map(id => ({ id })) },
  };
}

function createItem(id, options = {}) {
  return {
    id,
    name: options.name || id,
    shortName: options.shortName || id,
    weight: options.weight || 0,
    ergonomicsModifier: options.ergonomicsModifier || 0,
    recoilModifier: options.recoilModifier || 0,
    conflictingItems: (options.conflicts || []).map(conflictId => ({ id: conflictId })),
    price: { value: options.price || 1000 },
    properties: { slots: options.slots || [] },
    categories: [{ name: options.category || 'Weapon mod' }],
  };
}

function createWeapon(slots) {
  return {
    ...createItem('weapon', { slots, price: 10000, weight: 2 }),
    properties: {
      slots,
      ergonomics: 50,
      recoilVertical: 100,
      recoilHorizontal: 200,
    },
  };
}

function contextualPart(parent, slot, slotIndex, item) {
  return {
    slotName: slot.name,
    slotId: getBuildSlotId(slot, slotIndex),
    parentItemId: parent.id,
    item,
  };
}

test('keeps repeated API slot definitions as separate stable instances', () => {
  const slots = [
    createSlot('Крепление', 'mod_mount', ['rail-a', 'rail-b']),
    createSlot('Крепление', 'mod_mount', ['rail-a', 'rail-b']),
  ];
  const weapon = createWeapon(slots);
  const railA = createItem('rail-a');
  const railB = createItem('rail-b');
  const tree = buildWeaponAssemblyTree(weapon, [
    contextualPart(weapon, slots[0], 0, railA),
    contextualPart(weapon, slots[1], 1, railB),
  ]);

  assert.equal(tree.slots.length, 2);
  assert.notEqual(tree.slots[0].id, tree.slots[1].id);
  assert.equal(tree.slots[0].installedNode.item.id, 'rail-a');
  assert.equal(tree.slots[1].installedNode.item.id, 'rail-b');
});

test('free slot nodes are optional and each installable slot remains distinct', () => {
  const slots = [
    createSlot('Крепление', 'mod_mount', ['rail-a']),
    createSlot('Крепление', 'mod_mount', ['rail-a']),
  ];
  const weapon = createWeapon(slots);
  const allMods = { 'rail-a': createItem('rail-a') };

  const hidden = buildWeaponDiagramGraph(weapon, [], { allMods, includeFreeSlots: false });
  const visible = buildWeaponDiagramGraph(weapon, [], { allMods, includeFreeSlots: true });

  assert.equal(hidden.nodes.filter(node => node.nodeType === 'slot').length, 0);
  assert.equal(visible.nodes.filter(node => node.nodeType === 'slot').length, 2);
  assert.equal(new Set(visible.nodes.filter(node => node.nodeType === 'slot').map(node => node.slotInstanceId)).size, 2);
});

test('compatibility uses allowed items and bidirectional conflicts', () => {
  const slot = createSlot('Mount', 'mod_mount', ['allowed', 'conflicting']);
  const neighborSlot = createSlot('Grip', 'mod_grip', ['neighbor']);
  const weapon = createWeapon([slot, neighborSlot]);
  const neighbor = createItem('neighbor', { conflicts: ['conflicting'] });
  const allMods = {
    allowed: createItem('allowed'),
    conflicting: createItem('conflicting'),
    neighbor,
    unrelated: createItem('unrelated'),
  };
  const buildParts = [contextualPart(weapon, neighborSlot, 1, neighbor)];
  const slotContext = buildWeaponAssemblyTree(weapon, buildParts).slots[0];
  const compatible = getCompatibleItemsForSlot({ weapon, buildParts, allMods, slotContext });

  assert.deepEqual(compatible.map(item => item.id), ['allowed']);
});

test('installs and replaces the selected slot without changing its neighbor', () => {
  const slots = [
    createSlot('Mount', 'mod_mount', ['rail-a', 'rail-b', 'rail-c']),
    createSlot('Mount', 'mod_mount', ['rail-a', 'rail-b', 'rail-c']),
  ];
  const weapon = createWeapon(slots);
  const railA = createItem('rail-a');
  const railB = createItem('rail-b');
  const railC = createItem('rail-c');
  const allMods = { 'rail-a': railA, 'rail-b': railB, 'rail-c': railC };
  const initialTree = buildWeaponAssemblyTree(weapon, []);
  const installPlan = planBuildSlotChange({
    weapon,
    buildParts: [],
    allMods,
    slotInstanceId: initialTree.slots[1].id,
    nextItem: railA,
  });

  assert.equal(installPlan.errors.length, 0);
  assert.equal(installPlan.buildParts[0].slotId, 'mod_mount:1');

  const withNeighbor = [
    contextualPart(weapon, slots[0], 0, railB),
    ...installPlan.buildParts,
  ];
  const secondSlotId = buildWeaponAssemblyTree(weapon, withNeighbor).slots[1].id;
  const replacePlan = planBuildSlotChange({
    weapon,
    buildParts: withNeighbor,
    allMods,
    slotInstanceId: secondSlotId,
    nextItem: railC,
  });

  assert.equal(replacePlan.errors.length, 0);
  assert.deepEqual(
    replacePlan.buildParts.map(part => [part.slotId, part.item.id]),
    [['mod_mount:0', 'rail-b'], ['mod_mount:1', 'rail-c']],
  );
});

test('installation exposes child slots and recalculated stats and price', () => {
  const child = createItem('laser', { ergonomicsModifier: 2, price: 3000 });
  const mount = createItem('mount', {
    ergonomicsModifier: -1,
    weight: 0.2,
    price: 2000,
    slots: [createSlot('Tactical', 'mod_tactical', ['laser'])],
  });
  const weaponSlot = createSlot('Mount', 'mod_mount', ['mount']);
  const weapon = createWeapon([weaponSlot]);
  const allMods = { mount, laser: child };
  const slotId = buildWeaponAssemblyTree(weapon, []).slots[0].id;
  const plan = planBuildSlotChange({ weapon, buildParts: [], allMods, slotInstanceId: slotId, nextItem: mount });
  const graph = buildWeaponDiagramGraph(weapon, plan.buildParts, { allMods, includeFreeSlots: true });
  const recalculated = recalculateBuildStats(weapon, plan.buildParts);

  assert.equal(graph.nodes.some(node => node.nodeType === 'slot' && node.slotName === 'Tactical'), true);
  assert.equal(recalculated.stats.ergonomics, 49);
  assert.equal(recalculated.stats.weight, '2.20');
  assert.equal(recalculated.stats.price, 12000);
});

test('replacement preserves compatible children and warns about incompatible children', () => {
  const optic = createItem('optic');
  const oldMount = createItem('old-mount', { slots: [createSlot('Optic', 'mod_scope', ['optic'])] });
  const compatibleMount = createItem('compatible-mount', { slots: [createSlot('Optic', 'mod_scope', ['optic'])] });
  const incompatibleMount = createItem('incompatible-mount');
  const weaponSlot = createSlot('Mount', 'mod_mount', ['old-mount', 'compatible-mount', 'incompatible-mount']);
  const weapon = createWeapon([weaponSlot]);
  const allMods = { optic, 'old-mount': oldMount, 'compatible-mount': compatibleMount, 'incompatible-mount': incompatibleMount };
  const legacyBuild = [
    { slotName: 'Mount', item: oldMount },
    { slotName: 'Optic', item: optic },
  ];
  const slotInstanceId = buildWeaponAssemblyTree(weapon, legacyBuild).slots[0].id;

  const preserved = planBuildSlotChange({ weapon, buildParts: legacyBuild, allMods, slotInstanceId, nextItem: compatibleMount });
  const removed = planBuildSlotChange({ weapon, buildParts: legacyBuild, allMods, slotInstanceId, nextItem: incompatibleMount });

  assert.deepEqual(preserved.removedItems, []);
  assert.equal(preserved.buildParts.some(part => part.item.id === 'optic'), true);
  assert.deepEqual(removed.removedItems.map(item => item.id), ['optic']);
  assert.equal(removed.buildParts.some(part => part.item.id === 'optic'), false);
});

test('optional modules can be removed while required slots reject removal', () => {
  const optionalSlot = createSlot('Optional', 'mod_optional', ['optional']);
  const requiredSlot = createSlot('Required', 'mod_required', ['required'], true);
  const optional = createItem('optional');
  const required = createItem('required');
  const weapon = createWeapon([optionalSlot, requiredSlot]);
  const buildParts = [
    contextualPart(weapon, optionalSlot, 0, optional),
    contextualPart(weapon, requiredSlot, 1, required),
  ];
  const tree = buildWeaponAssemblyTree(weapon, buildParts);

  const optionalPlan = planBuildSlotChange({
    weapon,
    buildParts,
    allMods: { optional, required },
    slotInstanceId: tree.slots[0].id,
    nextItem: null,
  });
  const requiredPlan = planBuildSlotChange({
    weapon,
    buildParts,
    allMods: { optional, required },
    slotInstanceId: tree.slots[1].id,
    nextItem: null,
  });

  assert.equal(optionalPlan.errors.length, 0);
  assert.deepEqual(optionalPlan.buildParts.map(part => part.item.id), ['required']);
  assert.match(requiredPlan.errors[0], /required module/i);
});

test('selected slot remains addressable after an edit', () => {
  const slot = createSlot('Mount', 'mod_mount', ['mount']);
  const mount = createItem('mount');
  const weapon = createWeapon([slot]);
  const slotInstanceId = buildWeaponAssemblyTree(weapon, []).slots[0].id;
  const plan = planBuildSlotChange({
    weapon,
    buildParts: [],
    allMods: { mount },
    slotInstanceId,
    nextItem: mount,
  });

  assert.equal(findBuildSlotContext(weapon, plan.buildParts, slotInstanceId).slotContext.installedNode.item.id, 'mount');
});
