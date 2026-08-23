import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateAccuracyMoa,
  calculateBestBuild,
  recalculateBuildStats,
} from '../../src/domain/calculator.js';

function createWeapon(properties = {}) {
  return {
    id: 'weapon',
    name: 'Weapon',
    shortName: 'Weapon',
    weight: 1,
    avg24hPrice: 1_000,
    categories: [{ name: 'Weapon' }],
    conflictingItems: [],
    properties: {
      ergonomics: 50,
      recoilVertical: 100,
      recoilHorizontal: 200,
      centerOfImpact: 0.01,
      deviationCurve: 1.35,
      deviationMax: 23,
      slots: [],
      ...properties,
    },
  };
}

function createPart(id, properties = {}) {
  return {
    id,
    name: id,
    shortName: id,
    weight: 0.1,
    avg24hPrice: 1_000,
    ergonomicsModifier: 10,
    recoilModifier: 0,
    accuracyModifier: 0,
    categories: [{ name: 'Barrel' }],
    conflictingItems: [],
    properties: { slots: [], ...properties },
  };
}

test('calculates a safe base-weapon MOA at full durability', () => {
  const result = recalculateBuildStats(createWeapon(), []);

  assert.equal(result.stats.accuracyMoa, 0.34);
});

test('matches the current tarkov.dev M4A1 default-preset MOA', () => {
  const m4a1 = createWeapon({ centerOfImpact: 0.01, deviationCurve: 1.35 });
  const standardBarrel = createPart('m4a1-14.5-barrel', {
    centerOfImpact: 0.053,
    deviationMax: 23,
  });

  assert.equal(calculateAccuracyMoa(m4a1, [{ item: standardBarrel }]), 2.17);
});

test('changes MOA when an accuracy-affecting barrel is replaced', () => {
  const weapon = createWeapon();
  const standardBarrel = createPart('standard', {
    centerOfImpact: 0.053,
    deviationMax: 23,
  });
  const replacementBarrel = createPart('replacement', {
    centerOfImpact: 0.07,
    deviationMax: 22,
  });

  assert.equal(calculateAccuracyMoa(weapon, [{ item: standardBarrel }]), 2.17);
  assert.equal(calculateAccuracyMoa(weapon, [{ item: replacementBarrel }]), 2.75);
});

test('returns null instead of a non-finite MOA when required data is missing', () => {
  assert.equal(calculateAccuracyMoa(createWeapon({ centerOfImpact: undefined }), []), null);
  assert.equal(calculateAccuracyMoa(createWeapon({ deviationCurve: undefined }), []), null);
  assert.equal(calculateAccuracyMoa(null, []), null);
});

test('accuracy-only data does not affect optimizer selection or scoring stats', () => {
  const slot = {
    name: 'Barrel',
    nameId: 'mod_barrel',
    required: true,
    filters: { allowedItems: [{ id: 'a-part' }, { id: 'b-part' }] },
  };
  const weapon = createWeapon({ slots: [slot] });
  const firstParts = {
    'a-part': createPart('a-part', { centerOfImpact: 0.01, deviationMax: 10 }),
    'b-part': createPart('b-part', { centerOfImpact: 0.5, deviationMax: 90 }),
  };
  const swappedParts = {
    'a-part': createPart('a-part', { centerOfImpact: 0.5, deviationMax: 90 }),
    'b-part': createPart('b-part', { centerOfImpact: 0.01, deviationMax: 10 }),
  };
  const options = { forbidSuppressor: false, requireSuppressor: false, maxWeight: 0 };

  const firstResult = calculateBestBuild(weapon, 'meta', 50, 100, firstParts, options);
  const swappedResult = calculateBestBuild(weapon, 'meta', 50, 100, swappedParts, options);

  assert.deepEqual(
    firstResult.build.map(part => part.item.id),
    swappedResult.build.map(part => part.item.id),
  );
  assert.deepEqual(firstResult.stats, swappedResult.stats);
});
