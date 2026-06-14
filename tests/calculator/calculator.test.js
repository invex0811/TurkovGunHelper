import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { calculateBestBuild } from '../../src/domain/calculator.js';

const modsFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/mods.json', import.meta.url), 'utf8'));
const weaponFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/weapon.json', import.meta.url), 'utf8'));

const mods = modsFixture.data.items;
const weapon = weaponFixture.data.item;
const modMap = Object.fromEntries(mods.map(mod => [mod.id, mod]));

function hasCategory(item, categoryName) {
  return item.categories?.some(category => category.name === categoryName) || false;
}

function getExpectedItemPrice(item, priceMode) {
  const rawPrice = item.avg24hPrice
    || item.lastLowPrice
    || item.low24hPrice
    || item.basePrice
    || 0;

  if (!priceMode || item.price?.mode === priceMode) {
    return item.price?.value ?? rawPrice;
  }

  return rawPrice;
}

function assertNoDuplicateParts(result) {
  const ids = result.build.map(part => part.item.id);
  assert.equal(new Set(ids).size, ids.length, 'build must not install the same item twice');
}

function assertNoInstalledConflicts(result) {
  const installedIds = new Set([weapon.id, ...result.build.map(part => part.item.id)]);

  for (const part of result.build) {
    for (const conflict of part.item.conflictingItems || []) {
      assert.equal(
        installedIds.has(conflict.id),
        false,
        `${part.item.shortName} conflicts with another installed item ${conflict.id}`,
      );
    }
  }
}

