import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWeaponAssemblyTree } from '../../src/domain/weaponAssembly.js';
import {
  getActivePreviewCandidate,
  getProjectedBuildMeters,
} from '../../src/ui/weaponBuildStatPreview.js';

function createSlot(name, allowedIds) {
  return {
    name,
    nameId: `id_${name.toLowerCase()}`,
    filters: { allowedItems: allowedIds.map(id => ({ id })) },
  };
}

function createItem(id, options = {}) {
  return {
    id,
    name: id,
    shortName: id,
    ergonomicsModifier: options.ergonomicsModifier ?? 0,
    recoilModifier: options.recoilModifier ?? 0,
    weight: options.weight ?? 0,
    price: { value: options.price ?? 1_000 },
    properties: { slots: options.slots ?? [] },
    categories: [{ name: 'Weapon mod' }],
  };
}

function createWeapon(slots) {
  return {
    ...createItem('weapon', { weight: 2, price: 10_000, slots }),
    properties: {
      slots,
      ergonomics: 50,
      recoilVertical: 100,
      recoilHorizontal: 200,
    },
  };
}

function createMeters() {
  return [
    { key: 'weight', label: 'Weight', value: 2.1, displayValue: '2.10 kg', range: { min: 0, max: 15, direction: 'lower-is-better' } },
    { key: 'ergonomics', label: 'Ergonomics', value: 52, range: { min: 0, max: 100, direction: 'higher-is-better' } },
    { key: 'vertical-recoil', label: 'Vertical Recoil', value: 90, range: { min: 0, max: 100, direction: 'lower-is-better' } },
    { key: 'horizontal-recoil', label: 'Horizontal Recoil', value: 180, range: { min: 0, max: 200, direction: 'lower-is-better' } },
  ];
}

function getPreview({ weapon, buildParts, allMods, slotInstanceId, nextItem, meters = createMeters() }) {
  return getProjectedBuildMeters({
    weapon,
    buildParts,
    allMods,
    slotInstanceId,
    nextItem,
    priceMode: 'average',
    includeTraderPrices: false,
    meters,
  });
}

test('selects the pointer candidate before the focused candidate through event interleaving', () => {
  const focused = { id: 'focused' };
  const hovered = { id: 'hovered' };

  assert.equal(getActivePreviewCandidate(null, focused), focused);
  assert.equal(getActivePreviewCandidate(hovered, focused), hovered);
  assert.equal(getActivePreviewCandidate(null, focused), focused);
  assert.equal(getActivePreviewCandidate(null, null), null);
});

test('projects all meter values for a valid replacement without mutating the input meters', () => {
  const slot = createSlot('Mount', ['old-mount', 'new-mount']);
  const weapon = createWeapon([slot]);
  const oldMount = createItem('old-mount', { ergonomicsModifier: 2, recoilModifier: -10, weight: 0.1 });
  const newMount = createItem('new-mount', { ergonomicsModifier: 5, recoilModifier: -20, weight: 0.2 });
  const buildParts = [{ slotName: 'Mount', item: oldMount }];
  const slotInstanceId = buildWeaponAssemblyTree(weapon, buildParts).slots[0].id;
  const meters = createMeters();
  const originalMeters = structuredClone(meters);

  const preview = getPreview({
    weapon,
    buildParts,
    allMods: { 'old-mount': oldMount, 'new-mount': newMount },
    slotInstanceId,
    nextItem: newMount,
    meters,
  });

  assert.deepEqual(preview.map(meter => meter.value), [2.2, 55, 80, 160]);
  assert.equal(preview[0].displayValue, '2.20 kg');
  assert.deepEqual(preview.map(({ label, range }) => ({ label, range })), originalMeters.map(({ label, range }) => ({ label, range })));
  assert.deepEqual(meters, originalMeters);
});

test('uses plan build parts when the replacement removes an incompatible child module', () => {
  const childSlot = createSlot('Tactical', ['laser']);
  const mountSlot = createSlot('Mount', ['old-mount', 'new-mount']);
  const weapon = createWeapon([mountSlot]);
  const oldMount = createItem('old-mount', { ergonomicsModifier: 2, slots: [childSlot] });
  const laser = createItem('laser', { ergonomicsModifier: 8, recoilModifier: -20, weight: 0.3 });
  const newMount = createItem('new-mount', { ergonomicsModifier: 1, recoilModifier: -5, weight: 0.2 });
  const buildParts = [
    { slotName: 'Mount', item: oldMount },
    { slotName: 'Tactical', item: laser },
  ];
  const slotInstanceId = buildWeaponAssemblyTree(weapon, buildParts).slots[0].id;

  const preview = getPreview({
    weapon,
    buildParts,
    allMods: { 'old-mount': oldMount, laser, 'new-mount': newMount },
    slotInstanceId,
    nextItem: newMount,
  });

  assert.deepEqual(preview.map(meter => meter.value), [2.2, 51, 95, 190]);
});

test('returns null for invalid and no-op replacement plans', () => {
  const slot = createSlot('Mount', ['mount']);
  const weapon = createWeapon([slot]);
  const mount = createItem('mount');
  const buildParts = [{ slotName: 'Mount', item: mount }];
  const slotInstanceId = buildWeaponAssemblyTree(weapon, buildParts).slots[0].id;

  assert.equal(getPreview({
    weapon,
    buildParts,
    allMods: { mount },
    slotInstanceId,
    nextItem: mount,
  }), null);
  assert.equal(getPreview({
    weapon,
    buildParts,
    allMods: { mount },
    slotInstanceId: 'missing-slot',
    nextItem: mount,
  }), null);
});
