import test from 'node:test';
import assert from 'node:assert/strict';

import {
  exportBuild,
  exportBuilds,
  getBuildFingerprint,
  parseBuildImport,
  prepareImportedBuilds,
  restoreImportedBuild,
} from '../../src/features/buildTransfer/index.js';
import { createBuildSnapshot } from '../../src/data/savedBuilds.js';
import { createM4a1TransferFixture } from '../fixtures/buildTransferM4a1.js';

function findNode(root, itemId) {
  const queue = [root];
  for (let index = 0; index < queue.length; index += 1) {
    if (queue[index].itemId === itemId) return queue[index];
    queue.push(...queue[index].children);
  }
  return null;
}

function canonicalConfiguration(configuration) {
  return {
    itemId: configuration.itemId,
    slotId: configuration.slotId,
    ...(Number.isInteger(configuration.slotIndex) ? { slotIndex: configuration.slotIndex } : {}),
    children: configuration.children.map(canonicalConfiguration).sort((a, b) => a.itemId.localeCompare(b.itemId)),
  };
}

function configurationFromRestored(restored) {
  const fixture = {
    name: 'restored',
    weapon: { id: restored.weapon.id },
    parts: restored.buildParts.map(part => ({
      itemId: part.item.id,
      slotName: part.slotName,
      slotId: part.slotId,
      slotIndex: part.slotIndex,
      slotInstanceId: part.slotInstanceId,
      parentItemId: part.parentItemId,
      parentInstanceId: part.parentInstanceId,
    })),
    settings: { priceMode: 'pvp' },
  };
  return exportBuild(fixture).configuration;
}

test('M4A1 export preserves the MUR-1S hierarchy instead of flattening modules onto the weapon', () => {
  const fixture = createM4a1TransferFixture();
  const exported = exportBuild(fixture.savedBuild, { catalog: fixture });
  assert.deepEqual(exported.configuration.children.map(node => node.itemId), [fixture.ids.receiver, fixture.ids.stock]);
  assert.equal(findNode(exported.configuration, fixture.ids.barrel), findNode(exported.configuration, fixture.ids.receiver).children[0]);
  assert.ok(findNode(exported.configuration, fixture.ids.receiver).children.some(node => node.itemId === fixture.ids.handguard));
  assert.ok(findNode(exported.configuration, fixture.ids.barrel).children.some(node => node.itemId === fixture.ids.gasBlock));
  assert.ok(findNode(exported.configuration, fixture.ids.barrel).children.some(node => node.itemId === fixture.ids.muzzle));
  assert.ok(findNode(exported.configuration, fixture.ids.handguard).children.some(node => node.itemId === fixture.ids.foregrip));
  assert.ok(findNode(exported.configuration, fixture.ids.receiver).children.some(node => node.itemId === fixture.ids.chargingHandle));
});

test('M4A1 serialize, parse and restore round-trip keeps every immediate parent and node exactly once', () => {
  const fixture = createM4a1TransferFixture();
  const exported = exportBuilds([fixture.savedBuild], { catalogs: { regular: fixture } });
  const parsed = parseBuildImport(JSON.stringify(exported)).builds[0];
  const restored = restoreImportedBuild(parsed, fixture);
  assert.deepEqual(restored.errors, []);
  assert.equal(restored.buildParts.length, fixture.savedBuild.parts.length);
  assert.equal(new Set(restored.buildParts.map(part => part.item.id)).size, restored.buildParts.length);
  assert.deepEqual(
    canonicalConfiguration(configurationFromRestored(restored)),
    canonicalConfiguration(parsed.configuration),
  );
  const barrel = restored.buildParts.find(part => part.item.id === fixture.ids.barrel);
  const receiver = restored.buildParts.find(part => part.item.id === fixture.ids.receiver);
  assert.equal(barrel.parentItemId, fixture.ids.receiver);
  assert.equal(barrel.parentInstanceId, `${receiver.slotInstanceId}/item:${fixture.ids.receiver}`);
  assert.equal(restored.errors.some(error => /does not exist on M4A1/.test(error)), false);
  assert.equal(getBuildFingerprint(parsed), getBuildFingerprint({ ...parsed, configuration: configurationFromRestored(restored) }));
});

test('legacy flat version 1 M4A1 export is migrated top-down through MUR-1S', () => {
  const fixture = createM4a1TransferFixture();
  const legacyFlat = {
    name: fixture.savedBuild.name,
    gameMode: 'regular',
    weaponId: fixture.weapon.id,
    settings: fixture.savedBuild.settings,
    configuration: {
      itemId: fixture.weapon.id,
      slotId: null,
      children: fixture.savedBuild.parts.map(part => ({
        itemId: part.itemId,
        slotId: part.slotName,
        children: [],
      })),
    },
  };
  assert.equal(legacyFlat.configuration.children.every(node => node.children.length === 0), true);
  const restored = restoreImportedBuild(legacyFlat, fixture);
  assert.deepEqual(restored.errors, []);
  assert.equal(restored.buildParts.find(part => part.item.id === fixture.ids.barrel).parentItemId, fixture.ids.receiver);
  assert.equal(restored.buildParts.find(part => part.item.id === fixture.ids.gasBlock).parentItemId, fixture.ids.barrel);
});