function assertStatsMatchParts(result) {
  const totalErgo = weapon.properties.ergonomics
    + result.build.reduce((sum, part) => sum + (part.item.ergonomicsModifier || 0), 0);
  const totalRecoilMod = result.build.reduce((sum, part) => sum + (part.item.recoilModifier || 0), 0);
  const totalWeight = weapon.weight + result.build.reduce((sum, part) => sum + (part.item.weight || 0), 0);
  const totalPrice = (weapon.avg24hPrice || weapon.basePrice || 0)
    + result.build.reduce((sum, part) => sum + (part.item.avg24hPrice || part.item.basePrice || 0), 0);

  assert.equal(result.stats.ergonomics, Math.min(100, Math.round(totalErgo)));
  assert.equal(result.stats.recoilVertical, Math.round(weapon.properties.recoilVertical * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.recoilHorizontal, Math.round(weapon.properties.recoilHorizontal * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.weight, totalWeight.toFixed(2));
  assert.equal(result.stats.price, Math.round(totalPrice));
}

function createCategories(categoryNames) {
  return categoryNames.map(name => ({ name }));
}

function createSlot(name, allowedItemIds, nameId = name.toLowerCase().replace(/\s+/g, '_')) {
  return {
    name,
    nameId,
    filters: {
      allowedItems: allowedItemIds.map(id => ({ id })),
    },
  };
}

function createTestWeapon(overrides = {}) {
  return {
    id: overrides.id ?? 'test-weapon',
    name: overrides.name ?? 'Test Weapon',
    shortName: overrides.shortName ?? 'TW',
    weight: overrides.weight ?? 1,
    basePrice: overrides.basePrice ?? 1000,
    avg24hPrice: overrides.avg24hPrice ?? 1000,
    categories: overrides.categories ?? createCategories(['Weapon']),
    conflictingItems: overrides.conflictingItems ?? [],
    properties: {
      ergonomics: overrides.ergonomics ?? 50,
      recoilVertical: overrides.recoilVertical ?? 100,
      recoilHorizontal: overrides.recoilHorizontal ?? 100,
      slots: overrides.slots ?? [],
      ...(overrides.properties ?? {}),
    },
  };
}

function createTestMod(overrides = {}) {
  const id = overrides.id;

  return {
    id,
    name: overrides.name ?? id,
    shortName: overrides.shortName ?? id,
    weight: overrides.weight ?? 0.1,
    basePrice: overrides.basePrice ?? 1000,
    avg24hPrice: overrides.avg24hPrice ?? 1000,
    categories: overrides.categories ?? [],
    accuracyModifier: overrides.accuracyModifier ?? 0,
    recoilModifier: overrides.recoilModifier ?? 0,
    ergonomicsModifier: overrides.ergonomicsModifier ?? 0,
    conflictingItems: overrides.conflictingItemIds?.map(conflictId => ({ id: conflictId })) ?? overrides.conflictingItems ?? [],
    properties: {
      slots: overrides.slots ?? [],
      ...(overrides.properties ?? {}),
    },
  };
}

function createModMap(...items) {
  return Object.fromEntries(items.map(item => [item.id, item]));
}

function getInstalledItemIds(result) {
  return result.build.map(part => part.item.id);
}

function hasInstalledCategory(result, categoryName) {
  return result.build.some(part => hasCategory(part.item, categoryName));
}

function assertInstalled(result, itemId) {
  assert.equal(getInstalledItemIds(result).includes(itemId), true, `${itemId} should be installed`);
}

function assertNotInstalled(result, itemId) {
  assert.equal(getInstalledItemIds(result).includes(itemId), false, `${itemId} should not be installed`);
}

function assertNoDuplicatePartsForResult(result) {
  const ids = getInstalledItemIds(result);
  assert.equal(new Set(ids).size, ids.length, 'build must not install the same item twice');
}

function assertNoInstalledConflictsForWeapon(baseWeapon, result) {
  const installedItems = [baseWeapon, ...result.build.map(part => part.item)];
  const installedIds = new Set(installedItems.map(item => item.id));

  for (const item of installedItems) {
    for (const conflict of item.conflictingItems || []) {
      assert.equal(
        installedIds.has(conflict.id),
        false,
        `${item.shortName} conflicts with another installed item ${conflict.id}`,
      );
    }
  }
}

function assertStatsMatchPartsForWeapon(baseWeapon, result, options = {}) {
  const totalErgo = baseWeapon.properties.ergonomics
    + result.build.reduce((sum, part) => sum + (part.item.ergonomicsModifier || 0), 0);
  const totalRecoilMod = result.build.reduce((sum, part) => sum + (part.item.recoilModifier || 0), 0);
  const totalWeight = baseWeapon.weight + result.build.reduce((sum, part) => sum + (part.item.weight || 0), 0);
  const totalPrice = getExpectedItemPrice(baseWeapon, options.priceMode)
    + result.build.reduce((sum, part) => sum + getExpectedItemPrice(part.item, options.priceMode), 0);

  assert.equal(result.stats.ergonomics, Math.min(100, Math.round(totalErgo)));
  assert.equal(result.stats.recoilVertical, Math.round(baseWeapon.properties.recoilVertical * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.recoilHorizontal, Math.round(baseWeapon.properties.recoilHorizontal * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.weight, totalWeight.toFixed(2));
  assert.equal(result.stats.price, Math.round(totalPrice));
}

const defaultOptions = {
  forbidSuppressor: false,
  requireSuppressor: false,
  maxWeight: 0,
};

for (const targetType of ['meta', 'max_ergo', 'min_recoil', 'budget', 'custom']) {
  test(`${targetType} build has valid unique parts and consistent stats`, () => {
    const result = calculateBestBuild(weapon, targetType, 70, 50, modMap, {
      forbidSuppressor: false,
      requireSuppressor: false,
      maxWeight: 0,
    });

    assert.ok(result.build.length > 0, `${targetType} should return at least one part`);
    assertNoDuplicateParts(result);
    assertNoInstalledConflicts(result);
    assertStatsMatchParts(result);
  });
}

test('forbidSuppressor excludes silencer parts', () => {
  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    forbidSuppressor: true,
    requireSuppressor: false,
    maxWeight: 0,
  });

  assert.equal(result.build.some(part => hasCategory(part.item, 'Silencer')), false);
  assertNoDuplicateParts(result);
  assertStatsMatchParts(result);
});

test('requireSuppressor installs a compatible silencer', () => {
  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    forbidSuppressor: false,
    requireSuppressor: true,
    maxWeight: 0,
  });

  assert.equal(result.build.some(part => hasCategory(part.item, 'Silencer')), true);
  assertNoDuplicateParts(result);
  assertStatsMatchParts(result);
});

