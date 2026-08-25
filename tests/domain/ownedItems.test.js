import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateBuildCostSummary,
  createBuildAssemblySnapshot,
  getBuildItemInstances,
  getBuildItemInstancesFromAssemblyTree,
  reconcileOwnedItemInstances,
  reconcileOwnedItems,
  toggleOwnedItem,
} from '../../src/domain/ownedItems.js';

function item(id, price, slots = []) {
  return {
    id,
    name: id,
    price: { value: price, mode: 'pvp' },
    properties: { slots },
  };
}

const slot = {
  name: 'Mount',
  nameId: 'mount',
  filters: { allowedItems: [{ id: 'part-a' }, { id: 'part-b' }] },
};

test('owned instance keys are stable and reconciliation drops replaced items', () => {
  const weapon = item('weapon', 10_000, [slot]);
  const partA = item('part-a', 2_000);
  const partB = item('part-b', 3_000);
  const firstBuild = [{ slotName: 'Mount', item: partA }];
  const instances = getBuildItemInstances(weapon, firstBuild);
  const owned = toggleOwnedItem([], instances[1]);

  assert.deepEqual(reconcileOwnedItems(owned, weapon, firstBuild), owned);
  assert.deepEqual(reconcileOwnedItems(owned, weapon, [{ slotName: 'Mount', item: partB }]), []);
});

test('cost summary includes the weapon and removes owned instances only from remaining cost', () => {
  const weapon = item('weapon', 10_000, [slot]);
  const part = item('part-a', 2_000);
  const buildParts = [{ slotName: 'Mount', item: part }];
  const instances = getBuildItemInstances(weapon, buildParts);
  const ownedItems = toggleOwnedItem([], instances[1]);
  const summary = calculateBuildCostSummary({
    weapon,
    buildParts,
    ownedItems,
    priceOptions: { priceMode: 'pvp' },
  });

  assert.equal(summary.marketTotal, 12_000);
  assert.equal(summary.remainingTotal, 10_000);
  assert.equal(summary.ownedValue, 2_000);
});

test('cost summary uses the complete weapon preset when the base weapon has no price', () => {
  const weapon = item('weapon', null, [slot]);
  weapon.defaultPresetItem = item('weapon-preset', 15_000);

  const summary = calculateBuildCostSummary({ weapon });

  assert.equal(summary.marketTotal, 15_000);
  assert.equal(summary.remainingTotal, 15_000);
  assert.deepEqual(summary.missingInstances, []);
});

test('identical item IDs installed in separate slots remain independently owned', () => {
  const repeatedSlots = [
    { ...slot, nameId: 'mod_mount' },
    { ...slot, nameId: 'mod_mount' },
  ];
  const weapon = item('weapon', 10_000, repeatedSlots);
  const repeatedPart = item('part-a', 2_000);
  const buildParts = [
    { slotName: 'Mount', slotId: 'mod_mount:0', item: repeatedPart },
    { slotName: 'Mount', slotId: 'mod_mount:1', item: repeatedPart },
  ];
  const instances = getBuildItemInstances(weapon, buildParts);
  const repeatedInstances = instances.filter(instance => instance.itemId === repeatedPart.id);

  assert.equal(repeatedInstances.length, 2);
  assert.notEqual(repeatedInstances[0].key, repeatedInstances[1].key);

  const firstOwned = toggleOwnedItem([], repeatedInstances[0]);
  const summary = calculateBuildCostSummary({
    weapon,
    buildParts,
    ownedItems: firstOwned,
    priceOptions: { priceMode: 'pvp' },
  });

  assert.deepEqual(summary.ownedItems, [{
    key: repeatedInstances[0].key,
    itemId: repeatedPart.id,
  }]);
  assert.equal(summary.marketTotal, 14_000);
  assert.equal(summary.ownedValue, 2_000);
  assert.equal(summary.remainingTotal, 12_000);

  const bothOwned = toggleOwnedItem(firstOwned, repeatedInstances[1]);
  assert.equal(bothOwned.length, 2);
  assert.deepEqual(toggleOwnedItem(bothOwned, repeatedInstances[0]), [bothOwned[1]]);
});

