import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateSightingRange, recalculateBuildStats } from '../../src/domain/calculator.js';
import { getProjectedBuildMeters } from '../../src/ui/weaponBuildStatPreview.js';
import { formatSightingRange } from '../../src/ui/weaponStatMeters.js';
import { buildWeaponAssemblyTree } from '../../src/domain/weaponAssembly.js';

function createItem(id, properties = {}, category = 'Weapon mod') {
  return {
    id,
    name: id,
    shortName: id,
    weight: 0.1,
    ergonomicsModifier: 0,
    recoilModifier: 0,
    conflictingItems: [],
    categories: [{ name: category }],
    properties: { slots: [], ...properties },
  };
}

const reflex = createItem('reflex', { sightingRange: 100 }, 'Sights');
const scope = createItem('scope', { sightingRange: 800 }, 'Sights');
const scopeSlot = {
  name: 'Scope',
  nameId: 'mod_scope',
  required: false,
  filters: { allowedItems: [{ id: 'reflex' }, { id: 'scope' }] },
};
const weapon = {
  ...createItem('weapon', {}, 'Weapon'),
  properties: {
    slots: [scopeSlot],
    ergonomics: 50,
    recoilVertical: 100,
    recoilHorizontal: 200,
    sightingRange: 100,
  },
};

test('sighting range is the longest range among the weapon and its sights', () => {
  assert.equal(calculateSightingRange(weapon, []), 100);
  assert.equal(calculateSightingRange(weapon, [{ slotName: 'Scope', item: scope }]), 800);
  assert.equal(calculateSightingRange({ properties: {} }, [{ item: createItem('grip') }]), null);
  assert.equal(recalculateBuildStats(weapon, [{ slotName: 'Scope', item: scope }]).stats.sightingRange, 800);
});

test('sighting range is formatted with a localized unit', () => {
  assert.equal(formatSightingRange(1500, 'en', 'm'), '1,500 m');
  assert.equal(formatSightingRange(null), null);
});

test('the diagram preview projects the sighting range of a hovered sight', () => {
  const buildParts = [{ slotName: 'Scope', item: reflex }];
  const slotInstanceId = buildWeaponAssemblyTree(weapon, buildParts).slots[0].id;
  const meters = [{ key: 'sighting-range', value: 100, displayValue: '100 m', unit: 'm' }];
  const projected = getProjectedBuildMeters({
    weapon,
    buildParts,
    allMods: { reflex, scope },
    slotInstanceId,
    nextItem: scope,
    locale: 'en',
    meters,
  });

  assert.deepEqual(projected, [{ key: 'sighting-range', value: 800, displayValue: '800 m', unit: 'm' }]);
});
