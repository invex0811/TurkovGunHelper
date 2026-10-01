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

test('stable category and slot identifiers keep tactical modules available with localized API names', () => {
  const laser = createTestMod({
    id: 'localized-laser',
    categories: [{ id: 'comb-tact-device', name: 'Комбинированное тактическое устройство', normalizedName: 'comb-tact-device' }],
    ergonomicsModifier: 4,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Тактический слот', [laser.id], 'mod_tactical')],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(laser), {
    ...defaultOptions,
    includeLaser: true,
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, laser.id);
});


test('required nested flashlight keeps tactical mount slots available', () => {
  const mlokMountId = '669a6a4a525be1d2d004b8eb';
  const ringMountId = '6267c6396b642f77f56f5c1c';
  const xhp35Id = '59d790f486f77403cb06aec6';

  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    ...defaultOptions,
    includeLaser: false,
    includeFlashlight: false,
    requiredItemIds: [xhp35Id],
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, mlokMountId);
  assertInstalled(result, ringMountId);
  assertInstalled(result, xhp35Id);
  assertNoDuplicateParts(result);
  assertNoInstalledConflicts(result);
  assertStatsMatchParts(result);
});


test('required nested flashlight is not blocked by the flashlight option', () => {
  const duplicateMlokMountId = '6269545d0e57f218e4548ca2';
  const duplicateRingMountId = '57d17e212459775a1179a0f5';
  const xhp35Id = '59d790f486f77403cb06aec6';

  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    ...defaultOptions,
    includeLaser: false,
    includeFlashlight: true,
    requiredItemIds: [xhp35Id],
  });

  const installedFlashlights = result.build.filter(part => hasCategory(part.item, 'Flashlight'));

  assert.equal(result.error, undefined);
  assertInstalled(result, xhp35Id);
  assertNotInstalled(result, duplicateMlokMountId);
  assertNotInstalled(result, duplicateRingMountId);
  assert.equal(installedFlashlights.length, 1);
  assertNoDuplicateParts(result);
  assertNoInstalledConflicts(result);
  assertStatsMatchParts(result);
});


test('tactical accessories options should correctly filter and install laser/flashlight devices', () => {
  const laserMod = createTestMod({
    id: 'laser_pointer',
    name: 'Laser Pointer',
    shortName: 'Laser',
    ergonomicsModifier: 2,
    weight: 0.1,
    basePrice: 5000,
    avg24hPrice: 5000,
    categories: createCategories(['Comb. tact. device']),
  });

  const flashlightMod = createTestMod({
    id: 'flashlight',
    name: 'Tactical Flashlight',
    shortName: 'Flashlight',
    ergonomicsModifier: 1,
    weight: 0.1,
    basePrice: 4000,
    avg24hPrice: 4000,
    categories: createCategories(['Flashlight']),
  });

  const testWeapon = createTestWeapon({
    slots: [
      createSlot('mod_tactical_000', [laserMod.id, flashlightMod.id]),
      createSlot('mod_tactical_001', [laserMod.id, flashlightMod.id]),
    ],
  });

  const defaultOptions = {
    magazineCapacity: 30,
  };

  const modsMap = createModMap(laserMod, flashlightMod);

  // 1. both disabled -> should not install any tactical devices
  const resultExclude = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, includeLaser: false, includeFlashlight: false });
  assert.equal(resultExclude.error, undefined);
  assertNotInstalled(resultExclude, laserMod.id);
  assertNotInstalled(resultExclude, flashlightMod.id);

  // 2. only laser enabled -> should install laserMod but not flashlightMod
  const resultLaser = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, includeLaser: true, includeFlashlight: false });
  assert.equal(resultLaser.error, undefined);
  assertInstalled(resultLaser, laserMod.id);
  assertNotInstalled(resultLaser, flashlightMod.id);
  assert.equal(resultLaser.build.length, 1);

  // 3. only flashlight enabled -> should install flashlightMod but not laserMod
  const resultFlashlight = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, includeLaser: false, includeFlashlight: true });
  assert.equal(resultFlashlight.error, undefined);
  assertInstalled(resultFlashlight, flashlightMod.id);
  assertNotInstalled(resultFlashlight, laserMod.id);
  assert.equal(resultFlashlight.build.length, 1);

  // 4. both enabled -> should install both laserMod and flashlightMod (one of each type)
  const resultBoth = calculateBestBuild(testWeapon, 'meta', 50, 50, modsMap, { ...defaultOptions, includeLaser: true, includeFlashlight: true });
  assert.equal(resultBoth.error, undefined);
  assertInstalled(resultBoth, laserMod.id);
  assertInstalled(resultBoth, flashlightMod.id);
  assert.equal(resultBoth.build.length, 2);
});