test('maxWeight is enforced as a hard limit when physically possible', () => {
  const maxWeight = 2;
  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    forbidSuppressor: false,
    requireSuppressor: false,
    maxWeight,
  });

  assert.ok(Number(result.stats.weight) <= maxWeight, `weight ${result.stats.weight} exceeds ${maxWeight}`);
  assertNoDuplicateParts(result);
  assertStatsMatchParts(result);
});

test('requireSuppressor installs directly compatible silencer', () => {
  const silencer = createTestMod({
    id: 'direct-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: -10,
    ergonomicsModifier: -2,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Muzzle', [silencer.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(silencer), {
    ...defaultOptions,
    requireSuppressor: true,
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, silencer.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), true);
  assertNoDuplicatePartsForResult(result);
  assertNoInstalledConflictsForWeapon(testWeapon, result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('requireSuppressor installs silencer through adapter chain', () => {
  const silencer = createTestMod({
    id: 'chain-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: -12,
    ergonomicsModifier: -3,
  });
  const adapter = createTestMod({
    id: 'muzzle-adapter',
    categories: createCategories(['Mount']),
    slots: [createSlot('Suppressor', [silencer.id])],
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Muzzle', [adapter.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(adapter, silencer), {
    ...defaultOptions,
    requireSuppressor: true,
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, adapter.id);
  assertInstalled(result, silencer.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), true);
  assertNoDuplicatePartsForResult(result);
  assertNoInstalledConflictsForWeapon(testWeapon, result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('requireSuppressor returns error when no compatible silencer exists', () => {
  const muzzleBrake = createTestMod({
    id: 'muzzle-brake',
    categories: createCategories(['Muzzle Device']),
    recoilModifier: -8,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Muzzle', [muzzleBrake.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(muzzleBrake), {
    ...defaultOptions,
    requireSuppressor: true,
  });

  assert.match(result.error, /suppressor/i);
  assert.equal(hasInstalledCategory(result, 'Silencer'), false);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('forbidSuppressor rejects directly compatible silencer', () => {
  const silencer = createTestMod({
    id: 'forbidden-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: -20,
  });
  const muzzleBrake = createTestMod({
    id: 'allowed-muzzle-brake',
    categories: createCategories(['Muzzle Device']),
    recoilModifier: -5,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Muzzle', [silencer.id, muzzleBrake.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(silencer, muzzleBrake), {
    ...defaultOptions,
    forbidSuppressor: true,
  });

  assert.equal(result.error, undefined);
  assertNotInstalled(result, silencer.id);
  assertInstalled(result, muzzleBrake.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), false);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('optional suppressor can choose non-silencer when it scores better', () => {
  const poorSuppressor = createTestMod({
    id: 'poor-optional-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: 0,
    ergonomicsModifier: -20,
    weight: 1,
  });
  const muzzleBrake = createTestMod({
    id: 'better-muzzle-brake',
    categories: createCategories(['Muzzle Device']),
    recoilModifier: -10,
    ergonomicsModifier: 1,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Muzzle', [poorSuppressor.id, muzzleBrake.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(poorSuppressor, muzzleBrake), defaultOptions);

  assert.equal(result.error, undefined);
  assertInstalled(result, muzzleBrake.id);
  assertNotInstalled(result, poorSuppressor.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), false);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('requireSuppressor skips conflicting part to install silencer chain', () => {
  const silencer = createTestMod({
    id: 'required-chain-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: -10,
    ergonomicsModifier: -2,
  });
  const adapter = createTestMod({
    id: 'required-chain-adapter',
    categories: createCategories(['Mount']),
    slots: [createSlot('Suppressor', [silencer.id])],
  });
  const conflictingStock = createTestMod({
    id: 'conflicting-stock',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 30,
    conflictingItemIds: [silencer.id],
  });
  const testWeapon = createTestWeapon({
    slots: [
      createSlot('Stock', [conflictingStock.id]),
      createSlot('Muzzle', [adapter.id]),
    ],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(conflictingStock, adapter, silencer), {
    ...defaultOptions,
    requireSuppressor: true,
  });

  assert.equal(result.error, undefined);
  assertNotInstalled(result, conflictingStock.id);
  assertInstalled(result, adapter.id);
  assertInstalled(result, silencer.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), true);
  assertNoDuplicatePartsForResult(result);
  assertNoInstalledConflictsForWeapon(testWeapon, result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('requireSuppressor returns error when compatible silencer exceeds max weight', () => {
  const heavySilencer = createTestMod({
    id: 'heavy-silencer',
    categories: createCategories(['Silencer']),
    recoilModifier: -20,
    weight: 1,
  });
  const testWeapon = createTestWeapon({
    weight: 1,
    slots: [createSlot('Muzzle', [heavySilencer.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(heavySilencer), {
    ...defaultOptions,
    requireSuppressor: true,
    maxWeight: 1.1,
  });

  assert.match(result.error, /suppressor/i);
  assertNotInstalled(result, heavySilencer.id);
  assert.equal(hasInstalledCategory(result, 'Silencer'), false);
  assert.ok(Number(result.stats.weight) <= 1.1, `weight ${result.stats.weight} exceeds 1.1`);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});

test('budget scoring uses normalized price for selected price mode', () => {
  const normalizedCheapMod = createTestMod({
    id: 'normalized-cheap-mod',
    shortName: 'NCM',
    avg24hPrice: 100000,
    basePrice: 100000,
    ergonomicsModifier: 0,
    recoilModifier: 0,
    weight: 0.1,
  });

  normalizedCheapMod.price = {
    value: 100,
    mode: 'pvp',
  };

  const normalizedExpensiveMod = createTestMod({
    id: 'normalized-expensive-mod',
    shortName: 'NEM',
    avg24hPrice: 1,
    basePrice: 1,
    ergonomicsModifier: 0,
    recoilModifier: 0,
    weight: 0.1,
  });

  normalizedExpensiveMod.price = {
    value: 100000,
    mode: 'pvp',
  };

  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [normalizedCheapMod.id, normalizedExpensiveMod.id])],
  });

  const result = calculateBestBuild(
    testWeapon,
    'budget',
    70,
    50,
    createModMap(normalizedCheapMod, normalizedExpensiveMod),
    {
      ...defaultOptions,
      priceMode: 'pvp',
    },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, normalizedCheapMod.id);
  assertNotInstalled(result, normalizedExpensiveMod.id);
  assertStatsMatchPartsForWeapon(testWeapon, result, { priceMode: 'pvp' });
});

test('budget scoring ignores normalized price from a different price mode', () => {
  const wrongModeCheapMod = createTestMod({
    id: 'wrong-mode-cheap-mod',
    shortName: 'WMCM',
    avg24hPrice: 100000,
    basePrice: 100000,
    ergonomicsModifier: 0,
    recoilModifier: 0,
    weight: 0.1,
  });

  wrongModeCheapMod.price = {
    value: 1,
    mode: 'pve',
  };

  const selectedModeMod = createTestMod({
    id: 'selected-mode-mod',
    shortName: 'SMM',
    avg24hPrice: 1000,
    basePrice: 1000,
    ergonomicsModifier: 0,
    recoilModifier: 0,
    weight: 0.1,
  });

  selectedModeMod.price = {
    value: 1000,
    mode: 'pvp',
  };

  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [wrongModeCheapMod.id, selectedModeMod.id])],
  });

  const result = calculateBestBuild(
    testWeapon,
    'budget',
    70,
    50,
    createModMap(wrongModeCheapMod, selectedModeMod),
    {
      ...defaultOptions,
      priceMode: 'pvp',
    },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, selectedModeMod.id);
  assertNotInstalled(result, wrongModeCheapMod.id);
  assertStatsMatchPartsForWeapon(testWeapon, result, { priceMode: 'pvp' });
});

test('Magazine Selection Logic: should fallback to 30 capacity by default and select better candidate', () => {
  const mag30Steel = createTestMod({
    id: 'mag_30_steel',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -2,
    recoilModifier: -0.01,
    properties: { capacity: 30, loadModifier: 0.05, ammoCheckModifier: 0.1 }
  });
  const mag30Pmag = createTestMod({
    id: 'mag_30_pmag',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -1,
    recoilModifier: -0.01,
    properties: { capacity: 30, loadModifier: 0.02, ammoCheckModifier: 0.05 }
  });
  const mag60Drum = createTestMod({
    id: 'mag_60_drum',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -8,
    recoilModifier: -0.03,
    properties: { capacity: 60, loadModifier: 0.15, ammoCheckModifier: 0.25 }
  });

  const testWeapon = createTestWeapon({
    slots: [createSlot('mag', [mag30Steel.id, mag30Pmag.id, mag60Drum.id])],
  });

  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(mag30Steel, mag30Pmag, mag60Drum),
    defaultOptions
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, mag30Pmag.id);
  assertNotInstalled(result, mag30Steel.id);
  assertNotInstalled(result, mag60Drum.id);
});

test('Magazine Selection Logic: should choose exact requested capacity', () => {
  const mag30Pmag = createTestMod({
    id: 'mag_30_pmag',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -1,
    recoilModifier: -0.01,
    properties: { capacity: 30, loadModifier: 0.02, ammoCheckModifier: 0.05 }
  });
  const mag60Drum = createTestMod({
    id: 'mag_60_drum',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -8,
    recoilModifier: -0.03,
    properties: { capacity: 60, loadModifier: 0.15, ammoCheckModifier: 0.25 }
  });

  const testWeapon = createTestWeapon({
    slots: [createSlot('mag', [mag30Pmag.id, mag60Drum.id])],
  });

  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(mag30Pmag, mag60Drum),
    {
      ...defaultOptions,
      magazineCapacity: 60,
    }
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, mag60Drum.id);
  assertNotInstalled(result, mag30Pmag.id);
});

test('Magazine Selection Logic: should fallback to nearest capacity if exact match is missing', () => {
  const mag30Pmag = createTestMod({
    id: 'mag_30_pmag',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -1,
    recoilModifier: -0.01,
    properties: { capacity: 30, loadModifier: 0.02, ammoCheckModifier: 0.05 }
  });
  const mag60Drum = createTestMod({
    id: 'mag_60_drum',
    categories: createCategories(['Magazine']),
    ergonomicsModifier: -8,
    recoilModifier: -0.03,
    properties: { capacity: 60, loadModifier: 0.15, ammoCheckModifier: 0.25 }
  });

  const testWeapon = createTestWeapon({
    slots: [createSlot('mag', [mag30Pmag.id, mag60Drum.id])],
  });

  // Requesting 40: 30 is closer (diff 10) than 60 (diff 20)
  const result30 = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(mag30Pmag, mag60Drum),
    {
      ...defaultOptions,
      magazineCapacity: 40,
    }
  );

  assert.equal(result30.error, undefined);
  assertInstalled(result30, mag30Pmag.id);
  assertNotInstalled(result30, mag60Drum.id);

  // Requesting 50: 60 is closer (diff 10) than 30 (diff 20)
  const result60 = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(mag30Pmag, mag60Drum),
    {
      ...defaultOptions,
      magazineCapacity: 50,
    }
  );

  assert.equal(result60.error, undefined);
  assertInstalled(result60, mag60Drum.id);
  assertNotInstalled(result60, mag30Pmag.id);
});