test('new saved snapshots add stable immediate-parent metadata to flat calculator parts', () => {
  const fixture = createM4a1TransferFixture();
  const build = fixture.savedBuild.parts.map(part => ({
    slotName: part.slotName,
    item: fixture.itemsById[part.itemId],
  }));
  const snapshot = createBuildSnapshot({
    name: 'M4A1',
    weapon: fixture.weapon,
    buildResult: { build, stats: fixture.savedBuild.stats },
    settings: fixture.savedBuild.settings,
  });
  assert.equal(snapshot.parts.find(part => part.itemId === fixture.ids.barrel).parentItemId, fixture.ids.receiver);
  assert.equal(snapshot.parts.find(part => part.itemId === fixture.ids.gasBlock).parentItemId, fixture.ids.barrel);
  assert.equal(snapshot.parts.find(part => part.itemId === fixture.ids.receiver).slotId, 'mod_reciever');
});

test('catalog export ignores stale runtime IDs and rebuilds new parent links structurally', () => {
  const fixture = createM4a1TransferFixture();
  const build = fixture.savedBuild.parts.map(part => ({
    slotName: part.slotName,
    item: fixture.itemsById[part.itemId],
  }));
  const snapshot = createBuildSnapshot({
    name: 'M4A1',
    weapon: fixture.weapon,
    buildResult: { build, stats: fixture.savedBuild.stats },
    settings: fixture.savedBuild.settings,
  });
  snapshot.parts.forEach((part, index) => {
    part.slotInstanceId = `stale-slot-${index}`;
    part.parentInstanceId = `stale-parent-${index}`;
  });
  const restored = restoreImportedBuild(exportBuild(snapshot, { catalog: fixture }), fixture);
  assert.deepEqual(restored.errors, []);
  assert.equal(restored.buildParts.some(part => part.parentInstanceId.startsWith('stale-')), false);
  assert.equal(restored.buildParts.find(part => part.item.id === fixture.ids.barrel).parentItemId, fixture.ids.receiver);
});

test('same-name scope slot instances are resolved by stable nameId and slotIndex', () => {
  const fixture = createM4a1TransferFixture();
  const exported = exportBuild(fixture.savedBuild, { catalog: fixture });
  const scope = findNode(exported.configuration, fixture.ids.scope);
  assert.equal(scope.slotId, 'mod_scope');
  assert.equal(scope.slotIndex, 3);
  const alternate = structuredClone(exported);
  findNode(alternate.configuration, fixture.ids.scope).slotIndex = 4;
  assert.notEqual(getBuildFingerprint(exported), getBuildFingerprint(alternate));
});

test('fingerprint distinguishes the same module attached to a different immediate parent', () => {
  const fixture = createM4a1TransferFixture();
  const receiverTree = exportBuild(fixture.savedBuild, { catalog: fixture });
  const handguardTree = structuredClone(receiverTree);
  const receiver = findNode(handguardTree.configuration, fixture.ids.receiver);
  const handguard = findNode(handguardTree.configuration, fixture.ids.handguard);
  const scopeIndex = receiver.children.findIndex(node => node.itemId === fixture.ids.scope);
  const [scope] = receiver.children.splice(scopeIndex, 1);
  scope.slotIndex = 1;
  handguard.children.push(scope);
  assert.notEqual(getBuildFingerprint(receiverTree), getBuildFingerprint(handguardTree));
});

test('invalid nesting remains rejected with the immediate parent path', () => {
  const fixture = createM4a1TransferFixture();
  const exported = exportBuild(fixture.savedBuild, { catalog: fixture });
  const receiver = findNode(exported.configuration, fixture.ids.receiver);
  const muzzle = findNode(exported.configuration, fixture.ids.muzzle);
  findNode(exported.configuration, fixture.ids.barrel).children = findNode(exported.configuration, fixture.ids.barrel).children.filter(node => node !== muzzle);
  receiver.children.push(muzzle);
  const errors = restoreImportedBuild(exported, fixture).errors;
  assert.ok(errors.some(error => error.includes('M4A1 > MUR-1S > Muzzle') && error.includes('mod_muzzle')));
});

test('regular and pve hierarchy validation use one supplied catalog per mode', () => {
  const regular = createM4a1TransferFixture();
  const pve = createM4a1TransferFixture('-pve');
  const builds = [
    exportBuild(regular.savedBuild, { catalog: regular }),
    exportBuild(pve.savedBuild, { catalog: pve }),
  ];
  const results = prepareImportedBuilds({ builds, catalogs: new Map([['regular', regular], ['pve', pve]]) });
  assert.deepEqual(results.map(result => result.status), ['ready', 'ready']);
});
