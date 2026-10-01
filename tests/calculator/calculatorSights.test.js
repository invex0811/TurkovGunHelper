import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild } from '../../src/domain/calculator.js';
import {
  weapon,
  modMap,
  hasCategory,
  assertNoDuplicateParts,
  assertNoInstalledConflicts,
  assertStatsMatchParts,
  createCategories,
  createSlot,
  createTestWeapon,
  createTestMod,
  createModMap,
  assertInstalled,
  assertNotInstalled,
  defaultOptions,
} from './calculatorTestHelpers.js';

test('required sight replaces optional sight assemblies instead of stacking with them', () => {
  const mpr45MountId = '5649a2464bdc2d91118b45a8';
  const ffwbMountId = '577d128124597739d65d0e56';
  const ff3SightId = '577d141e24597739c5255e01';
  const geisseleMountId = '618b9643526131765025ab35';
  const razorSightId = '618ba27d9008e4636a67f61d';

  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    ...defaultOptions,
    requireSight: true,
    sightMode: 'any',
    requiredItemIds: [razorSightId],
  });

  const installedSights = result.build.filter(part => hasCategory(part.item, 'Sights'));

  assert.equal(result.error, undefined);
  assertInstalled(result, geisseleMountId);
  assertInstalled(result, razorSightId);
  assertNotInstalled(result, mpr45MountId);
  assertNotInstalled(result, ffwbMountId);
  assertNotInstalled(result, ff3SightId);
  assert.equal(installedSights.length, 1);
  assertNoDuplicateParts(result);
  assertNoInstalledConflicts(result);
  assertStatsMatchParts(result);
});


test('any sight installs only one optional sight assembly across separate mount slots', () => {
  const firstSight = createTestMod({
    id: 'first-optional-sight',
    recoilModifier: -2,
    categories: createCategories(['Sights', 'Reflex sight']),
  });
  const secondSight = createTestMod({
    id: 'second-optional-sight',
    recoilModifier: -3,
    categories: createCategories(['Sights', 'Reflex sight']),
  });
  const firstMount = createTestMod({
    id: 'first-optional-mount',
    ergonomicsModifier: 5,
    categories: createCategories(['Mount']),
    slots: [createSlot('Scope', [firstSight.id], 'mod_scope', true)],
  });
  const secondMount = createTestMod({
    id: 'second-optional-mount',
    ergonomicsModifier: 5,
    categories: createCategories(['Mount']),
    slots: [createSlot('Scope', [secondSight.id], 'mod_scope', true)],
  });
  const receiver = createTestMod({
    id: 'receiver-with-two-scope-slots',
    categories: createCategories(['Receiver']),
    slots: [
      createSlot('Scope', [firstMount.id], 'mod_scope_000'),
      createSlot('Scope', [secondMount.id], 'mod_scope_001'),
    ],
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Receiver', [receiver.id], 'mod_reciever', true)],
  });
  const result = calculateBestBuild(
    testWeapon,
    'meta',
    50,
    100,
    createModMap(receiver, firstSight, secondSight, firstMount, secondMount),
    { ...defaultOptions, requireSight: true, sightMode: 'any' },
  );
  const installedSights = result.build.filter(part => hasCategory(part.item, 'Sights'));
  const installedMounts = result.build.filter(part => hasCategory(part.item, 'Mount'));

  assert.equal(result.error, undefined);
  assert.equal(installedSights.length, 1);
  assert.equal(installedMounts.length, 1);
});


test('requireSight and sightMode options should correctly filter and guarantee sight installation', () => {
  const reflexSight = createTestMod({
    id: 'reflex_sight',
    name: 'Reflex Sight',
    shortName: 'Reflex',
    ergonomicsModifier: -1,
    weight: 0.1,
    basePrice: 10000,
    avg24hPrice: 10000,
    categories: createCategories(['Reflex sight', 'Sights']),
    properties: {
      zoomLevels: [[1]],
    },
  });

  const scopeSight = createTestMod({
    id: 'scope_sight',
    name: 'Sniper Scope',
    shortName: 'Scope',
    ergonomicsModifier: -4,
    weight: 0.5,
    basePrice: 30000,
    avg24hPrice: 30000,
    categories: createCategories(['Scope', 'Sights']),
    properties: {
      zoomLevels: [[4]],
    },
  });

  const testWeapon = createTestWeapon({
    slots: [
      createSlot('mod_scope', [reflexSight.id, scopeSight.id]),
    ],
  });

  const defaultOptions = {
    magazineCapacity: 30,
    requireSight: true,
  };

  const modsMap = createModMap(reflexSight, scopeSight);

  // 1. requireSight = true, sightMode = 'reflex' -> should install reflexSight
  const resultReflex = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, sightMode: 'reflex' });
  assert.equal(resultReflex.error, undefined);
  assertInstalled(resultReflex, reflexSight.id);
  assertNotInstalled(resultReflex, scopeSight.id);

  // 2. requireSight = true, sightMode = 'scope' -> should install scopeSight
  const resultScope = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, sightMode: 'scope' });
  assert.equal(resultScope.error, undefined);
  assertInstalled(resultScope, scopeSight.id);
  assertNotInstalled(resultScope, reflexSight.id);

  // 3. requireSight = true, sightMode = 'any' -> should choose reflexSight (better ergonomics -1 > -4)
  const resultAny = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, sightMode: 'any' });
  assert.equal(resultAny.error, undefined);
  assertInstalled(resultAny, reflexSight.id);
  assertNotInstalled(resultAny, scopeSight.id);

  // 4. requireSight = true, sightMode = 1 -> should install reflexSight
  const resultZoom1 = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, sightMode: 1 });
  assert.equal(resultZoom1.error, undefined);
  assertInstalled(resultZoom1, reflexSight.id);
  assertNotInstalled(resultZoom1, scopeSight.id);

  // 5. requireSight = true, sightMode = 4 -> should install scopeSight
  const resultZoom4 = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, sightMode: 4 });
  assert.equal(resultZoom4.error, undefined);
  assertInstalled(resultZoom4, scopeSight.id);
  assertNotInstalled(resultZoom4, reflexSight.id);

  // 6. requireSight = false, sightMode = 'none' -> should not install any sights
  const resultNone = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, requireSight: false, sightMode: 'none' });
  assert.equal(resultNone.error, undefined);
  assertNotInstalled(resultNone, reflexSight.id);
  assertNotInstalled(resultNone, scopeSight.id);
});