test('missing owned prices do not hide a known remaining-to-buy total', () => {
  const weapon = item('weapon', 10_000, [slot]);
  const missingPart = item('part-a', null);
  const buildParts = [{ slotName: 'Mount', item: missingPart }];
  const instances = getBuildItemInstances(weapon, buildParts);
  const ownedMissingPart = toggleOwnedItem([], instances[1]);

  const ownedMissingSummary = calculateBuildCostSummary({
    weapon,
    buildParts,
    ownedItems: ownedMissingPart,
    priceOptions: { priceMode: 'pvp' },
  });
  assert.equal(ownedMissingSummary.marketTotal, null);
  assert.equal(ownedMissingSummary.remainingTotal, 10_000);
  assert.equal(ownedMissingSummary.missingInstances[0].isOwned, true);

  const unownedMissingSummary = calculateBuildCostSummary({
    weapon,
    buildParts,
    priceOptions: { priceMode: 'pvp' },
  });
  assert.equal(unownedMissingSummary.marketTotal, null);
  assert.equal(unownedMissingSummary.remainingTotal, null);
  assert.equal(unownedMissingSummary.missingInstances[0].isOwned, false);
});

test('assembly snapshots preserve nested instance identity and remain read-only for ownership and cost', () => {
  const foregrip = item('foregrip', 3_000);
  const rail = item('rail', 2_000, [{
    name: 'Foregrip',
    nameId: 'mod_foregrip',
    filters: { allowedItems: [{ id: foregrip.id }] },
  }]);
  const handguard = item('handguard', 4_000, [{
    name: 'Rail',
    nameId: 'mod_rail',
    filters: { allowedItems: [{ id: rail.id }] },
  }]);
  const weapon = item('weapon', 10_000, [{
    name: 'Handguard',
    nameId: 'mod_handguard',
    filters: { allowedItems: [{ id: handguard.id }] },
  }]);
  const buildParts = [
    { slotName: 'Handguard', item: handguard },
    { slotName: 'Rail', item: rail },
    { slotName: 'Foregrip', item: foregrip },
  ];
  const snapshot = createBuildAssemblySnapshot(weapon, buildParts);
  const before = treeShape(snapshot.tree);
  const wrapperInstances = getBuildItemInstances(weapon, buildParts);
  const snapshotInstances = getBuildItemInstancesFromAssemblyTree(snapshot.tree);

  assert.deepEqual(instanceSignature(snapshot.instances), instanceSignature(wrapperInstances));
  assert.deepEqual(instanceSignature(snapshot.instances), instanceSignature(snapshotInstances));
  assert.deepEqual(instanceSignature(snapshot.instances), [
    { key: snapshot.tree.instanceId, itemId: 'weapon', isWeapon: true, buildPart: null },
    { key: snapshot.tree.children[0].instanceId, itemId: 'handguard', isWeapon: false, buildPart: buildParts[0] },
    { key: snapshot.tree.children[0].children[0].instanceId, itemId: 'rail', isWeapon: false, buildPart: buildParts[1] },
    { key: snapshot.tree.children[0].children[0].children[0].instanceId, itemId: 'foregrip', isWeapon: false, buildPart: buildParts[2] },
  ]);

  const owned = [
    { key: snapshot.instances[1].key, itemId: 'handguard' },
    { key: 'stale', itemId: 'stale' },
    { key: snapshot.instances[2].key, itemId: 'wrong-item' },
    { key: snapshot.instances[1].key, itemId: 'handguard' },
    { key: snapshot.instances[3].key, itemId: 'foregrip' },
  ];
  const reconciled = reconcileOwnedItemInstances(owned, snapshot.instances);
  const summary = calculateBuildCostSummary({
    weapon,
    buildParts,
    ownedItems: owned,
    priceOptions: { priceMode: 'pvp' },
    assemblySnapshot: snapshot,
  });

  assert.deepEqual(reconciled, [
    { key: snapshot.instances[1].key, itemId: 'handguard' },
    { key: snapshot.instances[3].key, itemId: 'foregrip' },
  ]);
  assert.strictEqual(summary.instances, snapshot.instances);
  assert.deepEqual(summary.ownedItems, reconciled);
  assert.equal(summary.marketTotal, 19_000);
  assert.equal(summary.remainingTotal, 12_000);
  assert.equal(summary.ownedValue, 7_000);
  assert.deepEqual(summary.missingInstances, []);
  assert.deepEqual(treeShape(snapshot.tree), before);
});

function instanceSignature(instances) {
  return instances.map(instance => ({
    key: instance.key,
    itemId: instance.itemId,
    isWeapon: instance.isWeapon,
    buildPart: instance.buildPart,
  }));
}

function treeShape(node) {
  return {
    itemId: node.item?.id,
    instanceId: node.instanceId,
    sourceSlotId: node.sourceSlot?.nameId || null,
    buildPart: node.buildPart,
    children: node.children.map(treeShape),
  };
}
